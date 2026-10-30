import { CF } from './cf.js';
import { buildHopUpload, hopUrl, chainConfigHash, firstHopUrl } from './template.js';
import { validateChain } from './validate.js';
import { resolveAccount } from './store.js';

function hopAccount(state, hop) {
  const acc = resolveAccount(state.settings, hop.accountId);
  if (!acc.apiToken) {
    throw new Error(
      `No Cloudflare API token for account "${acc.label || 'primary'}" (configure it in Settings).`
    );
  }
  if (!acc.accountId) {
    throw new Error(
      `No account ID set for Cloudflare account "${acc.label || 'primary'}" (configure it in Settings).`
    );
  }
  return acc;
}

// Uploads hops in reverse order (final hop first) so service bindings always
// resolve to an existing worker. onlyIndex: deploy that hop and every hop
// upstream of it (0-based) — used for single-hop edits and quarantine.
// Each hop deploys into its own Cloudflare account when one is assigned.
export async function deployChain(chain, state, { onlyIndex = null } = {}) {
  const v = validateChain(chain, state.settings);
  if (!v.ok) throw new Error('Validation failed: ' + v.errors.join(' '));

  const results = [];

  for (let i = lastIndex(chain, onlyIndex); i >= 0; i--) {
    const hop = chain.hops[i];
    try {
      const acc = hopAccount(state, hop);
      const cf = new CF(acc.apiToken);
      const { name, modules, metadata } = buildHopUpload(chain, i, state.settings);
      await cf.uploadWorker(acc.accountId, name, modules, metadata);
      await cf.disablePreviewUrls(acc.accountId, name);

      if (hop.exposure === 'workers_dev') {
        await cf.enableWorkersDev(acc.accountId, name);
      }
      if (hop.exposure === 'custom' && hop.customDomain) {
        await ensureCustomDomain(cf, acc, hop, name);
      }
      results.push({ hopId: hop.id, name: hop.name, worker: name, ok: true, account: acc.label || 'primary' });
    } catch (err) {
      results.push({ hopId: hop.id, name: hop.name, worker: hop.workerName, ok: false, error: err.message });
      // an un-deployed hop breaks every hop upstream of it (their bindings
      // reference it), so stop there rather than leaving a half-wired chain —
      // except paused hops, which nothing routes through anyway
      if (!hop.paused) break;
    }
  }

  if (results.every((r) => r.ok)) {
    chain.lastDeploy = {
      sourceHash: chainConfigHash(chain, state.settings),
      at: new Date().toISOString(),
      hops: lastIndex(chain, onlyIndex) + 1,
    };
  }
  return { ok: results.every((r) => r.ok), results };
}

function lastIndex(chain, onlyIndex) {
  return onlyIndex === null ? chain.hops.length - 1 : Math.min(onlyIndex, chain.hops.length - 1);
}

// The zone hosting the record: the hop's own pick, else the account default.
async function ensureCustomDomain(cf, acc, hop, serviceName) {
  const hostname = hop.customDomain;
  const zoneId = hop.zoneId || acc.zoneId;
  const domains = await cf.listCustomDomains(acc.accountId);
  const existing = domains.find((d) => d.hostname === hostname);
  if (existing) {
    if (existing.service !== serviceName) {
      await cf.deleteCustomDomain(acc.accountId, existing.id);
    } else {
      return existing;
    }
  }
  return cf.addCustomDomain(acc.accountId, {
    zoneId,
    hostname,
    service: serviceName,
  });
}

// Quarantine = redeploy hop 1 only, with KILLSWITCH=1 (template.js reads
// chain.quarantined). Takes seconds and keeps the rest of the infra intact.
export async function setQuarantine(chain, state, quarantined) {
  chain.quarantined = quarantined;
  return deployChain(chain, state, { onlyIndex: 0 });
}

// Tears down one hop's worker plus any custom domains bound to it. Used by
// destroyChain and by chain saves that removed a hop from a deployed chain
// (otherwise the removed hop's worker keeps running, orphaned, in its account).
export async function destroyHop(state, hop) {
  const removed = [];
  const errors = [];
  let acc;
  try {
    acc = hopAccount(state, hop);
  } catch (err) {
    return { removed, errors: [hop.workerName + ': ' + err.message] };
  }
  const cf = new CF(acc.apiToken);

  try {
    const domains = await cf.listCustomDomains(acc.accountId);
    for (const d of domains) {
      if (d.service === hop.workerName) {
        await cf.deleteCustomDomain(acc.accountId, d.id);
        removed.push('domain:' + d.hostname);
      }
    }
  } catch (err) {
    errors.push('domains for ' + hop.workerName + ': ' + err.message);
  }

  try {
    await cf.deleteScript(acc.accountId, hop.workerName);
    removed.push('worker:' + hop.workerName + ' @ ' + (acc.label || 'primary'));
  } catch (err) {
    if (err.status === 404) {
      removed.push('worker:' + hop.workerName + ' (absent)');
    } else {
      errors.push('worker ' + hop.workerName + ': ' + err.message);
    }
  }
  return { removed, errors };
}

