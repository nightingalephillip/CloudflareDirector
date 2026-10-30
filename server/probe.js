import crypto from 'node:crypto';
import { firstHopUrl } from './template.js';
const PROBE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const PROBE_HEADER = 'x-rdr-probe';

// Fires a canary through hop 1's public URL. Each hop stamps
// x-rdr-hop-<slug>: ok onto the response (worker template.js), even on error
// paths, so "dead final hop" is distinguishable from "dead middle hop".
export async function probeChain(chain, state) {
  if (chain.hops[0]?.paused) {
    throw new Error('Hop 1 is paused — unpause it before probing.');
  }
  const eff = chain.hops.filter((h) => !h.paused); // paused hops are bypassed
  const url = firstHopUrl(chain, state.settings);
  if (!url) {
    throw new Error('First hop has no public URL — set its exposure to workers.dev or a custom domain.');
  }
  const hop1 = chain.hops[0];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const started = Date.now();
  let res;
  try {
    res = await fetch(url.replace(/\/$/, '') + '/rdr-probe-' + crypto.randomBytes(4).toString('hex'), {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent': PROBE_UA,
        [hop1.secretHeader]: hop1.secretValue,
        [PROBE_HEADER]: crypto.randomBytes(8).toString('hex'),
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: false,
      url,
      latencyMs: Date.now() - started,
      error: err.name === 'AbortError' ? 'Timed out after 15s' : err.message,
      hops: chain.hops.filter((h) => !h.paused).map((h) => ({ name: h.name, slug: slug(h.name), ok: false })),
      status: null,
    };
  }
  clearTimeout(timer);

  const stamps = new Set(
    Array.from(res.headers.keys())
      .filter((k) => k.toLowerCase().startsWith('x-rdr-hop-'))
      .map((k) => k.toLowerCase().slice('x-rdr-hop-'.length))
  );

  return {
    ok: true,
    url,
    latencyMs: Date.now() - started,
    status: res.status,
    hops: eff.map((h) => {
      const hopSlug = slug(h.name);
      return { name: h.name, slug: hopSlug, ok: stamps.has(hopSlug) };
    }),
    note:
      res.status >= 500
        ? 'Listener returned ' + res.status + ' — chain is wired but the C2 may be down.'
        : stamps.size === eff.length
          ? 'All hops responded.'
          : stamps.size === 0
            ? 'No hop stamps on the response — is hop 1 running the current worker?'
            : 'Chain broke partway — check the missing hops.',
  };
}

function slug(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'hop';
}
