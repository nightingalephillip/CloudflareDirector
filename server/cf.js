const API_BASE = 'https://api.cloudflare.com/client/v4';

export class CloudflareError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class CF {
  constructor(token) {
    this.token = token;
  }

  async req(method, path, { json, form, query } = {}) {
    let url = API_BASE + path;
    if (query) url += '?' + new URLSearchParams(query).toString();
    const headers = { Authorization: 'Bearer ' + this.token };
    let body;
    if (json) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (form) {
      body = form; // global FormData in Node >= 18
    }
    const res = await fetch(url, { method, headers, body });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new CloudflareError(res.status, 0, 'Non-JSON response from Cloudflare (HTTP ' + res.status + ')');
    }
    if (!data.success) {
      const e = (data.errors && data.errors[0]) || {};
      throw new CloudflareError(res.status, e.code, e.message || 'Unknown Cloudflare error');
    }
    return data.result;
  }

  async reqSafe(method, path, opts) {
    try {
      return { ok: true, result: await this.req(method, path, opts) };
    } catch (err) {
      return { ok: false, error: err };
    }
  }

  // ---- account / zone ----
  verifyToken() {
    return this.req('GET', '/user/tokens/verify');
  }
  listAccounts() {
    return this.req('GET', '/accounts', { query: { per_page: 50 } });
  }
  listZones() {
    return this.req('GET', '/zones', { query: { per_page: 50 } });
  }

  // ---- workers ----
  listScripts(accountId) {
    return this.req('GET', `/accounts/${accountId}/workers/scripts`);
  }
  async uploadWorker(accountId, name, modules, metadata) {
    const form = new FormData();
    form.set('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }), 'metadata');
    for (const m of modules) {
      // ES-module parts must be typed application/javascript+module — plain
      // text/javascript makes Cloudflare parse them as classic scripts and
      // reject every `export` with "Unexpected token"
      const type = m.type || 'application/javascript+module';
      form.set(m.name, new Blob([m.content], { type }), m.name);
    }
    return this.req('PUT', `/accounts/${accountId}/workers/scripts/${encodeURIComponent(name)}`, { form });
  }
  async deleteScript(accountId, name) {
    return this.req('DELETE', `/accounts/${accountId}/workers/scripts/${encodeURIComponent(name)}?force=true`);
  }
  // best-effort: some accounts/plans reject this; preview URLs are a minor fingerprint either way
  async disablePreviewUrls(accountId, name) {
    const r = await this.reqSafe(
      'PATCH',
      `/accounts/${accountId}/workers/scripts/${encodeURIComponent(name)}/settings`,
      { json: { preview_urls: false } }
    );
    return r.ok;
  }
  enableWorkersDev(accountId, name) {
    return this.req('POST', `/accounts/${accountId}/workers/scripts/${encodeURIComponent(name)}/subdomain`, {
      json: { enabled: true },
    });
  }
  listCustomDomains(accountId) {
    return this.req('GET', `/accounts/${accountId}/workers/domains`);
  }
  addCustomDomain(accountId, { zoneId, hostname, service }) {
    return this.req('PUT', `/accounts/${accountId}/workers/domains`, {
      json: { zone_id: zoneId, hostname, service, environment: 'production' },
    });
  }
  deleteCustomDomain(accountId, domainId) {
    return this.req('DELETE', `/accounts/${accountId}/workers/domains/${domainId}`);
  }

  // ---- tunnels ----
  createTunnel(accountId, name) {
    // remote-managed tunnel: ingress config lives in the Cloudflare API
    return this.req('POST', `/accounts/${accountId}/cfd_tunnel`, {
      json: { name, config_src: 'cloudflare' },
    });
  }
  tunnelToken(accountId, tunnelId) {
    return this.req('GET', `/accounts/${accountId}/cfd_tunnel/${tunnelId}/token`);
  }
  putTunnelConfig(accountId, tunnelId, config) {
    return this.req('PUT', `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, { json: { config } });
  }
  listTunnels(accountId) {
    return this.req('GET', `/accounts/${accountId}/cfd_tunnel`, { query: { is_deleted: 'false', per_page: 50 } });
  }
  deleteTunnel(accountId, tunnelId) {
    return this.req('DELETE', `/accounts/${accountId}/cfd_tunnel/${tunnelId}`);
  }

  dropTunnelConnections(accountId, tunnelId) {
    // a tunnel that still has connections registered (a live cloudflared, or
    // stale rows from a connector that died uncleanly) refuses deletion —
    // drop them first. A running service reconnects within seconds.
    return this.req('DELETE', `/accounts/${accountId}/cfd_tunnel/${tunnelId}/connections`);
  }

  // ---- dns ----
  createDnsRecord(zoneId, { name, target }) {
    return this.req('POST', `/zones/${zoneId}/dns_records`, {
      json: { type: 'CNAME', name, content: target, proxied: true, ttl: 1 },
    });
  }
  listDnsRecords(zoneId, name) {
    return this.req('GET', `/zones/${zoneId}/dns_records`, { query: { name, per_page: 20 } });
  }
  deleteDnsRecord(zoneId, recordId) {
    return this.req('DELETE', `/zones/${zoneId}/dns_records/${recordId}`);
  }

  // ---- token doctor: soft-probe every permission the tool needs ----
  async doctor() {
    const checks = [];
    const push = (name, ok, hint, detail) => checks.push({ name, ok, hint, detail: detail || undefined });

    const verify = await this.reqSafe('GET', '/user/tokens/verify');
    if (verify.ok) {
      push('Token valid', true, '', 'Status: ' + (verify.result.status || 'active'));
    } else if (verify.error.status === 404 || verify.error.status === 400) {
      // account-owned tokens can't call user endpoints — not fatal
      push('Token valid (skipped)', true, '', 'Account-owned token; user verify endpoint unavailable');
    } else {
      push('Token valid', false, 'Create a new token or fix the stored credential', verify.error.message);
      return { ok: false, checks };
    }

    const accounts = await this.reqSafe('GET', '/accounts', { query: { per_page: 50 } });
    push(
      'Account: Read',
      accounts.ok,
      'Add "Account Settings: Read" to the token',
      accounts.ok ? accounts.result.length + ' account(s) visible' : accounts.error.message
    );
    if (!accounts.ok) return { ok: false, checks };
    const accountId = accounts.result[0]?.id;

    const scripts = accountId
      ? await this.reqSafe('GET', `/accounts/${accountId}/workers/scripts`)
      : { ok: false, error: new CloudflareError(0, 0, 'no account') };
    push(
      'Workers Scripts: Read/Edit',
      scripts.ok,
      'Add "Workers Scripts: Edit" to the token',
      scripts.ok ? scripts.result.length + ' existing script(s)' : scripts.error.message
    );

    const domains = accountId
      ? await this.reqSafe('GET', `/accounts/${accountId}/workers/domains`)
      : { ok: false, error: new CloudflareError(0, 0, 'no account') };
    push(
      'Workers Custom Domains: Read/Edit',
      domains.ok,
      'Add "Workers Custom Domains: Edit" to the token',
      domains.ok ? domains.result.length + ' existing domain(s)' : domains.error.message
    );

    const zones = await this.reqSafe('GET', '/zones', { query: { per_page: 50 } });
    push(
      'Zone: Read + DNS: Edit',
      zones.ok,
      'Add "Zone: Read" and "DNS: Edit" (All zones) to the token',
      zones.ok ? zones.result.map((z) => z.name).join(', ') || 'no zones' : zones.error.message
    );

    const tunnels = accountId
      ? await this.reqSafe('GET', `/accounts/${accountId}/cfd_tunnel`, { query: { is_deleted: 'false', per_page: 5 } })
      : { ok: false, error: new CloudflareError(0, 0, 'no account') };
    push(
      'Cloudflare Tunnel: Edit (tunnel mode only)',
      tunnels.ok,
      'Add "Cloudflare Tunnel: Edit" if you want the tool to provision tunnels',
      tunnels.ok ? tunnels.result.length + ' tunnel(s)' : tunnels.error.message
    );

    return { ok: checks.every((c) => c.ok), checks, accounts: accounts.result, zones: zones.ok ? zones.result : [] };
  }
}
