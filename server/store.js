import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const STATE_PATH =
  process.env.CFR_STATE_FILE || path.join(ROOT, 'data', 'state.json');

export function newId(prefix = '') {
  return prefix + crypto.randomBytes(8).toString('hex');
}

export function randomSecret() {
  return crypto.randomBytes(24).toString('hex');
}

// deployed script names stay neutral; pretty names live only in state/GUI
export function neutralWorkerName() {
  return 'edge-' + crypto.randomBytes(5).toString('hex');
}

export function slugify(s) {
  return (
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'hop'
  );
}

const HEADER_POOL = ['X-Visitor-Id', 'X-Client-Tag', 'X-Request-Tag', 'X-Session-Ref', 'X-App-Ref', 'X-Edge-Id'];
export function pickHeaderName(exclude = []) {
  const pool = HEADER_POOL.filter((h) => !exclude.includes(h));
  const list = pool.length ? pool : HEADER_POOL;
  return list[Math.floor(Math.random() * list.length)];
}

export function defaultState() {
  return {
    version: 1,
    settings: { accounts: [], apiToken: '', accountId: '', workersDevSubdomain: '', zoneId: '' },
    chains: [],
    operations: [],
  };
}

// An operation groups the chains of one red-team setup: a tasking lane and a
// staging lane that share nothing but the name. Each lane is a full chain
// (hops + C2 + deploy lifecycle); the operation is the grouping + one-click
// actions across both. Chains without an opId are standalone.
export function newOperation(name) {
  return { id: newId('o'), name: name || 'operation', createdAt: new Date().toISOString() };
}

// One Cloudflare account = { id, label, apiToken, accountId, workersDevSubdomain, zoneId, burner }.
// accounts[0] is the primary; hops without an explicit accountId live there.
export function normalizeSettings(raw) {
  const s = { ...raw };
  s.accounts = Array.isArray(s.accounts) ? s.accounts.filter(Boolean) : [];
  s.accounts = s.accounts.map((a) => ({ ...a, burner: !!a.burner }));
  // accounts[0] is the default for hops — the burner concept doesn't apply to it
  if (s.accounts[0]) s.accounts[0] = { ...s.accounts[0], burner: false };
  // migrate the legacy single-account fields into accounts[0]
  if (!s.accounts.length && (s.apiToken || s.accountId)) {
    s.accounts = [
      {
        id: 'primary',
        label: 'Primary account',
        apiToken: s.apiToken || '',
        accountId: s.accountId || '',
        workersDevSubdomain: s.workersDevSubdomain || '',
        zoneId: s.zoneId || '',
      },
    ];
  }
  // keep the legacy mirror pointed at the primary for older code paths
  const p = s.accounts[0];
  if (p) {
    s.apiToken = p.apiToken;
    s.accountId = p.accountId;
    s.workersDevSubdomain = p.workersDevSubdomain || s.workersDevSubdomain || '';
    s.zoneId = p.zoneId || s.zoneId || '';
  }
  return s;
}

export function resolveAccount(settings, accountId) {
  const accounts = settings.accounts || [];
  if (accountId) {
    const hit = accounts.find((a) => a.id === accountId);
    if (hit) return hit;
  }
  if (accounts.length) return accounts[0];
  return {
    id: 'primary',
    label: 'Primary',
    apiToken: settings.apiToken || '',
    accountId: settings.accountId || '',
    workersDevSubdomain: settings.workersDevSubdomain || '',
    zoneId: settings.zoneId || '',
  };
}

export function sameAccount(settings, aId, bId) {
  const a = resolveAccount(settings, aId);
  const b = resolveAccount(settings, bId);
  if (a === b) return true;
  return (a.id && a.id === b.id) || (a.accountId && a.accountId === b.accountId);
}

