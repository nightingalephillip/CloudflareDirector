import { firstHopUrl } from '../template.js';

export const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Resolves hop 1's public URL and gate header/value for exporters.
export function requireHop1(chain, settings, options = {}) {
  const url = firstHopUrl(chain, settings);
  if (!url) {
    throw new Error('First hop has no public URL — set its exposure to workers.dev or a custom domain first.');
  }
  const hop1 = chain.hops[0];
  return {
    url,
    host: hostOnly(url),
    secretHeader: hop1.secretHeader,
    secretValue: options.includeSecrets === false ? '<redacted — set includeSecrets to true>' : hop1.secretValue,
    userAgent: options.userAgent || DEFAULT_UA,
  };
}

export function hostOnly(url) {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}