export async function destroyChain(chain, state) {
  const removed = [];
  const errors = [];

  for (const hop of chain.hops) {
    const r = await destroyHop(state, hop);
    removed.push(...r.removed);
    errors.push(...r.errors);
  }

  // tunnel + its DNS record (lives in the C2 node's account); the record's
  // zone is the one picked on the C2 node, falling back to the account default
  if (chain.c2?.tunnelId) {
    try {
      const acc = c2Account(state, chain);
      const cf = new CF(acc.apiToken);
      const zoneId = chain.c2.zoneId || acc.zoneId;
      if (chain.c2.dnsRecordId && zoneId) {
        await cf.deleteDnsRecord(zoneId, chain.c2.dnsRecordId).catch(() => {});
      }
      await cf.dropTunnelConnections(acc.accountId, chain.c2.tunnelId).catch(() => {});
      await cf.deleteTunnel(acc.accountId, chain.c2.tunnelId);
      removed.push('tunnel:' + chain.c2.tunnelId);
    } catch (err) {
      errors.push('tunnel: ' + err.message);
    }
    chain.c2.tunnelId = '';
    chain.c2.dnsRecordId = '';
  }

  chain.lastDeploy = null;
  return { ok: errors.length === 0, removed, errors };
}

// The tunnel lives in the C2 node's account, defaulting to the last hop's.
function c2Account(state, chain) {
  const lastHop = chain.hops[chain.hops.length - 1];
  const acc = resolveAccount(state.settings, chain.c2.accountId || lastHop?.accountId);
  if (!acc.apiToken) {
    throw new Error(`No Cloudflare API token for account "${acc.label || 'primary'}" (configure it in Settings).`);
  }
  return acc;
}

export async function provisionTunnel(chain, state) {
  const acc = c2Account(state, chain);
  // zone for the CNAME: explicit pick on the C2 node > the account's default
  // > ask the token (one visible zone just works; several get named)
  let zoneId = chain.c2.zoneId || acc.zoneId;
  if (!zoneId) {
    if (!acc.apiToken) {
      throw new Error(`No zone configured for account "${acc.label || 'primary'}" (the tunnel DNS record lives there).`);
    }
    const zones = await new CF(acc.apiToken)
      .listZones()
      .then((r) => r || [])
      .catch(() => []);
    const scoped = zones.filter((z) => !acc.accountId || z.account?.id === acc.accountId);
    if (scoped.length === 1) {
      zoneId = scoped[0].id;
    } else if (!scoped.length) {
      throw new Error(
        `No zone visible to the "${acc.label || 'primary'}" token — the tunnel DNS record needs Zone:Read on the zone (or set the zone in Settings).`
      );
    } else {
      throw new Error(
        `Pick a DNS zone on the C2 node — the token can see several: ${scoped.map((z) => z.name).join(', ')}.`
      );
    }
  }
  if (!chain.c2.hostname) throw new Error('Set the public listener hostname first.');
  if (chain.c2.mode !== 'tunnel') throw new Error('C2 mode is not "tunnel".');

  const cf = new CF(acc.apiToken);
  if (!chain.c2.tunnelId) {
    const tunnel = await cf.createTunnel(
      acc.accountId,
      'rdr-' + chain.name.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase() + '-' + Date.now().toString(36)
    );
    chain.c2.tunnelId = tunnel.id;
  }

  // proxied CNAME hostname -> <tunnel-id>.cfargotunnel.com
  const target = chain.c2.tunnelId + '.cfargotunnel.com';
  const existing = await cf.listDnsRecords(zoneId, chain.c2.hostname);
  const match = existing.find((r) => r.type === 'CNAME');
  if (match) {
    chain.c2.dnsRecordId = match.id;
  } else {
    const rec = await cf.createDnsRecord(zoneId, { name: chain.c2.hostname, target });
    chain.c2.dnsRecordId = rec.id;
  }
  chain.c2.zoneId = zoneId; // persist the resolved zone (route saves state)

  // remote-managed ingress: listener host -> local service on the C2 box, then 404
  const ingress = { hostname: chain.c2.hostname, service: chain.c2.localService || 'http://127.0.0.1:8443' };
  // listeners fronting TLS with a self-signed cert (Mythic default) fail
  // cloudflared's origin verification without this. The flag lives under
  // originRequest in the tunnel-config schema — a flat rule field is echoed
  // back by the API but silently ignored by cloudflared (x509 errors anyway).
  if (chain.c2.noTLSVerify) ingress.originRequest = { noTLSVerify: true };
  await cf.putTunnelConfig(acc.accountId, chain.c2.tunnelId, {
    ingress: [ingress, { service: 'http_status:404' }],
  });

  const token = await cf.tunnelToken(acc.accountId, chain.c2.tunnelId);
  return {
    tunnelId: chain.c2.tunnelId,
    hostname: chain.c2.hostname,
    dnsRecordId: chain.c2.dnsRecordId,
    zoneId, // resolved zone — the client must adopt it or a later PUT erases the auto-pick
    account: acc.label || 'primary',
    cloudflaredCmd: 'cloudflared tunnel run --token ' + token,
    note: 'Run this on the C2 server. The listener must bind to ' + (chain.c2.localService || 'http://127.0.0.1:8443'),
  };
}

