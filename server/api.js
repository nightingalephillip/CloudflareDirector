import express from 'express';
import {
  loadState,
  saveState,
  newChain,
  newOperation,
  newHop,
  applyAccountPolicy,
  neutralWorkerName,
  pickHeaderName,
  randomSecret,
  slugify,
  newId,
  normalizeSettings,
  resolveAccount,
} from './store.js';
import { CF } from './cf.js';
import { validateChain } from './validate.js';
import { deployChain, destroyChain, destroyHop, setQuarantine, provisionTunnel, removeTunnel, chainStatus, c2Account } from './deploy.js';
import { probeChain } from './probe.js';
import { exportProfile } from './profiles/index.js';
import { TEMPLATES } from './disguise/index.js';

export const router = express.Router();

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    res.status(status).json({ error: err.message || String(err) });
  }
};

const findChain = (state, id) => {
  const chain = state.chains.find((c) => c.id === id);
  if (!chain) throw Object.assign(new Error('Chain not found: ' + id), { status: 404 });
  return chain;
};

function summarize(chain, operations = []) {
  const op = operations.find((o) => o.id === chain.opId);
  return {
    id: chain.id,
    name: chain.name,
    opId: chain.opId || '',
    opName: op?.name || '',
    laneName: chain.laneName || '',
    transport: chain.transport,
    hopCount: chain.hops.length,
    quarantined: chain.quarantined,
    c2Mode: chain.c2?.mode,
    lastDeploy: chain.lastDeploy,
  };
}

function sanitizeHop(hop, index, existing) {
  const h = { ...newHop(index, existing), ...(hop || {}) };
  h.id = hop?.id || h.id;
  h.workerName = (hop?.workerName || neutralWorkerName()).replace(/[^a-z0-9-]/gi, '').slice(0, 30) || neutralWorkerName();
  h.name = hop?.name || h.name;
  h.accountId = typeof hop?.accountId === 'string' ? hop.accountId : '';
  // pinned = manual account override; policy leaves pinned hops alone
  h.accountPinned = !!hop?.accountPinned;
  h.secretHeader = hop?.secretHeader || h.secretHeader;
  h.secretValue = hop?.secretValue || h.secretValue;
  h.exposure = ['workers_dev', 'custom', 'none'].includes(hop?.exposure) ? hop.exposure : 'workers_dev';
  h.customDomain = String(hop?.customDomain || '').toLowerCase();
  h.zoneId = typeof hop?.zoneId === 'string' ? hop.zoneId : '';
  h.gateMode = ['disguise', '401', '404'].includes(hop?.gateMode) ? hop.gateMode : 'disguise';
  h.disguise = hop?.disguise || 'portfolio';
  h.disguiseCustom = String(hop?.disguiseCustom || '');
  h.observability = !!hop?.observability;
  h.paused = !!hop?.paused;
  return h;
}

function sanitizeChain(body, existing) {
  const base = existing || newChain();
  const chain = { ...base };
  chain.name = String(body?.name ?? base.name).slice(0, 64) || base.name;
  chain.transport = body?.transport === 'ws' ? 'ws' : 'http';
  const hops = Array.isArray(body?.hops) ? body.hops.slice(0, 3) : base.hops;
  chain.hops = hops.map((h, i) => sanitizeHop(h, i, base.hops));
  const c2 = { ...(base.c2 || {}), ...(body?.c2 || {}) };
  c2.mode = c2.mode === 'tunnel' ? 'tunnel' : 'direct';
  c2.accountId = typeof c2.accountId === 'string' ? c2.accountId : '';
  c2.url = String(c2.url || '');
  c2.hostname = String(c2.hostname || '').toLowerCase();
  c2.localService = String(c2.localService || 'http://127.0.0.1:8443');
  c2.tunnelId = String(c2.tunnelId || '');
  c2.dnsRecordId = String(c2.dnsRecordId || '');
  c2.zoneId = String(c2.zoneId || '');
  c2.noTLSVerify = !!c2.noTLSVerify;
  c2.cfAccessId = String(c2.cfAccessId || '');
  c2.cfAccessSecret = String(c2.cfAccessSecret || '');
  c2.keepXFF = !!c2.keepXFF;
  chain.c2 = c2;
  chain.quarantined = !!body?.quarantined;
  chain.lastDeploy = body?.lastDeploy ?? base.lastDeploy;
  chain.opId = typeof body?.opId === 'string' ? body.opId : base.opId || '';
  chain.laneName = String(body?.laneName ?? base.laneName ?? '').slice(0, 24);
  if (!chain.id) chain.id = newId('c');
  return chain;
}

