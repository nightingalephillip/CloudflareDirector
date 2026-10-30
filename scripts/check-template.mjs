// Dev check: builds hop uploads for every chain in state and syntax-checks
// the generated worker modules. Usage: node scripts/check-template.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadState, ROOT } from '../server/store.js';
import { buildHopUpload, hopUrl } from '../server/template.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'tmpcheck');
fs.mkdirSync(outDir, { recursive: true });

const state = loadState();
let failures = 0;

for (const chain of state.chains) {
  const fakeSettings = {
    ...state.settings,
    workersDevSubdomain: state.settings.workersDevSubdomain || 'check.workers.dev',
  };
  const checkChain = { ...chain, hops: chain.hops.map((h) => ({ ...h })) };
  // make the build succeed purely for syntax checking
  if (!checkChain.c2.url && !checkChain.c2.tunnelId) {
    checkChain.c2 = { ...checkChain.c2, mode: 'direct', url: 'https://c2-check.example.com:8443' };
  }
  for (let i = 0; i < checkChain.hops.length; i++) {
    let built;
    try {
      built = buildHopUpload(checkChain, i, fakeSettings);
    } catch (err) {
      console.log(`SKIP: ${chain.name} hop ${i + 1}: ${err.message}`);
      continue;
    }
    const { name, modules, metadata } = built;
    for (const m of modules) {
      fs.writeFileSync(path.join(outDir, m.name), m.content);
      try {
        execFileSync(process.execPath, ['--check', path.join(outDir, m.name)], { stdio: 'pipe' });
      } catch (err) {
        failures++;
        console.error(`SYNTAX FAIL (${chain.name} hop ${i + 1}) ${m.name}:`, err.stderr.toString());
      }
    }
    console.log(
      `ok: ${chain.name} hop ${i + 1} -> ${name} (${metadata.bindings.length} bindings, next=${checkChain.hops[i + 1] ? checkChain.hops[i + 1].workerName : 'C2'})`
    );
  }
  if (chain.hops[0]) console.log(`    hop1 url: ${hopUrl(chain.hops[0], fakeSettings)}`);
}

fs.rmSync(outDir, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
