import crypto from 'node:crypto';
import { HOP_WORKER_SOURCE } from '../worker/hop-template.js';
import { getDisguiseHtml } from './disguise/index.js';
import { slugify, resolveAccount, sameAccount } from './store.js';

export const COMPAT_DATE = '2024-09-23';

// Public URL of a hop, or null when unexposed. Each hop resolves its own
// account, so its workers.dev subdomain comes from that account's settings.
export function hopUrl(hop, settings) {
  const acc = resolveAccount(settings, hop.accountId);
  if (hop.exposure === 'custom' && hop.customDomain) return 'https://' + hop.customDomain;
  if (hop.exposure === 'workers_dev' && acc.workersDevSubdomain) {
    return 'https://' + hop.workerName + '.' + acc.workersDevSubdomain.replace(/^https?:\/\//, '');
  }
  return null;
}

export function c2TargetUrl(chain) {
  if (chain.c2.mode === 'direct') return chain.c2.url;
  return chain.c2.hostname ? 'https://' + chain.c2.hostname : '';
}

export function firstHopUrl(chain, settings) {
  return chain.hops.length ? hopUrl(chain.hops[0], settings) : null;
}

// The effective path skips paused hops: the hop before a paused one routes
// straight to the next active hop (or the C2). Paused hops themselves deploy
// with KILLSWITCH=1, so any stray direct traffic gets the disguise page.
export function effectiveHops(chain) {
  return chain.hops.filter((h) => !h.paused);
}

export function nextActiveHop(chain, index) {
  for (let j = index + 1; j < chain.hops.length; j++) {
    if (!chain.hops[j].paused) return chain.hops[j];
  }
  return null;
}

// Builds the multipart upload for one hop: worker.js (shared source) +
// disguise.js (per-hop HTML module) + metadata with all bindings.
export function buildHopUpload(chain, index, settings) {
  const hop = chain.hops[index];
  const nextHop = nextActiveHop(chain, index);
  const isLast = !nextHop;
  // hop-to-hop uses a service binding only when both hops share an account
  // (bindings are same-account) and the chain isn't carrying websockets;
  // cross-account hops forward via public fetch to the next hop's URL
  const nextMode = nextHop
    ? chain.transport === 'ws' || !sameAccount(settings, hop.accountId, nextHop.accountId)
      ? 'fetch'
      : 'service'
    : 'fetch';

  const bindings = [
    { type: 'plain_text', name: 'SECRET_HEADER', text: hop.secretHeader },
    { type: 'secret_text', name: 'SECRET_VALUE', text: hop.secretValue },
    { type: 'plain_text', name: 'GATE_MODE', text: hop.gateMode || 'disguise' },
    { type: 'plain_text', name: 'KILLSWITCH', text: hop.paused || (chain.quarantined && index === 0) ? '1' : '0' },
    { type: 'plain_text', name: 'KEEP_XFF', text: chain.c2?.keepXFF ? '1' : '0' },
    { type: 'plain_text', name: 'NEXT_MODE', text: nextMode },
    { type: 'plain_text', name: 'IS_LAST', text: isLast ? '1' : '0' },
    { type: 'plain_text', name: 'HOP_SLUG', text: slugify(hop.name) },
  ];

  if (nextHop) {
    bindings.push({ type: 'plain_text', name: 'NEXT_HEADER', text: nextHop.secretHeader });
    bindings.push({ type: 'secret_text', name: 'NEXT_SECRET', text: nextHop.secretValue });
    if (nextMode === 'service') {
      bindings.push({ type: 'service', name: 'NEXT', service: nextHop.workerName, environment: 'production' });
    } else {
      const nextUrl = hopUrl(nextHop, settings);
      if (!nextUrl) throw new Error('Next hop "' + nextHop.name + '" has no public URL (required for fetch mode).');
      bindings.push({ type: 'plain_text', name: 'NEXT_URL', text: nextUrl });
    }
  } else {
    const target = c2TargetUrl(chain);
    if (!target) throw new Error('Final hop has no C2 target (configure the C2 node first).');
    bindings.push({ type: 'plain_text', name: 'NEXT_URL', text: target });
    if (chain.c2.cfAccessId) bindings.push({ type: 'plain_text', name: 'CF_ACCESS_ID', text: chain.c2.cfAccessId });
    if (chain.c2.cfAccessSecret) {
      bindings.push({ type: 'secret_text', name: 'CF_ACCESS_SECRET', text: chain.c2.cfAccessSecret });
    }
  }

  const modules = [
    { name: 'worker.js', content: HOP_WORKER_SOURCE },
    { name: 'disguise.js', content: 'export const DISGUISE_HTML = ' + JSON.stringify(getDisguiseHtml(hop)) + ';' },
  ];

  const metadata = {
    main_module: 'worker.js',
    compatibility_date: COMPAT_DATE,
    bindings,
    observability: { enabled: !!hop.observability },
  };

  return { name: hop.workerName, modules, metadata };
}

export function chainConfigHash(chain, settings) {
  // hash of everything that affects the deployed workers (secrets included)
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        hops: chain.hops,
        transport: chain.transport,
        quarantined: chain.quarantined,
        c2: chain.c2,
        workersDevSubdomain: settings.workersDevSubdomain,
        zoneId: settings.zoneId,
      })
    )
    .digest('hex');
}