export function newHop(index, existing = []) {
  return {
    id: newId('h'),
    name: 'Hop ' + (index + 1),
    workerName: neutralWorkerName(),
    accountId: '', // '' = primary account
    secretHeader: pickHeaderName(existing.map((h) => h.secretHeader)),
    secretValue: randomSecret(),
    exposure: 'workers_dev', // workers_dev | custom | none
    customDomain: '',
    zoneId: '', // zone the custom domain lives in; '' = the account's default zone
    gateMode: 'disguise', // disguise | 401 | 404
    disguise: 'portfolio', // template id or 'custom'
    disguiseCustom: '',
    observability: false,
  };
}

// Account placement is positional by default — this is the single source of
// truth and is re-applied on every chain read/write:
//   1 hop  -> primary account
//   2+ hops -> hop 1 (the disposable front) on the first burner account,
//              backbone hops on the primary
// With no burner configured everything lands on the primary.
// A hop with accountPinned set is a manual override and is left untouched.
export function applyAccountPolicy(chain, settings) {
  const accounts = settings?.accounts || [];
  const primaryId = accounts[0]?.id || '';
  const burnerId = accounts.find((a) => a.burner)?.id || '';
  const frontId = chain.hops.length > 1 && burnerId ? burnerId : primaryId;
  chain.hops.forEach((h, i) => {
    if (h.accountPinned) return;
    h.accountId = i === 0 ? frontId : primaryId;
  });
  return chain;
}

export function newChain(name) {
  return {
    id: newId('c'),
    name: name || 'chain-' + crypto.randomBytes(2).toString('hex'),
    opId: '', // '' = standalone; else the operation this lane belongs to
    laneName: '', // 'tasking' | 'staging' when part of an operation
    transport: 'http', // http | ws  (ws chains forward hop-to-hop via fetch)
    hops: [newHop(0)],
    c2: {
      mode: 'direct', // direct | tunnel
      accountId: '', // where the tunnel + DNS live; '' = last hop's account
      zoneId: '', // DNS zone for the tunnel CNAME; '' = account default, then token auto-detect
      url: '', // direct mode: listener URL
      hostname: '', // tunnel mode: public hostname of the listener
      localService: 'http://127.0.0.1:8443', // cloudflared ingress target on the C2 box
      noTLSVerify: false, // listener serves HTTPS with a self-signed cert
      tunnelId: '',
      dnsRecordId: '',
      cfAccessId: '',
      cfAccessSecret: '',
      keepXFF: false,
    },
    quarantined: false,
    createdAt: new Date().toISOString(),
    lastDeploy: null,
  };
}

export function loadState() {
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf8');
    const state = JSON.parse(raw);
    const def = defaultState();
    const merged = {
      ...def,
      ...state,
      settings: normalizeSettings({ ...def.settings, ...(state.settings || {}) }),
      chains: Array.isArray(state.chains) ? state.chains : [],
      operations: Array.isArray(state.operations) ? state.operations : [],
    };
    // positional account policy holds everywhere; normalized in memory so
    // every route sees a consistent chain (persists on the next save)
    for (const c of merged.chains) applyAccountPolicy(c, merged.settings);
    // v1 operations named their lanes tasking/staging — the roles are now
    // called listener/stager; rename in memory, persists on the next save
    const LANE_RENAME = { tasking: 'listener', staging: 'stager' };
    for (const c of merged.chains) {
      if (c.laneName && LANE_RENAME[c.laneName]) {
        c.laneName = LANE_RENAME[c.laneName];
        // only touch auto-generated names ("<op> / tasking") — leave customs
        c.name = c.name.replace(/ \/ (tasking|staging)$/, (m) => ' / ' + LANE_RENAME[m.slice(3)]);
      }
    }
    return merged;
  } catch (err) {
    if (err.code === 'ENOENT') return defaultState();
    if (err instanceof SyntaxError) {
      throw new Error(`State file at ${STATE_PATH} is not valid JSON: ${err.message}`);
    }
    throw err;
  }
}

export function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  const tmp = STATE_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_PATH);
  try {
    fs.chmodSync(STATE_PATH, 0o600);
  } catch {
    // POSIX-only; Windows ACLs are enforced by the user profile directory
  }
}