export async function removeTunnel(chain, state) {
  const acc = c2Account(state, chain);
  const cf = new CF(acc.apiToken);
  const zoneId = chain.c2.zoneId || acc.zoneId;
  if (chain.c2.dnsRecordId && zoneId) {
    await cf.deleteDnsRecord(zoneId, chain.c2.dnsRecordId).catch(() => {});
  }
  if (chain.c2.tunnelId) {
    await cf.dropTunnelConnections(acc.accountId, chain.c2.tunnelId).catch(() => {});
    await cf.deleteTunnel(acc.accountId, chain.c2.tunnelId).catch(() => {});
  }
  chain.c2.tunnelId = '';
  chain.c2.dnsRecordId = '';
  return { ok: true };
}

// Live per-node state straight from the Cloudflare API (per-hop accounts)
export async function chainStatus(chain, state) {
  const settings = state.settings;
  const status = { configured: true, hops: {}, c2: {}, accounts: {} };

  // one API client per distinct account used by this chain
  const clients = new Map();
  const cfFor = (hop) => {
    const acc = resolveAccount(settings, hop.accountId);
    const key = acc.id || acc.accountId || 'primary';
    if (!clients.has(key)) clients.set(key, { acc, cf: new CF(acc.apiToken) });
    return clients.get(key);
  };
  // materialize the chain's accounts up front — cfFor is lazy, and the
  // token check below must see them (otherwise status always reads
  // "unconfigured" and every hop shows as not deployed)
  for (const hop of chain.hops) cfFor(hop);

  let anyToken = false;
  for (const { acc } of clients.values()) if (acc.apiToken) anyToken = true;
  if (!clients.size || !anyToken) return { configured: false, hops: {}, c2: {} };

  // scripts + custom domains per account
  for (const [key, { acc, cf }] of clients.entries()) {
    const entry = { label: acc.label || 'primary', configured: !!(acc.apiToken && acc.accountId) };
    if (!entry.configured) {
      status.accounts[key] = { ...entry, error: 'missing token or account id' };
      continue;
    }
    try {
      const [scripts, domains] = await Promise.all([
        cf.listScripts(acc.accountId),
        cf.listCustomDomains(acc.accountId),
      ]);
      entry.scriptNames = new Set(scripts.map((s) => s.id));
      entry.domains = domains;
      status.accounts[key] = entry;
    } catch (err) {
      status.accounts[key] = { ...entry, error: err.message };
    }
  }

  const scriptNamesFor = (hop) => {
    const acc = resolveAccount(settings, hop.accountId);
    return status.accounts[acc.id || acc.accountId || 'primary']?.scriptNames;
  };

  for (const hop of chain.hops) {
    const names = scriptNamesFor(hop);
    status.hops[hop.id] = {
      deployed: names ? names.has(hop.workerName) : false,
      url: hopUrl(hop, settings),
    };
  }
  if (chain.c2.mode === 'tunnel' && chain.c2.tunnelId) {
    try {
      const { acc, cf } = (() => {
        const lastHop = chain.hops[chain.hops.length - 1];
        const acc = resolveAccount(settings, chain.c2.accountId || lastHop?.accountId);
        return { acc, cf: new CF(acc.apiToken) };
      })();
      const tunnels = await cf.listTunnels(acc.accountId);
      const t = tunnels.find((x) => x.id === chain.c2.tunnelId);
      status.c2 = {
        tunnelActive: !!t && (t.status === 'healthy' || (t.connections || []).length > 0),
        tunnelStatus: t ? t.status : 'missing',
      };
    } catch (err) {
      status.c2 = { tunnelActive: false, tunnelStatus: 'error: ' + err.message };
    }
  } else if (chain.c2.mode === 'direct') {
    status.c2 = { tunnelActive: null, url: chain.c2.url };
  }
  return status;
}

export { firstHopUrl, c2Account };
