// Hop worker source — deployed identically to every hop; all per-hop
// configuration arrives via bindings (env). The disguise page is a second
// module (disguise.js) generated per hop to avoid env-var size limits.
//
// Config bindings:
//   SECRET_HEADER / SECRET_VALUE  incoming gate (timing-safe compared);
//                                 the secret may also arrive as the first URL
//                                 path segment (stripped before forwarding) for
//                                 agents that can't send custom headers
//   GATE_MODE                     'disguise' | '401' | '404' on gate failure
//   KILLSWITCH                    '1' => serve disguise to everything (quarantine)
//   NEXT_MODE                     'service' | 'fetch'
//   NEXT                          service binding to next hop (service mode)
//   NEXT_URL                      target URL (fetch mode; last hop => C2)
//   NEXT_HEADER / NEXT_SECRET     next hop's gate, injected by this hop
//   CF_ACCESS_ID / CF_ACCESS_SECRET  Zero Trust service auth (last hop, optional)
//   KEEP_XFF                      '1' => pass XFF/CF-IP headers through
//   IS_LAST                       '1' => strip probe marker before the listener
//   HOP_SLUG                      slug used in probe response stamps
export const HOP_WORKER_SOURCE = String.raw`
import { DISGUISE_HTML } from './disguise.js';

const PROBE_HEADER = 'x-rdr-probe';
const STAMP_PREFIX = 'x-rdr-hop-';
const CF_ERROR_STATUSES = new Set([502, 503, 504, 521, 522, 523, 524, 525, 527, 530]);
const ENC = new TextEncoder();

function safeEqual(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

// Gate = secret header OR the secret as the first URL path segment.
// Returns how many chars of the path to strip (secret segment + slash) so a
// path-authenticated request is forwarded to the listener with a clean path.
async function authCtx(request, env) {
  const { pathname } = new URL(request.url);
  const seg = pathname.split('/')[1] || '';
  const segOk = seg ? safeEqual(ENC.encode(seg), ENC.encode(env.SECRET_VALUE)) : false;
  if (segOk) return { authed: true, stripLen: seg.length + 1 };
  const provided = request.headers.get(env.SECRET_HEADER);
  const hdrOk = provided ? safeEqual(ENC.encode(provided), ENC.encode(env.SECRET_VALUE)) : false;
  return { authed: hdrOk, stripLen: 0 };
}

function disguiseResponse(env) {
  return new Response(DISGUISE_HTML, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer'
    }
  });
}

function gateFailResponse(env) {
  const mode = env.GATE_MODE || 'disguise';
  if (mode === '401') return new Response('401 Unauthorized', { status: 401, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  if (mode === '404') return new Response('404 Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  return disguiseResponse(env);
}

function sanitizeHeaders(request, env) {
  const h = new Headers(request.headers);
  const probe = h.get(PROBE_HEADER);
  // strip any client-supplied X-RDR-* (probe stamps are added on responses only),
  // then restore the probe marker we captured so it can traverse the chain
  for (const k of Array.from(h.keys())) {
    if (k.toLowerCase().startsWith('x-rdr-')) h.delete(k);
  }
  if (probe) h.set(PROBE_HEADER, probe);
  h.delete(env.SECRET_HEADER);
  if (env.KEEP_XFF !== '1') {
    h.delete('cf-connecting-ip');
    h.delete('x-forwarded-for');
    h.delete('x-forwarded-proto');
    h.delete('x-real-ip');
  }
  if (env.NEXT_HEADER) h.set(env.NEXT_HEADER, env.NEXT_SECRET);
  if (env.CF_ACCESS_ID) h.set('CF-Access-Client-Id', env.CF_ACCESS_ID);
  if (env.CF_ACCESS_SECRET) h.set('CF-Access-Client-Secret', env.CF_ACCESS_SECRET);
  if (env.IS_LAST === '1') h.delete(PROBE_HEADER);
  return h;
}

function stamp(resp, env, probeSeen) {
  if (!probeSeen || resp.status === 101 || resp.webSocket) return resp;
  try {
    const h = new Headers(resp.headers);
    h.set(STAMP_PREFIX + env.HOP_SLUG, 'ok');
    return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
  } catch (err) {
    return resp;
  }
}

export default {
  async fetch(request, env) {
    const probeSeen = request.headers.get(PROBE_HEADER) !== null;

    if (env.KILLSWITCH === '1') return stamp(disguiseResponse(env), env, probeSeen);
    const { authed, stripLen } = await authCtx(request, env);
    if (!authed) return stamp(gateFailResponse(env), env, probeSeen);

    const headers = sanitizeHeaders(request, env);
    const init = { method: request.method, headers, redirect: 'manual' };
    if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body;

    const inc = new URL(request.url);
    // a path-authenticated request loses its secret segment here
    inc.pathname = stripLen ? inc.pathname.slice(stripLen) || '/' : inc.pathname;

    let target;
    if (env.NEXT_MODE === 'service') {
      target = inc.toString();
    } else {
      const u = new URL(env.NEXT_URL);
      u.pathname = inc.pathname;
      u.search = inc.search;
      target = u.toString();
    }

    let resp;
    try {
      resp = env.NEXT_MODE === 'service'
        ? await env.NEXT.fetch(new Request(target, init))
        : await fetch(new Request(target, init));
    } catch (err) {
      return stamp(disguiseResponse(env), env, probeSeen);
    }
    // never leak Cloudflare-branded infrastructure error pages to anyone
    if (CF_ERROR_STATUSES.has(resp.status)) return stamp(disguiseResponse(env), env, probeSeen);
    return stamp(resp, env, probeSeen);
  }
};
`;
