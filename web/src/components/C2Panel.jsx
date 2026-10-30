import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function C2Panel({ chain, setDraft, saveChain, run, notify, status, accounts = [], refreshStatus, askConfirm }) {
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [tunnelCmd, setTunnelCmd] = useState('');
  const [zones, setZones] = useState([]);
  const [zoneNote, setZoneNote] = useState('');
  const c2 = chain.c2;

  // the URL an implant actually points at: hop 1's public URL with the gate
  // secret as the first path segment — the worker strips that segment before
  // forwarding, so agents without header support (nox) need this exact form
  const hop1 = chain.hops[0];
  const hop1Url = hop1 ? status?.hops?.[hop1.id]?.url : null;
  const payloadUrl = hop1 && hop1Url ? hop1Url.replace(/\/+$/, '') + '/' + hop1.secretValue : null;
  const payloadLabel =
    chain.laneName === 'stager' || chain.laneName === 'staging'
      ? 'staging_url — paste into the Mythic payload build'
      : chain.laneName === 'listener' || chain.laneName === 'tasking'
        ? 'c2_url — paste into the Mythic payload build'
        : 'Implant callback URL (path-token form)';
  const [copiedUrl, setCopiedUrl] = useState(false);
  const copyPayloadUrl = async () => {
    if (!payloadUrl) return;
    try {
      await navigator.clipboard.writeText(payloadUrl);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = payloadUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 1200);
  };

  // manual re-check of the connector/tunnel state (auto-poll also runs at 10s)
  const checkTunnel = async () => {
    setChecking(true);
    try {
      await refreshStatus();
    } finally {
      setTimeout(() => setChecking(false), 400);
    }
  };

  // the connector command should survive reloads: fetch the token on demand
  // instead of only showing it in the provision response
  useEffect(() => {
    if (c2.mode !== 'tunnel' || !c2.tunnelId) return undefined;
    let live = true;
    api
      .get(`/chains/${chain.id}/tunnel/token`)
      .then((r) => {
        if (live) setTunnelCmd(r.cloudflaredCmd);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [chain.id, c2.mode, c2.tunnelId]);

  const lastHopAccount = chain.hops[chain.hops.length - 1]?.accountId || '';
  const accLabel = (id) => {
    const a = accounts.find((x) => x.id === (id || lastHopAccount));
    return a ? a.label || a.accountId : 'primary';
  };

  const set = (patch) => setDraft((c) => ({ ...c, c2: { ...c.c2, ...patch } }));

  // picking a zone rewrites the hostname's domain part: keep the prefix the
  // user typed, swap everything after the dot. The lane's role seeds the
  // default prefix (stager lane → stager.<zone>), and a leftover 'listener'
  // prefix on the stager lane is treated as stale autofill and reseeded —
  // two lanes of one operation must never share a public hostname.
  const lanePrefix = /stager|staging/i.test(chain.laneName || '') ? 'stager' : 'listener';

  const pickZone = (zoneId) => {
    const zoneName = zones.find((z) => z.id === zoneId)?.name;
    if (!zoneName) return set({ zoneId });
    const known = zones.map((z) => z.name.toLowerCase());
    let host = (c2.hostname || '').trim().replace(/\.$/, '');
    const low = host.toLowerCase();
    for (const k of known) {
      if (low === k) {
        host = '';
        break;
      }
      if (low.endsWith('.' + k)) {
        host = host.slice(0, host.length - k.length - 1);
        break;
      }
    }
    let prefix = host.split('.')[0].trim();
    if (!prefix || (lanePrefix === 'stager' && prefix === 'listener')) prefix = lanePrefix;
    set({ zoneId, hostname: prefix + '.' + zoneName });
  };

  // zones visible to whichever account holds the tunnel — reloaded when the
  // account or mode changes
  const effAccId = c2.accountId || lastHopAccount || 'primary';
  useEffect(() => {
    if (c2.mode !== 'tunnel') return undefined;
    let live = true;
    setZoneNote('');
    api
      .get('/accounts/' + encodeURIComponent(effAccId) + '/zones')
      .then((r) => {
        if (!live) return;
        setZones(r.zones || []);
        if (!(r.zones || []).length) setZoneNote(`The "${r.label}" token can see no zones — tunnel DNS needs Zone: Read on the token.`);
      })
      .catch((err) => {
        if (live) {
          setZones([]);
          setZoneNote(err.message);
        }
      });
    return () => {
      live = false;
    };
  }, [effAccId, c2.mode]);

  const provision = async () => {
    setPending(true);
    try {
      await saveChain();
      const r = await run('Provisioning tunnel', () => api.post(`/chains/${chain.id}/tunnel/provision`));
      if (r) {
        // adopt the provisioned fields into the draft — the status/command
        // sections key off c2.tunnelId and would stay hidden (and a later
        // autosave would erase the auto-resolved zone) until a refetch
        setDraft((c) => ({
          ...c,
          c2: { ...c.c2, tunnelId: r.tunnelId, dnsRecordId: r.dnsRecordId, zoneId: r.zoneId || c.c2.zoneId },
        }));
        setTunnelCmd(r.cloudflaredCmd);
        notify('ok', 'Tunnel provisioned — run the cloudflared command on the C2 box');
        await refreshStatus();
      }
    } finally {
      setPending(false);
    }
  };

  const removeTunnel = async () => {
    // in-app confirm — native confirm() is unreliable and breaks the UI convention
    if (!(await askConfirm('Remove tunnel', 'Remove the tunnel, its DNS record, and the connector config?', 'Remove')))
      return;
    setPending(true);
    try {
      const r = await run('Removing tunnel', () => api.post(`/chains/${chain.id}/tunnel/remove`), {
        success: 'Tunnel removed',
      });
      if (r) {
        // mirror the server's cleared ids into the draft so the tunnel
        // sections disappear immediately, not after the next refetch
        setDraft((c) => ({ ...c, c2: { ...c.c2, tunnelId: '', dnsRecordId: '' } }));
        setTunnelCmd('');
        await refreshStatus();
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div>
      <h2>C2</h2>
      <div className="panel-sub">Where the final hop delivers traffic.</div>

      <div className="field">
        <label>{payloadLabel}</label>
        <div
          className="cmd"
          onClick={copyPayloadUrl}
          style={{ cursor: payloadUrl ? 'pointer' : 'default' }}
          title={payloadUrl ? 'Click to copy' : undefined}
        >
          {copiedUrl ? 'copied ✓' : payloadUrl || '(deploy all — hop 1\u2019s public URL appears here)'}
        </div>
        <div className="hint">
          Hop 1's secret rides as the first path segment and is stripped before forwarding, so no custom headers are
          needed. Rotating hop 1's secret changes this URL — the payload must be rebuilt.
        </div>
      </div>

      <div className="field">
        <label>Mode</label>
        <select value={c2.mode} onChange={(e) => set({ mode: e.target.value })}>
          <option value="direct">Direct — worker calls the listener URL</option>
          <option value="tunnel">Cloudflare Tunnel — listener never exposed publicly</option>
        </select>
        <div className="hint">
          Tunnel mode is the safer default: the listener is only reachable through the
          tunnel and the worker stays behind Cloudflare's edge.
        </div>
      </div>

      {c2.mode === 'direct' && (
        <div className="field">
          <label>Listener URL</label>
          <input
            type="text"
            placeholder="https://c2.example.com:8443"
            value={c2.url}
            onChange={(e) => set({ url: e.target.value })}
          />
          <div className="hint">
            The C2 is directly reachable from the worker over the public internet — lock the listener down with a
            firewall allow-list for Cloudflare IP ranges at minimum.
          </div>
        </div>
      )}

      {c2.mode === 'tunnel' && (
        <>
          <div className="field">
            <label>Cloudflare account (tunnel + DNS live here)</label>
            <select value={c2.accountId || ''} onChange={(e) => set({ accountId: e.target.value })}>
              <option value="">Same as last hop ({accLabel('')})</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label || a.accountId}
                  {a.burner ? ' — BURNER' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>DNS zone</label>
            <select value={c2.zoneId || ''} onChange={(e) => pickZone(e.target.value)}>
              <option value="">Auto — resolve at provision</option>
              {c2.zoneId && !zones.some((z) => z.id === c2.zoneId) && (
                <option value={c2.zoneId}>{c2.zoneId}</option>
              )}
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
            <div className="hint">
              Where the proxied CNAME for the listener hostname is created — picking one fills the hostname's domain
              part (keeping the prefix you typed). Auto resolves at provision when the token can see exactly one zone.
            </div>
            {zoneNote && <div className="hint" style={{ color: 'var(--amber)' }}>{zoneNote}</div>}
          </div>
          <div className="field">
            <label>Public listener hostname</label>
            <input
              type="text"
              placeholder="listener.yourdomain.com"
              value={c2.hostname}
              onChange={(e) => set({ hostname: e.target.value })}
            />
            <div className="hint">Proxied CNAME to the tunnel is created automatically in your configured zone.</div>
          </div>
          <div className="field">
            <label>Local service (on the C2 box)</label>
            <input
              type="text"
              placeholder="http://127.0.0.1:8443"
              value={c2.localService}
              onChange={(e) => set({ localService: e.target.value })}
            />
            <div className="hint">cloudflared ingress target — where the C2 listener actually binds.</div>
            <label className="check" style={{ marginTop: 6 }}>
              <input
                type="checkbox"
                checked={!!c2.noTLSVerify}
                onChange={(e) => set({ noTLSVerify: e.target.checked })}
              />
              <span>
                Listener serves TLS with a self-signed certificate <span className="muted">(skip origin verify)</span>
              </span>
            </label>
          </div>
          <div>
            <button className="btn primary" onClick={provision} disabled={pending}>
              {c2.tunnelId ? 'Re-provision tunnel' : 'Provision tunnel'}
            </button>{' '}
            {c2.tunnelId && (
              <button className="btn danger" onClick={removeTunnel} disabled={pending}>
                Remove
              </button>
            )}
          </div>
          {c2.tunnelId && (
            <div className="section">
              <h4>
                Tunnel status{' '}
                <button className="btn small" onClick={checkTunnel} disabled={checking} title="Re-check tunnel + connector state now">
                  {checking ? 'checking…' : '↻ check now'}
                </button>
              </h4>
              <div className="mono">id: {c2.tunnelId}</div>
              <div className="mono">
                connector:{' '}
                {status?.c2?.tunnelActive ? (
                  <span style={{ color: 'var(--green)' }}>connected</span>
                ) : (
                  <span style={{ color: 'var(--red)' }}>{status?.c2?.tunnelStatus || 'unknown'}</span>
                )}
              </div>
              {status && !status.c2?.tunnelActive && (
                <div className="hint">Auto-checked every 10 s — it flips to connected once cloudflared runs on the C2 box.</div>
              )}
              {(tunnelCmd || true) && (
                <>
                  <h4 style={{ marginTop: 12 }}>On the C2 server</h4>
                  <div className="cmd">{tunnelCmd || 'cloudflared tunnel run --token <token — re-provision to fetch>'}</div>
                  <div className="hint">
                    Runs the connector in the foreground — keep it in tmux/screen. To make it a boot-persistent service
                    instead: cloudflared service install &lt;same token&gt; on a fresh box, or a hand-written systemd
                    unit when one already runs (README has both).
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      <div className="section">
        <h4>Zero Trust service auth (optional)</h4>
        <p className="muted">
          If the tunnel/listener hostname is protected by a Cloudflare Access service-token policy, the final hop will
          present these credentials.
        </p>
        <div className="field">
          <label>CF-Access-Client-Id</label>
          <input type="text" value={c2.cfAccessId} onChange={(e) => set({ cfAccessId: e.target.value })} />
        </div>
        <div className="field">
          <label>CF-Access-Client-Secret</label>
          <input type="password" value={c2.cfAccessSecret} onChange={(e) => set({ cfAccessSecret: e.target.value })} />
        </div>
      </div>
    </div>
  );
}
