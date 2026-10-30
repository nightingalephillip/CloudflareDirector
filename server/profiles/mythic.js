import { requireHop1 } from './common.js';

// Mythic HTTP profile (c2_instance) — standard Mythic HTTP profile JSON shape.
export function build(chain, settings, options = {}) {
  const h = requireHop1(chain, settings, options);
  const content = JSON.stringify(
    {
      c2profile_name: 'http',
      instance_name: 'cf-redirector-' + chain.name,
      c2_instance: {
        callback_host: h.url + '/',
        callback_interval: String(options.callbackInterval ?? '11'),
        callback_jitter: String(options.callbackJitter ?? '18'),
        callback_port: '443',
        AESPSK: 'aes256_hmac',
        get_uri: 'index',
        post_uri: 'data',
        query_path_name: 'q',
        ...(options.killdate ? { killdate: options.killdate } : {}),
        encrypted_exchange_check: 'true',
        proxy_host: '',
        proxy_pass: '',
        proxy_port: '',
        proxy_user: '',
        headers: [
          {
            name: 'User-Agent',
            value: h.userAgent,
            default_show: true,
            default_value: h.userAgent,
          },
          { name: h.secretHeader, value: h.secretValue, default_show: true },
        ],
      },
    },
    null,
    2
  );

  return {
    framework: 'mythic',
    filename: `${chain.name}-mythic.json`,
    language: 'json',
    content,
    commands: [`# Import as a new HTTP C2 profile instance in the Mythic UI, then generate an agent from it.`],
    notes: [
      'callback_host points at hop 1; inner hops are invisible to the implant.',
      'Keep AESPSK + encrypted_exchange_check enabled — the redirector is plaintext transport only.',
    ],
  };
}