function redactSettings(state) {
  const s = normalizeSettings(state.settings);
  return {
    accounts: (s.accounts || []).map((a) => ({
      id: a.id,
      label: a.label,
      accountId: a.accountId,
      workersDevSubdomain: a.workersDevSubdomain,
      zoneId: a.zoneId,
      burner: !!a.burner,
      apiTokenSet: !!a.apiToken,
    })),
    apiTokenSet: !!s.apiToken, // legacy mirror of accounts[0]
  };
}

function sanitizeAccounts(existing, incoming) {
  const out = [];
  for (const [i, a] of (incoming || []).entries()) {
    const prev = existing.find((x) => x.id === a.id);
    out.push({
      id: prev?.id || newId('a'),
      label: String(a.label || '').slice(0, 40) || 'account',
      accountId: String(a.accountId || '').trim(),
      workersDevSubdomain: String(a.workersDevSubdomain || '').trim().replace(/^https?:\/\//, ''),
      zoneId: String(a.zoneId || '').trim(),
      burner: i > 0 && !!a.burner,
      apiToken: a.apiToken && String(a.apiToken).trim() ? String(a.apiToken).trim() : prev?.apiToken || '',
    });
  }
  return out.slice(0, 8);
}

// ---- misc ----
router.get('/health', (req, res) => res.json({ ok: true }));

router.get(
  '/disguise/templates',
  wrap(async (req, res) => {
    res.json(TEMPLATES);
  })
);

// ---- settings (API tokens are write-only) ----
router.get(
  '/settings',
  wrap(async (req, res) => {
    res.json(redactSettings(loadState()));
  })
);

router.put(
  '/settings',
  wrap(async (req, res) => {
    const state = loadState();
    const b = req.body || {};

    if (Array.isArray(b.accounts)) {
      // full replacement: match by id (empty apiToken keeps the stored one);
      // accounts absent from the payload are removed
      state.settings.accounts = sanitizeAccounts(state.settings.accounts || [], b.accounts);
    } else {
      // legacy single-account fields → apply to the primary account
      const acc = (state.settings.accounts || [])[0];
      if (acc) {
        if (typeof b.accountId === 'string') acc.accountId = b.accountId.trim();
        if (typeof b.workersDevSubdomain === 'string') acc.workersDevSubdomain = b.workersDevSubdomain.trim().replace(/^https?:\/\//, '');
        if (typeof b.zoneId === 'string') acc.zoneId = b.zoneId.trim();
        if (typeof b.apiToken === 'string' && b.apiToken.trim()) acc.apiToken = b.apiToken.trim();
      } else {
        state.settings.accounts = sanitizeAccounts([], [b]);
      }
      if (b.clearApiToken === true) {
        const a = (state.settings.accounts || [])[0];
        if (a) a.apiToken = '';
      }
    }

    state.settings = normalizeSettings(state.settings);
    // burner marks changed — re-seat every chain per the positional policy
    for (const c of state.chains) applyAccountPolicy(c, state.settings);
    saveState(state);
    res.json(redactSettings(state));
  })
);

router.get(
  '/doctor',
  wrap(async (req, res) => {
    const state = loadState();
    const acc = resolveAccount(state.settings, req.query.accountId || '');
    if (!acc.apiToken) throw new Error(`No API token configured for account "${acc.label || 'primary'}".`);
    const cf = new CF(acc.apiToken);
    const report = await cf.doctor();
    res.json({ ...report, accountId: acc.id, label: acc.label || 'primary' });
  })
);

// zones visible to one account's token — feeds the Settings zone picker and
// lets the UI ask "which zone?" by name instead of demanding a pasted id
router.get(
  '/accounts/:accId/zones',
  wrap(async (req, res) => {
    const state = loadState();
    const acc = (state.settings.accounts || []).find((a) => a.id === req.params.accId);
    if (!acc) throw new Error('No such account.');
    if (!acc.apiToken) throw new Error(`No API token stored for "${acc.label || 'account'}" yet — paste it and save first.`);
    const cf = new CF(acc.apiToken);
    const result = await cf.listZones().catch((err) => {
      throw new Error(`Cloudflare zone list failed for "${acc.label || 'primary'}": ${err.message}`);
    });
    const zones = (result || []).map((z) => ({ id: z.id, name: z.name, account: z.account?.id || '' }));
    res.json({ label: acc.label || 'primary', zones });
  })
);

// ---- chains CRUD ----
router.get(
  '/chains',
  wrap(async (req, res) => {
    const state = loadState();
    res.json(state.chains.map((c) => summarize(c, state.operations)));
  })
);

router.post(
  '/chains',
  wrap(async (req, res) => {
    const state = loadState();
    const chain = newChain((req.body && req.body.name) || undefined);
    applyAccountPolicy(chain, state.settings);
    state.chains.push(chain);
    saveState(state);
    res.status(201).json(chain);
  })
);

router.get(
  '/chains/:id',
  wrap(async (req, res) => {
    res.json(findChain(loadState(), req.params.id));
  })
);

router.put(
  '/chains/:id',
  wrap(async (req, res) => {
    const state = loadState();
    const chain = findChain(state, req.params.id);
    const updated = sanitizeChain(req.body, chain);
    updated.id = chain.id;
    updated.createdAt = chain.createdAt;
    // hops that were removed from a deployed chain leave their workers
    // orphaned in their accounts — tear them down best-effort
    const removedHops = chain.hops.filter((h) => !updated.hops.some((nh) => nh.id === h.id));
    const wasDeployed = !!chain.lastDeploy;
    // if the config that affects deployed workers changed, mark drift
    applyAccountPolicy(updated, state.settings);
    Object.assign(chain, updated);
    saveState(state);

    let cleanup = null;
    if (wasDeployed && removedHops.length) {
      cleanup = [];
      for (const h of removedHops) {
        const r = await destroyHop(state, h);
        cleanup.push({ hop: h.name, worker: h.workerName, removed: r.removed, errors: r.errors });
      }
    }
    res.json({ ...chain, cleanup });
  })
);

router.delete(
  '/chains/:id',
  wrap(async (req, res) => {
    const state = loadState();
    const chain = findChain(state, req.params.id);
    // deleting a chain burns everything it created in Cloudflare — workers,
    // custom domains, tunnel, DNS — so strays can't pile up on the accounts.
    // destroyHop tolerates absent workers, so this is safe to always run; if
    // the teardown fails the definition is KEPT so the delete can be retried.
    const teardown = await destroyChain(chain, state);
    if (teardown.errors.length) {
      res.status(502).json({
        error:
          'Teardown partially completed — already destroyed: ' +
          (teardown.removed.join(', ') || 'nothing') +
          '. Failed: ' +
          teardown.errors.join(' | ') +
          ' (if this is a running cloudflared connector, stop it on the C2 box first, then delete again) — the chain was NOT deleted so you can retry.',
      });
      return;
    }
    state.chains = state.chains.filter((c) => c.id !== chain.id);
    saveState(state);
    res.json({
      ok: true,
      removed: teardown.removed,
      note: 'Chain deleted; all of its Cloudflare resources were torn down.',
    });
  })
);

router.post(
  '/chains/:id/duplicate',
  wrap(async (req, res) => {
    const state = loadState();
    const src = findChain(state, req.params.id);
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = newId('c');
    copy.name = src.name + ' copy';
    // a copy is a standalone chain even if the source lived in an operation
    copy.opId = '';
    copy.laneName = '';
    copy.quarantined = false;
    copy.lastDeploy = null;
    copy.hops = copy.hops.map((h) => ({ ...h, id: newId('h'), workerName: neutralWorkerName() }));
    applyAccountPolicy(copy, state.settings);
    state.chains.push(copy);
    saveState(state);
    res.status(201).json(copy);
  })
);

router.post(
  '/chains/import',
  wrap(async (req, res) => {
    const state = loadState();
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
    const chain = sanitizeChain(body.chain || body, null);
    // imported chains get fresh ids and names; regenerate secrets that were redacted;
    // account references don't transfer across machines — the positional policy reassigns them
    chain.id = newId('c');
    chain.name = (chain.name || 'imported') + '-' + Math.random().toString(36).slice(2, 6);
    chain.opId = '';
    chain.laneName = '';
    chain.quarantined = false;
    chain.lastDeploy = null;
    for (const h of chain.hops) {
      if (!h.secretValue || h.secretValue.startsWith('<redacted')) h.secretValue = randomSecret();
      if (!h.secretHeader || h.secretHeader.startsWith('<redacted')) h.secretHeader = pickHeaderName(chain.hops.map((x) => x.secretHeader));
    }
    chain.c2.accountId = '';
    applyAccountPolicy(chain, state.settings);
    state.chains.push(chain);
    saveState(state);
    res.status(201).json(chain);
  })
);

// ---- operations: an op owns a tasking lane and a staging lane; each lane is
// a full chain. Deleting an op only ungroups — chains become standalone and
// deployed workers are never touched here.
router.post(
  '/operations',
  wrap(async (req, res) => {
    const state = loadState();
    const name = String(req.body?.name || '').trim().slice(0, 48) || 'operation';
    const op = newOperation(name);
    state.operations = Array.isArray(state.operations) ? state.operations : [];
    state.operations.push(op);
    const lanes = [
      { laneName: 'listener', label: 'listener' }, // implant callbacks (top row)
      { laneName: 'stager', label: 'stager' }, // payload retrieval (bottom row)
    ];
    const created = lanes.map(({ laneName, label }) => {
      const chain = newChain(`${name} / ${label}`);
      chain.opId = op.id;
      chain.laneName = laneName;
      applyAccountPolicy(chain, state.settings);
      state.chains.push(chain);
      return chain;
    });
    saveState(state);
    res.status(201).json({ operation: op, chains: created });
  })
);

router.delete(
  '/operations/:id',
  wrap(async (req, res) => {
    const state = loadState();
    const op = (state.operations || []).find((o) => o.id === req.params.id);
    if (!op) throw Object.assign(new Error('Operation not found: ' + req.params.id), { status: 404 });
    state.operations = state.operations.filter((o) => o.id !== op.id);
    let ungrouped = 0;
    for (const c of state.chains) {
      if (c.opId === op.id) {
        c.opId = '';
        c.laneName = '';
        ungrouped += 1;
      }
    }
    saveState(state);
    res.json({ ok: true, ungrouped, note: 'Operation removed; its chains are now standalone (deployed workers untouched).' });
  })
);

router.post(
  '/chains/:id/validate',
  wrap(async (req, res) => {
    const state = loadState();
    const base = findChain(state, req.params.id);
    // optional body: validate a draft against this chain's identity
    const chain = req.body && req.body.hops ? sanitizeChain(req.body, base) : base;
    res.json(validateChain(chain, state.settings));
  })
);

router.post(
  '/chains/:id/deploy',
  wrap(async (req, res) => {
    const state = loadState();
    const chain = findChain(state, req.params.id);
    const result = await deployChain(chain, state, { onlyIndex: req.body?.onlyIndex ?? null });
    saveState(state);
    res.json(result);
  })
);

router.post(
  '/chains/:id/destroy',
  wrap(async (req, res) => {
    const state = loadState();
    const chain = findChain(state, req.params.id);
    const result = await destroyChain(chain, state);
    saveState(state);
    res.json(result);
  })
);

router.post(
  '/chains/:id/quarantine',
  wrap(async (req, res) => {
    const state = loadState();
    const chain = findChain(state, req.params.id);
    const result = await setQuarantine(chain, state, true);
    saveState(state);
    res.json({ ...result, quarantined: true });
  })
);

router.post(
  '/chains/:id/release',
  wrap(async (req, res) => {
    const state = loadState();
    const chain = findChain(state, req.params.id);
    const result = await setQuarantine(chain, state, false);
    saveState(state);
    res.json({ ...result, quarantined: false });
  })
);

router.post(
  '/chains/:id/probe',
  wrap(async (req, res) => {
    const state = loadState();
    res.json(await probeChain(findChain(state, req.params.id), state));
  })
);

router.get(
  '/chains/:id/status',
  wrap(async (req, res) => {
    const state = loadState();
    res.json(await chainStatus(findChain(state, req.params.id), state));
  })
);

router.post(
  '/chains/:id/tunnel/provision',
  wrap(async (req, res) => {
    const state = loadState();
    const chain = findChain(state, req.params.id);
    const result = await provisionTunnel(chain, state);
    saveState(state);
    res.json(result);
  })
);

// the connector install command without re-provisioning — the panel shows it
// on load so the token never depends on a provision response surviving a reload
router.get(
  '/chains/:id/tunnel/token',
  wrap(async (req, res) => {
    const state = loadState();
    const chain = findChain(state, req.params.id);
    if (chain.c2.mode !== 'tunnel' || !chain.c2.tunnelId) {
      throw new Error('No provisioned tunnel on this chain.');
    }
    const acc = c2Account(state, chain);
    if (!acc.apiToken) throw new Error(`No API token for the tunnel account ("${acc.label || 'primary'}").`);
    const token = await new CF(acc.apiToken).tunnelToken(acc.accountId, chain.c2.tunnelId);
    res.json({ cloudflaredCmd: 'cloudflared tunnel run --token ' + token });
  })
);

router.post(
  '/chains/:id/tunnel/remove',
  wrap(async (req, res) => {
    const state = loadState();
    const chain = findChain(state, req.params.id);
    const result = await removeTunnel(chain, state);
    saveState(state);
    res.json(result);
  })
);

// ---- export ----
router.post(
  '/chains/:id/export',
  wrap(async (req, res) => {
    const state = loadState();
    const chain = findChain(state, req.params.id);
    const { framework, options } = req.body || {};
    res.json(exportProfile(framework, chain, state.settings, options || {}));
  })
);

// regenerate secrets for one hop (and its upstream, whose worker embeds it)
router.post(
  '/chains/:id/hops/:hopId/rotate',
  wrap(async (req, res) => {
    const state = loadState();
    const chain = findChain(state, req.params.id);
    const idx = chain.hops.findIndex((h) => h.id === req.params.hopId);
    if (idx === -1) throw new Error('Hop not found');
    chain.hops[idx].secretValue = randomSecret();
    if (typeof req.body?.headerName === 'string' && /^[A-Za-z0-9-]+$/.test(req.body.headerName)) {
      chain.hops[idx].secretHeader = req.body.headerName;
    }
    saveState(state);
    res.json(chain);
  })
);

export { summarize };
