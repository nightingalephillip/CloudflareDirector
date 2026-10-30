import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

function AccountCard({ acc, index, total, onChange, onDelete, onDoctor, doctor, doctoring, zonesData }) {
  const set = (patch) => onChange({ ...acc, ...patch });
  const zoneList = zonesData?.zones || [];
  return (
    <div className="account-card">
      <div className="account-head">
        <b>{index === 0 ? `${acc.label || 'Account'} — default for hops` : acc.label || 'Account'}</b>
        {index === 0 && <span className="badge">primary</span>}
        {index > 0 && !acc.burner && (
          <button
            className="linklike"
            title="Disposable account for throwaway hops"
            onClick={() => set({ burner: true })}
          >
            mark as burner
          </button>
        )}
        {index > 0 && acc.burner && (
          <button
            className="badge burner clickable"
            title="Burner: disposable, expected to be burned — click to unmark"
            onClick={() => set({ burner: false })}
          >
            burner
          </button>
        )}
        {total > 1 && index > 0 && (
          <button className="btn small danger" onClick={onDelete} style={{ marginLeft: 'auto' }}>
            Remove
          </button>
        )}
      </div>

      <div className="two-col">
        <div className="field">
          <label>Label</label>
          <input type="text" value={acc.label} onChange={(e) => set({ label: e.target.value })} />
        </div>
        <div className="field">
          <label>Account ID</label>
          <input
            type="text"
            placeholder="32-hex account id"
            value={acc.accountId}
            onChange={(e) => set({ accountId: e.target.value })}
          />
        </div>
      </div>

      <div className="two-col">
        <div className="field">
          <label>API token {acc.apiTokenSet && <span style={{ color: 'var(--green)' }}>✓ stored</span>}</label>
          <input
            type="password"
            placeholder={acc.apiTokenSet ? '•••••••••••• (leave blank to keep)' : 'paste Cloudflare API token'}
            value={acc.apiToken || ''}
            onChange={(e) => set({ apiToken: e.target.value })}
          />
        </div>
        <div className="field">
          <label>workers.dev subdomain</label>
          <input
            type="text"
            placeholder="your-team.workers.dev"
            value={acc.workersDevSubdomain}
            onChange={(e) => set({ workersDevSubdomain: e.target.value })}
          />
        </div>
      </div>

      <div className="field">
        <label>Default zone (custom domains &amp; tunnel DNS)</label>
        {zoneList.length > 0 ? (
          <select value={acc.zoneId} onChange={(e) => set({ zoneId: e.target.value })}>
            <option value="">— pick zone —</option>
            {zoneList.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input
              type="text"
              placeholder="auto-detected at tunnel provision, or paste a zone id"
              value={acc.zoneId}
              onChange={(e) => set({ zoneId: e.target.value })}
            />
            {zonesData?.error && <div className="hint" style={{ color: 'var(--amber)' }}>{zonesData.error}</div>}
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn small" onClick={onDoctor} disabled={doctoring}>
          {doctoring ? 'Checking…' : 'Save + token doctor'}
        </button>
        {doctor && (
          <span className={'badge ' + (doctor.ok ? '' : 'q')} style={doctor.ok ? { color: 'var(--green)', borderColor: 'var(--green)' } : { color: 'var(--amber)', borderColor: 'var(--amber)' }}>
            {doctor.ok ? 'all permissions OK' : 'missing permissions'}
          </span>
        )}
      </div>

      {doctor && (
        <div style={{ marginTop: 8 }}>
          {doctor.checks.map((c, i) => (
            <div key={i} className="doctor-check">
              <span className={'dot ' + (c.ok ? 'green' : 'red')} />
              <div>
                <div>{c.name}</div>
                {c.detail && <div className="hint">{c.detail}</div>}
                {!c.ok && c.hint && <div className="hint" style={{ color: 'var(--amber)' }}>{c.hint}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SettingsModal({ onClose, notify, run, onSaved }) {
  const [accounts, setAccounts] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [doctors, setDoctors] = useState({});
  const [doctoring, setDoctoring] = useState(null); // account id being checked
  const [zoneCache, setZoneCache] = useState({}); // accountId -> { zones, error? }

  // per-account zone list for the picker — no full doctor run needed; runs
  // once per stored-token account (cache key), refetched after each save
  const loadZones = async (accId) => {
    try {
      const r = await api.get('/accounts/' + encodeURIComponent(accId) + '/zones');
      setZoneCache((prev) => ({ ...prev, [accId]: { zones: r.zones || [] } }));
    } catch (err) {
      setZoneCache((prev) => ({ ...prev, [accId]: { zones: [], error: err.message } }));
    }
  };

  useEffect(() => {
    if (!loaded) return;
    for (const a of accounts) {
      if (a.id && a.apiTokenSet && !(a.id in zoneCache)) loadZones(a.id);
    }
  }, [loaded, accounts, zoneCache]);

  useEffect(() => {
    api
      .get('/settings')
      .then((s) => {
        setAccounts((s.accounts || []).map((a) => ({ ...a, apiToken: '' })));
        setLoaded(true);
      })
      .catch((err) => notify('err', err.message));
  }, []);

  const save = async () => {
    const payload = {
      accounts: accounts.map((a) => ({
        id: a.id || undefined,
        label: a.label,
        accountId: a.accountId,
        apiToken: a.apiToken || '',
        workersDevSubdomain: a.workersDevSubdomain,
        zoneId: a.zoneId,
        burner: !!a.burner,
      })),
    };
    const s = await run('Saving accounts', () => api.put('/settings', payload));
    if (!s) return null;
    const clean = (s.accounts || []).map((a) => ({ ...a, apiToken: '' }));
    setAccounts(clean);
    setZoneCache({}); // tokens may have changed — refetch zone lists
    if (onSaved) onSaved(s);
    return s;
  };

  const runDoctor = async (accId) => {
    const saved = await save();
    if (!saved) return;
    const id = accId || (saved.accounts[0] || {}).id;
    setDoctoring(id);
    try {
      const d = await api.get('/doctor?accountId=' + encodeURIComponent(id || ''));
      setDoctors((prev) => ({ ...prev, [id]: d }));
      if (d.zones) setZoneCache((prev) => ({ ...prev, [id]: { zones: d.zones } }));
      if (d.accounts) {
        // fill in a missing account id from the token itself
        setAccounts((prev) =>
          prev.map((a) => (!a.accountId && d.accounts.length === 1 ? { ...a, accountId: d.accounts[0].id } : a))
        );
      }
      notify(d.ok ? 'ok' : 'err', (d.label || 'Account') + ': ' + (d.ok ? 'all permissions OK' : 'missing permissions'));
    } catch (err) {
      notify('err', err.message);
    } finally {
      setDoctoring(null);
    }
  };

  const addAccount = () => {
    if (accounts.length >= 8) return notify('err', 'Eight accounts is plenty.');
    setAccounts((a) => [...a, { id: '', label: 'Account ' + (a.length + 1), accountId: '', apiToken: '', workersDevSubdomain: '', zoneId: '' }]);
  };

  const removeAccount = (idx) => {
    if (idx === 0) return notify('err', 'The first account is the default — remove another one instead.');
    setAccounts((a) => a.filter((_, i) => i !== idx));
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="btn small close-x" onClick={onClose}>✕</button>
        <h2>Cloudflare accounts</h2>
        <p className="muted">
          Every hop can live in its own account — burn one without losing the chain. Hops in <b>different</b>{' '}
          accounts forward via public fetch (the next hop then needs a workers.dev/custom URL); hops in the same
          account use hidden service bindings. The first account is the default.
        </p>
        <div className="hint" style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 6 }}>Required token permissions — one row each (scope &gt; permission &gt; level):</div>
          <ul className="perm-list">
            <li><span className="mono">Account &gt; Workers Scripts &gt; Edit</span></li>
            <li><span className="mono">Account &gt; Account Settings &gt; Read</span></li>
            <li><span className="mono">Zone &gt; Zone &gt; Read</span> (All zones)</li>
            <li><span className="mono">Zone &gt; DNS &gt; Edit</span> (All zones)</li>
            <li><span className="mono">Account &gt; Cloudflare Tunnel &gt; Edit</span> (tunnel mode only)</li>
          </ul>
          <div style={{ marginTop: 6 }}>
            DNS records live in the <b>Zone</b> scope — the Account-scoped "DNS Settings" entry is a different
            permission and won't let the tool create the tunnel CNAME. Custom domains attach under{" "}
            <b>Workers Scripts</b> Edit; there is no separate "Workers Custom Domains" permission. Tokens are
            stored locally in <span className="mono">data/state.json</span> and never leave this machine.
          </div>
        </div>

        {!loaded ? (
          <p className="muted">Loading…</p>
        ) : (
          accounts.map((acc, i) => (
            <AccountCard
              key={acc.id || 'new-' + i}
              acc={acc}
              index={i}
              total={accounts.length}
              onChange={(next) => setAccounts((prev) => prev.map((a, j) => (j === i ? next : a)))}
              onDelete={() => removeAccount(i)}
              onDoctor={() => runDoctor(acc.id)}
              doctor={doctors[acc.id]}
              doctoring={doctoring === acc.id}
              zonesData={zoneCache[acc.id]}
            />
          ))
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn" onClick={addAccount}>+ Add account</button>
          <button className="btn primary" onClick={save}>Save accounts</button>
        </div>
      </div>
    </div>
  );
}
