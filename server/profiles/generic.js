import { requireHop1 } from './common.js';

// Framework-agnostic listener description: enough for any C2 that takes a
// URL + custom headers, plus a ready-to-paste curl smoke test.
export function build(chain, settings, options = {}) {
  const h = requireHop1(chain, settings, options);
  const ua = h.userAgent;
  const content = JSON.stringify(
    {
      _meta: {
        tool: 'cf-redirector-studio',
        chain: chain.name,
        generated: new Date().toISOString(),
        note: 'Point any HTTP(S) C2 listener config at callback_url. The secret header must be sent on every request.',
      },
      callback_url: h.url,
      http: {
        user_agent: ua,
        headers: [{ name: h.secretHeader, value: h.secretValue }],
      },
      notes: [
        'Only hop 1 is implant-facing; inner hops are unexposed workers.',
        'Rotate the secret from the GUI and redeploy hop 1 (and re-export) to invalidate leaked callbacks.',
      ],
    },
    null,
    2
  );

  return {
    framework: 'generic',
    filename: `${chain.name}-generic-http.json`,
    language: 'json',
    content,
    commands: [
      `# smoke test (expect 200 + your disguise page when the secret is wrong):`,
      `curl -s -o /dev/null -w "%{http_code}\\n" -H "${h.secretHeader}: ${h.secretValue}" ${h.url}/`,
    ],
    notes: [
      'Headers are injected by the implant on every callback.',
      'The probe path is never used by the implant — it is for the GUI "Test path" button.',
    ],
  };
}
