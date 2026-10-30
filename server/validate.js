import { resolveAccount, sameAccount } from './store.js';
import { nextActiveHop } from './template.js';

const HEADER_NAME_RE = /^[A-Za-z0-9-]+$/;
const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function validateChain(chain, settings) {
  const errors = [];
  const warnings = [];

  const accounts = settings.accounts || [];
  if (!accounts.length && !settings.apiToken) {
    errors.push('No Cloudflare accounts configured (Settings).');
  }

  if (chain.hops.length < 1) errors.push('A chain needs at least one hop.');
  if (chain.hops.length > 3) errors.push('At most 3 hops per chain (soft cap; split into two chains instead).');

  if (chain.hops[0]?.paused) {
    errors.push("Hop 1 can't be paused — it's the implant's entry point. Use Quarantine to take the whole chain down.");
  }

  // identity checks for every hop (paused hops still deploy, killswitched)
  const names = new Set();
  const workers = new Set();
  const hosts = new Set();
  chain.hops.forEach((hop, i) => {
    const label = 'Hop ' + (i + 1) + (hop.name ? ` "${hop.name}"` : '');
    if (!hop.workerName) errors.push(label + ': missing worker name.');
    if (workers.has(hop.workerName)) errors.push(label + ': duplicate worker name ' + hop.workerName + '.');
    workers.add(hop.workerName);
    if (names.has(hop.name)) warnings.push(label + ': duplicate display name.');
  });

  // traffic checks only for hops actually on the active path
  const active = chain.hops.filter((h) => !h.paused);
  active.forEach((hop) => {
    const i = chain.hops.indexOf(hop);
    const label = 'Hop ' + (i + 1) + (hop.name ? ` "${hop.name}"` : '');

    // per-hop account must resolve and be fully configured
    const acc = resolveAccount(settings, hop.accountId);
    if (hop.accountId && !accounts.some((a) => a.id === hop.accountId)) {
      errors.push(label + ': references unknown Cloudflare account ' + hop.accountId + '.');
    } else if (!acc.apiToken || !acc.accountId) {
      errors.push(label + ': Cloudflare account "' + (acc.label || 'primary') + '" is missing its API token or account ID.');
    }

    if (!HEADER_NAME_RE.test(hop.secretHeader || '')) errors.push(label + ': secret header name must match ' + HEADER_NAME_RE);
    if (!hop.secretValue || hop.secretValue.length < 16) errors.push(label + ': secret value missing or too short.');

    if (hop.exposure === 'custom') {
      const host = (hop.customDomain || '').toLowerCase();
      if (!HOSTNAME_RE.test(host)) {
        errors.push(label + ': invalid custom domain hostname.');
      } else {
        if (hosts.has(host)) errors.push(label + ': hostname ' + host + ' used by another hop.');
        hosts.add(host);
        if (!acc.zoneId && !hop.zoneId) {
          errors.push(label + ': custom domain needs a zone — pick a domain on the hop, or set a default zone on its Cloudflare account.');
        }
      }
    }
    if (hop.exposure === 'workers_dev' && !acc.workersDevSubdomain) {
      errors.push(label + ': workers.dev exposure needs the account subdomain (Settings → account "' + (acc.label || 'primary') + '").');
    }
    if (hop.exposure === 'none' && hop === active[0]) {
      errors.push(label + ': the first hop must be reachable (workers.dev or custom domain).');
    }
  });

  // (account placement is positional policy — applied in store.applyAccountPolicy —
  // so there's no "front on primary" state to warn about anymore)

  const ws = chain.transport === 'ws';
  chain.hops.forEach((hop, i) => {
    if (hop.paused) return;
    const next = nextActiveHop(chain, i);
    if (!next) return;
    const ni = chain.hops.indexOf(next);
    if (ws && hop.exposure === 'none') {
      errors.push('Websocket chains forward hop-to-hop over fetch: every hop except the last needs a public URL (hop ' + (i + 1) + ' has none).');
    }
    // service bindings are same-account: a cross-account boundary needs the
    // next hop to be reachable over its public URL
    if (!ws && !sameAccount(settings, hop.accountId, next.accountId) && next.exposure === 'none') {
      const nextAcc = resolveAccount(settings, next.accountId);
      errors.push(
        `Hop ${i + 1} is in a different Cloudflare account than hop ${ni + 1} ("${nextAcc.label || 'primary'}"), so hop ${ni + 1} needs a public URL (service bindings can't cross accounts).`
      );
    }
  });

  const c2 = chain.c2 || {};
  if (c2.mode === 'direct') {
    if (!c2.url) errors.push('C2: direct mode needs the listener URL.');
    else if (!/^https:\/\//.test(c2.url)) warnings.push('C2: listener URL is not https — the final hop will call it in plaintext over the public internet.');
  } else if (c2.mode === 'tunnel') {
    if (c2.accountId && !accounts.some((a) => a.id === c2.accountId)) {
      errors.push('C2: references unknown Cloudflare account ' + c2.accountId + '.');
    }
    if (!c2.tunnelId) warnings.push('C2: tunnel not provisioned yet (Provision in the C2 panel).');
    if (!c2.hostname || !HOSTNAME_RE.test(c2.hostname)) errors.push('C2: tunnel mode needs a valid public hostname for the listener.');
    if (!c2.localService) errors.push('C2: tunnel mode needs the local listener address (cloudflared ingress).');
    const lastHop = chain.hops[chain.hops.length - 1];
    const acc = resolveAccount(settings, c2.accountId || lastHop?.accountId);
    // zone can be picked on the C2 node (c2.zoneId) or defaulted on the account
    if (!c2.zoneId && !acc.zoneId) {
      errors.push('C2: tunnel DNS needs a zone — pick one on the C2 node (or set the account default in Settings).');
    }
  } else {
    errors.push('C2: unknown mode ' + c2.mode);
  }

  if (!chain.hops.length) errors.push('Chain has no hops.');
  return { ok: errors.length === 0, errors, warnings };
}
