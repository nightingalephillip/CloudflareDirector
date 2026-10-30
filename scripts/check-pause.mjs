// Dev check: pause/bypass routing + validation rules (no Cloudflare calls)
import { buildHopUpload } from '../server/template.js';
import { validateChain } from '../server/validate.js';

const settings = {
  accounts: [
    { id: 'primary', label: 'Primary', accountId: 'acctA', apiToken: 't', workersDevSubdomain: 'a.workers.dev', zoneId: 'z1' },
    { id: 'burner1', label: 'burner-1', accountId: 'acctB', apiToken: 't2', workersDevSubdomain: 'b.workers.dev', zoneId: 'z1', burner: true },
  ],
};

const mkHop = (name, over = {}) => ({
  id: 'h' + name,
  name,
  workerName: 'edge-' + name.toLowerCase(),
  accountId: '',
  secretHeader: 'X-Visitor-Id',
  secretValue: 's'.repeat(48),
  exposure: 'workers_dev',
  customDomain: '',
  gateMode: 'disguise',
  disguise: 'portfolio',
  disguiseCustom: '',
  observability: false,
  paused: false,
  ...over,
});

const chain = {
  id: 'c1',
  name: 't',
  transport: 'http',
  hops: [mkHop('one'), mkHop('two', { paused: true }), mkHop('three')],
  c2: { mode: 'direct', url: 'https://c2.example:8443', hostname: '', localService: '', tunnelId: '', dnsRecordId: '', cfAccessId: '', cfAccessSecret: '', keepXFF: false },
  quarantined: false,
};

let fails = 0;
const check = (label, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + label + (cond ? '' : ' ' + extra));
  if (!cond) fails++;
};

// hop 1 must skip the paused hop 2 and bind straight to hop 3
const up0 = buildHopUpload(chain, 0, settings);
const svc = up0.metadata.bindings.find((b) => b.name === 'NEXT');
check('hop1 NEXT service binding -> hop 3 worker', svc?.service === 'edge-three', JSON.stringify(svc));
const sec = up0.metadata.bindings.find((b) => b.name === 'NEXT_SECRET');
check('hop1 NEXT_SECRET is hop 3 secret', sec?.text === 's'.repeat(48));
check('hop1 not last', up0.metadata.bindings.find((b) => b.name === 'IS_LAST')?.text === '0');

// paused hop deploys killswitched
const up1 = buildHopUpload(chain, 1, settings);
check('paused hop KILLSWITCH=1', up1.metadata.bindings.find((b) => b.name === 'KILLSWITCH')?.text === '1');

// last active hop targets the C2
const up2 = buildHopUpload(chain, 2, settings);
check('hop3 IS_LAST=1', up2.metadata.bindings.find((b) => b.name === 'IS_LAST')?.text === '1');
check('hop3 NEXT_URL -> C2', up2.metadata.bindings.find((b) => b.name === 'NEXT_URL')?.text === 'https://c2.example:8443');

// validation: pause chain is ok; hop 1 on primary while burner exists -> warning
const v = validateChain(chain, settings);
check('validate ok with paused middle hop', v.ok, JSON.stringify(v.errors));
check('front-on-primary warning present', v.warnings.some((w) => w.includes('burner-1')), JSON.stringify(v.warnings));

// hop 1 can't be paused
const v2 = validateChain({ ...chain, hops: [mkHop('one', { paused: true }), mkHop('two'), mkHop('three')] }, settings);
check('hop1 paused rejected', !v2.ok && v2.errors.some((e) => e.includes("can't be paused")), JSON.stringify(v2.errors));

// paused hop with a broken account doesn't block validation
const v3 = validateChain({ ...chain, hops: [mkHop('one', { accountId: 'burner1' }), mkHop('two', { paused: true }), mkHop('three', { accountId: 'nope' })] }, settings);
check('paused hop account not checked', !v3.errors.some((e) => e.includes('Hop 2')), JSON.stringify(v3.errors));

// effective path skips exposure requirements for paused hops
const v4 = validateChain({ ...chain, hops: [mkHop('one'), mkHop('two', { paused: true, exposure: 'none' }), mkHop('three')] }, settings);
check('paused hop exposure ignored', !v4.errors.some((e) => e.includes('Hop 2')), JSON.stringify(v4.errors));

console.log(fails ? `\n${fails} FAILURES` : '\nall good');
process.exit(fails ? 1 : 0);
