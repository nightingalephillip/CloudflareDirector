// Dev helper: print chain list or one chain's hop1 info. Usage:
//   node scripts/chain-info.mjs [chainId]
import { loadState } from '../server/store.js';

const state = loadState();
const id = process.argv[2];

if (!id) {
  for (const c of state.chains) console.log(c.id, c.name, `${c.hops.length} hops`);
} else {
  const c = state.chains.find((x) => x.id === id);
  if (!c) {
    console.error('not found:', id);
    process.exit(1);
  }
  console.log('name:', c.name);
  for (const h of c.hops) {
    console.log(`  ${h.name} | worker=${h.workerName} | header=${h.secretHeader} | secret=${h.secretValue.slice(0, 16)}…`);
  }
}
