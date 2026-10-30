import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function NodePanel({ chain, hopIndex, setDraft, saveChain, notify, run, refreshStatus, askConfirm, onAdopt, accounts = [] }) {
  const [templates, setTemplates] = useState([]);
  const [showSecret, setShowSecret] = useState(false);
  const [pending, setPending] = useState(false);
  const [zoneCache, setZoneCache] = useState({}); // accountId -> { zones, error? }
  const hop = chain.hops[hopIndex];

  useEffect(() => {
    api.get('/disguise/templates').then(setTemplates).catch(() => {});
  }, []);

  // effective account mirrors the server's positional policy so the domain
  // list matches the account that will actually deploy this hop — even
  // before a save re-seats the draft
  const burnerId = accounts.find((a) => a.burner)?.id || '';
  const primaryId = accounts[0]?.id || '';
  const frontId = chain.hops.length > 1 && burnerId ? burnerId : primaryId;
  const effAccId = hop?.accountPinned ? hop.accountId || primaryId : hopIndex === 0 ? frontId : primaryId;

  // domains visible to the hop's account — fetched only while the custom
  // domain picker can be seen, cached per account
  useEffect(() => {
    if (!hop || hop.exposure !== 'custom') return undefined;
    const acc = accounts.find((a) => a.id === effAccId);
    if (!acc?.id || !acc.apiTokenSet || zoneCache[acc.id]) return undefined;
    let live = true;
    api
      .get('/accounts/' + encodeURIComponent(acc.id) + '/zones')
      .then((r) => live && setZoneCache((p) => ({ ...p, [acc.id]: { zones: r.zones || [] } })))
      .catch((err) => live && setZoneCache((p) => ({ ...p, [acc.id]: { zones: [], error: err.message } })));
    return () => {
      live = false;
    };
  }, [hop, effAccId, accounts, zoneCache]);

  if (!hop) return null;

  const set = (patch) => setDraft((c) => {
    c.hops[hopIndex] = { ...c.hops[hopIndex], ...patch };
    return c;
  });

  const zoneEntry = zoneCache[effAccId] || {};
  const zoneList = zoneEntry.zones || [];
  const hostLow = (hop.customDomain || '').trim().toLowerCase();
  const matchedZone = zoneList.find(
    (z) => hostLow === z.name.toLowerCase() || hostLow.endsWith('.' + z.name.toLowerCase())
  );
  const domainSelectValue = hop.zoneId || matchedZone?.id || '';

  // picking a domain rewrites the hostname's domain part, keeping the prefix
  // the user typed (a bare zone counts as no prefix); with nothing to keep,
  // seed 'redirector.<zone>' so the apex isn't deployed by accident
  const pickDomain = (zoneId) => {
    if (!zoneId) return set({ zoneId: '' });
    const zoneName = zoneList.find((z) => z.id === zoneId)?.name;
    if (!zoneName) return set({ zoneId }); // zone id not in the fetched list — keep verbatim
    let prefix = '';
    const cur = hostLow;
    for (const z of zoneList) {
      const k = z.name.toLowerCase();
      if (cur === k) break;
      if (cur.endsWith('.' + k)) {
        prefix = cur.slice(0, cur.length - k.length - 1);
        break;
      }
    }
    set({ zoneId, customDomain: (prefix || 'redirector') + '.' + zoneName });
  };

  // saves the draft (or an override of it), then deploys this hop + upstream —
  // the sequence a pause/unpause toggle needs to take effect immediately
  const deployThis = async (override) => {
    setPending(true);
    try {
      await saveChain(override);
      const r = await run(
        'Deploying hop ' + (hopIndex + 1),
        () => api.post(`/chains/${chain.id}/deploy`, { onlyIndex: hopIndex }),
        { success: `Hop ${hopIndex + 1} (+ upstream) deployed` }
      );
      if (r && !r.ok) {
        notify('err', r.results.filter((x) => !x.ok).map((x) => x.error).join('; ') || 'Deploy failed');
      }
      await refreshStatus();
    } finally {
      setPending(false);
    }
  };

  const togglePause = () => {
    const nextPaused = !hop.paused;
    set({ paused: nextPaused });
    return deployThis({ ...chain, hops: chain.hops.map((h, i) => (i === hopIndex ? { ...h, paused: nextPaused } : h)) });
  };

  // Rotation happens server-side and the response becomes the new truth —
  // re-saving the stale draft here would overwrite the new secret.
  const rotate = async () => {
    if (
      !(await askConfirm(
        'Rotate secret value',
        `Generate a new secret value for "${hop.name}"?\n\nAny callback still using the old value will fail the gate. Redeploy this hop (+ upstream) and re-export implant profiles afterwards.`,
        'Rotate'
      ))
    )
      return;
    const c = await run('Rotating secret', () => api.post(`/chains/${chain.id}/hops/${hop.id}/rotate`, {}));
    if (c) {
      onAdopt(c);
      notify('ok', 'Secret rotated — redeploy to apply');
    }
  };

  const removeHop = async () => {
    if (chain.hops.length <= 1) return notify('err', 'A chain needs at least one hop.');
    if (!(await askConfirm('Remove hop', `Remove "${hop.name}" from the chain?`, 'Remove'))) return;
    setDraft((c) => {
      c.hops.splice(hopIndex, 1);
      c.hops.forEach((h, i) => (h.name = h.name.startsWith('Hop ') ? 'Hop ' + (i + 1) : h.name));
      return c;
    });
  };

  return (
    <div>
      <h2>Hop {hopIndex + 1}</h2>
      <div className="panel-sub mono">{hop.workerName}</div>

      <div className="field">
        <label>Cloudflare account</label>
        {(() => {
          const AUTO = '__auto__';
          const burner = accounts.find((a) => a.burner);
          const cur = hop.accountPinned ? hop.accountId || '' : AUTO;
          return (
            <>
              <select
                value={cur}
                onChange={(e) => {
                  if (e.target.value === AUTO) {
                    // hand placement back to the positional policy
                    set({ accountPinned: false });
                  } else {
                    set({ accountId: e.target.value, accountPinned: true });
                  }
                }}
              >
                <option value={AUTO}>Automatic (follows position)</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label || a.accountId || 'account'}
                    {a.burner ? ' — BURNER' : ''}
                  </option>
                ))}
                {accounts.length === 0 && <option value="">Primary (configure accounts in Settings)</option>}
              </select>
              <div className="hint">
                Default: a single hop runs on the primary; with 2+ hops the front goes to the burner
                {accounts.length > 0 && !burner ? ' (add a burner account in Settings to shield the front)' : ''} and
                the backbone stays on the primary — re-seated automatically when hops are added or removed. Pick a
                specific account to pin this hop and override that.
              </div>
            </>
          );
        })()}
      </div>

      <div className="field">
        <label>Display name</label>
        <input type="text" value={hop.name} onChange={(e) => set({ name: e.target.value })} />
      </div>

      <div className="field">
        <label>Secret header</label>
        <input type="text" value={hop.secretHeader} onChange={(e) => set({ secretHeader: e.target.value })} />
        <div className="hint">
          Header name the implant (hop 1) or the previous hop sends with every request. Agents that can't send
          custom headers can embed the secret in the URL path instead —
          <span className="mono"> https://host/&lt;secret&gt;/…</span> — this hop strips it before forwarding.
        </div>
      </div>

      <div className="field">
        <label>Secret value</label>
        <div className="row">
          <input type={showSecret ? 'text' : 'password'} value={hop.secretValue} readOnly />
          <button className="btn small" onClick={() => setShowSecret((s) => !s)}>{showSecret ? 'Hide' : 'Show'}</button>
          <button className="btn small" onClick={rotate} title="Generate a new secret value">Rotate</button>
        </div>
        <div className="hint">
          48-char crypto-random value, generated automatically when the hop is created. Rotation invalidates any
          callback still using the old value.
        </div>
      </div>

      <div className="field">
        <label>Exposure</label>
        <select value={hop.exposure} onChange={(e) => set({ exposure: e.target.value })}>
          <option value="workers_dev">workers.dev subdomain</option>
          <option value="custom">Custom domain</option>
          <option value="none">None (service-binding only)</option>
        </select>
        {hop.exposure === 'custom' && (
          <div style={{ marginTop: 6 }}>
            {(zoneList.length > 0 || hop.zoneId) && (
              <select
                value={domainSelectValue}
                onChange={(e) => pickDomain(e.target.value)}
                style={{ marginBottom: 6 }}
              >
                <option value="">— pick domain —</option>
                {zoneList.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
                {hop.zoneId && !zoneList.some((z) => z.id === hop.zoneId) && (
                  <option value={hop.zoneId}>{hop.zoneId}</option>
                )}
              </select>
            )}
            <input
              type="text"
              placeholder="redirector.example.com"
              value={hop.customDomain}
              onChange={(e) => set({ customDomain: e.target.value })}
            />
            {zoneEntry.error ? (
              <div className="hint" style={{ color: 'var(--amber)' }}>
                Couldn't list domains: {zoneEntry.error} — type the hostname manually.
              </div>
            ) : zoneList.length === 0 && zoneEntry.zones ? (
              <div className="hint" style={{ color: 'var(--amber)' }}>
                This account's token can see no zones — type the hostname manually.
              </div>
            ) : (
              zoneList.length > 0 && (
                <div className="hint">
                  Domains the hop's account can serve. Picking one fills the hostname — edit the label in front of it
                  for a subdomain. “— pick domain —” uses the account's default zone.
                </div>
              )
            )}
          </div>
        )}
        {hopIndex === 0 && hop.exposure === 'none' && (
          <div className="hint" style={{ color: 'var(--amber)' }}>The first hop must be reachable by the implant.</div>
        )}
      </div>

      <div className="field">
        <label>On gate failure</label>
        <select value={hop.gateMode} onChange={(e) => set({ gateMode: e.target.value })}>
          <option value="disguise">Serve disguise page (200)</option>
          <option value="404">404 Not Found</option>
          <option value="401">401 Unauthorized</option>
        </select>
      </div>

      <div className="field">
        <label>Disguise page</label>
        <select value={hop.disguise} onChange={(e) => set({ disguise: e.target.value })}>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
          <option value="custom">Custom HTML…</option>
        </select>
        {hop.disguise === 'custom' && (
          <textarea
            style={{ marginTop: 6 }}
            value={hop.disguiseCustom}
            placeholder="<!DOCTYPE html> …"
            onChange={(e) => set({ disguiseCustom: e.target.value })}
          />
        )}
      </div>

      {hopIndex > 0 && (
        <div style={{ marginBottom: 12 }}>
          <button
            className="btn small"
            style={hop.paused ? { borderColor: 'var(--amber)', color: 'var(--amber)' } : undefined}
            disabled={pending}
            title={
              hop.paused
                ? 'Put this hop back into the path (redeploys it + upstream)'
                : 'Take this hop out of the path (redeploys it + upstream)'
            }
            onClick={togglePause}
          >
            {hop.paused ? '▶ Unpause hop' : '⏸ Pause hop (bypass)'}
          </button>
          <div className="hint" style={{ marginTop: 6 }}>
            {hop.paused
              ? 'Traffic skips this hop right now — the previous hop routes to the next one and this worker serves the disguise page. Unpause to put it back.'
              : 'Pausing takes effect immediately: saves, then redeploys this hop + upstream so traffic routes around it. The paused worker serves the disguise page.'}
          </div>
        </div>
      )}

      <div className="check">
        <input
          type="checkbox"
          id={'obs-' + hop.id}
          checked={!!hop.observability}
          onChange={(e) => set({ observability: e.target.checked })}
        />
        <label htmlFor={'obs-' + hop.id} style={{ margin: 0 }}>
          Enable invocation logs (debugging)
        </label>
      </div>

      <div className="section">
        <button className="btn primary" onClick={deployThis} disabled={pending}>
          Deploy this hop {hopIndex > 0 ? '+ upstream' : ''}
        </button>
        {hopIndex > 0 && (
          <button className="btn danger" style={{ marginLeft: 8 }} onClick={removeHop}>
            Remove hop
          </button>
        )}
      </div>
    </div>
  );
}
