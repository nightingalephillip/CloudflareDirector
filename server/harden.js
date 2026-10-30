import crypto from 'node:crypto';

function deny(res, msg, status = 403) {
  res.status(status).json({ error: msg });
}

// Blocks CSRF / DNS-rebinding: every request must carry a Host header we
// expect, and browsers' cross-site Origin/Referer must not point elsewhere.
// Remote mode additionally requires a shared secret on every API call.
export function harden({ allowedHosts, remoteToken }) {
  return (req, res, next) => {
    const host = String(req.headers.host || '').toLowerCase();
    if (allowedHosts && !allowedHosts.includes(host)) {
      return deny(res, 'Unexpected Host header');
    }

    const checkUrl = (raw, label) => {
      try {
        const u = new URL(raw);
        if (allowedHosts && !allowedHosts.includes(u.host.toLowerCase())) {
          deny(res, 'Unexpected ' + label);
          return false;
        }
        return true;
      } catch {
        return true; // malformed Origin/Referer: ignore rather than break curl clients
      }
    };

    const origin = req.headers.origin;
    if (origin && !checkUrl(origin, 'Origin')) return;
    const referer = req.headers.referer;
    if (referer && !checkUrl(referer, 'Referer')) return;

    if (remoteToken) {
      const provided = String(req.get('x-session-token') || '');
      const a = Buffer.from(provided);
      const b = Buffer.from(remoteToken);
      const ok =
        a.length === b.length && crypto.timingSafeEqual(a, b);
      if (!ok) return deny(res, 'Unauthorized', 401);
    }

    next();
  };
}
