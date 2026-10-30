// Dev check: exercises per-hop account logic without touching Cloudflare.
// Usage: node scripts/check-multi-account.mjs
import { loadState, normalizeSettings, resolveAccount, sameAccount } from '../server/store.js';
import { validateChain } from '../server/validate.js';
import { buildHopUpload, hopUrl } from '../server/template.js';

const state = loadState();
state.settings = normalizeSettings(state.settings);
const settings = state.settings;
const accounts = settings.accounts || [];

if (accounts.length < 2) {
  console.log('Need at least 2 accounts in settings for this check (add them via the UI or API first).');
  process.exit(0);
}

const [a, b] = accounts;
const hop = (i, overrides = {}) => ({
  id: 'h' + i,
  name: 'Hop ' + i,
  workerName: 'edge-test' + i,
  accountId: i === 2 ? b.id : a.id,
  secretHeader: 'X-Test',
  secretValue: 's'.repeat(48),
  exposure: i === 2 ? 'workers_dev' : 'workers_dev',
  gateMode: 'disguise',
  disguise: 'portfolio',
  ...overrides,
});

// hop1@A -> hop2@B -> hop3@B  (cross-account at hop1->hop2, then same-account)
const chain = {
  id: 'test',
  name: 'multi-acct-test',
  transport: 'http',
  hops: [hop(1), hop(2), hop(3, { accountId: b.id, exposure: 'none' })],
  c2: { mode: 'direct', url: 'https://c2.example.com:8443' },
};

const binding = (i, name) =>
  buildHopUpload(chain, i, settings).metadata.bindings.find((x) => x.name === name);

console.log('hop1 NEXT_MODE:', binding(0, 'NEXT_MODE').text, '(expect fetch — cross-account)');
console.log('hop1 NEXT_URL:', binding(0, 'NEXT_URL').text, '(expect hop2 url on account B)');
console.log('hop2 NEXT_MODE:', binding(1, 'NEXT_MODE').text, '(expect service — same account A)');
console.log('hop3 NEXT_URL:', binding(2, 'NEXT_URL').text, '(expect C2)');
console.log('hop2 url:', hopUrl(chain.hops[1], settings));

// now break it: hop2 unexposed while cross-account -> validation must complain
chain.hops[1].exposure = 'none';
const v = validateChain(chain, settings);
console.log('validation ok (expect false):', v.ok);
console.log('cross-account error present:', v.errors.some((e) => e.includes('different Cloudflare account')));
process.exit(0);
