import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';import ChainSidebar from './components/ChainSidebar.jsx';
import ChainCanvas from './components/ChainCanvas.jsx';
import NodePanel from './components/NodePanel.jsx';
import C2Panel from './components/C2Panel.jsx';
import Toolbar from './components/Toolbar.jsx';
import ExportModal from './components/ExportModal.jsx';
import SettingsModal from './components/Settings.jsx';
import { applyAccountPolicy } from './policy.js';

export default function App() {
  const [chains, setChains] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [saved, setSaved] = useState(null); // last state from server
  const [chain, setChain] = useState(null); // draft being edited
  const [status, setStatus] = useState(null);
  const [probe, setProbe] = useState(null);
  const [selected, setSelected] = useState(null); // {type:'hop'|'c2'|'implant', id?}
  const [modal, setModal] = useState(null); // 'settings' | 'export'
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState(null);
  const [settings, setSettings] = useState(null); // multi-account settings
  const [confirm, setConfirm] = useState(null); // {title, message, yes, resolve}
  const [validation, setValidation] = useState({ errors: [], warnings: [] }); // live draft validation
  const [opView, setOpView] = useState(null); // sibling lanes of the open chain's operation
  const opViewRef = useRef(null);
  opViewRef.current = opView;

  // validate the current draft (debounced) so problems show while editing,
  // not just as a deploy-time toast
  useEffect(() => {
    if (!chain?.id) return undefined;
    const t = setTimeout(() => {
      api
        .post(`/chains/${chain.id}/validate`, chain)
        .then((v) => setValidation({ errors: v.errors || [], warnings: v.warnings || [] }))
        .catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [chain]);

  // promise-based in-app confirm (native confirm() is unreliable in embedded browsers)
  const askConfirm = useCallback(
    (title, message, yes) => new Promise((resolve) => setConfirm({ title, message, yes, resolve })),
    []
  );
  const resolveConfirm = (v) =>
    setConfirm((c) => {
      c?.resolve(v);
      return null;
    });

  const adoptChain = useCallback((c) => {
    setSaved(c);
    setChain(structuredClone(c));
  }, []);

  const addHop = useCallback(() => {
    setChain((c) => {
      if (!c || c.hops.length >= 3) return c;
      const hop = newHopDraft(c.hops.length, c.hops.map((h) => h.secretHeader));
      setSelected({ type: 'hop', id: hop.id });
      return applyAccountPolicy({ ...c, hops: [...c.hops, hop] }, accountsRef.current);
    });
  }, []);

  const notify = useCallback((kind, msg) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 4200);
  }, []);

  const run = useCallback(
    async (label, fn, { success } = {}) => {
      setBusy(label);
      try {
        return await fn();
      } catch (err) {
        notify('err', err.message);
        return null;
      } finally {
        setBusy(null);
      }
    },
    [notify]
  );

  // stable identity is load-bearing: the boot effect below depends on this,
  // and a fresh identity per render would re-run it (and re-fetch) forever.
  // ALL state updates happen in one batch at the end — setting the chain
  // before its siblings are fetched would drop the other lane's row for a
  // frame (visible flicker + a layout shift when it returns).
  const loadChain = useCallback(async (id) => {
    const [c, st] = await Promise.all([api.get('/chains/' + id), api.get(`/chains/${id}/status`).catch(() => null)]);
    let siblingLanes = [];
    if (c.opId) {
      const list = await api.get('/chains').catch(() => []);
      const sibIds = list.filter((x) => x.opId === c.opId && x.id !== c.id).map((x) => x.id);
      siblingLanes = (
        await Promise.all(
          sibIds.map(async (sid) => ({
            chain: await api.get('/chains/' + sid).catch(() => null),
            status: await api.get(`/chains/${sid}/status`).catch(() => null),
          }))
        )
      ).filter((l) => l.chain);
    }
    setSaved(c);
    setChain(structuredClone(c));
    setStatus(st);
    setProbe(null);
    setSelected(null);
    setOpView(c.opId ? { opId: c.opId, lanes: siblingLanes } : null);
    return c;
  }, []);

  // operation-level actions fan out to each lane's own per-chain endpoint,
  // sequentially — deploys are heavy and the accounts are shared. Never
  // throws: returns {ok, total, lines} so the sidebar can summarize.
  const opAction = useCallback(
    async (op, action) => {
      const list = chains.filter((c) => c.opId === op.id);
      const lines = [];
      let ok = 0;
      for (const c of list) {
        try {
          await api.post(`/chains/${c.id}/${action}`);
          ok += 1;
          lines.push(`✓ ${c.name}`);
        } catch (err) {
          lines.push(`✗ ${c.name}: ${err.message}`);
        }
      }
      api
        .get('/chains')
        .then(setChains)
        .catch(() => {});
      return { ok, total: list.length, lines };
    },
    [chains]
  );

  useEffect(() => {
    api.get('/settings').then(setSettings).catch(() => {});
    api
      .get('/chains')
      .then(async (list) => {
        setChains(list);
        if (list.length) {
          setActiveId(list[0].id);
          await loadChain(list[0].id).catch(() => {});
        }
      })
      .catch(() => {});
  }, [loadChain]);

  const saveChain = useCallback(async (override, opts = {}) => {
    // override: an explicit draft to persist (e.g. a pause toggle applied on
    // top of the current draft) — the panel can't rely on React state having
    // flushed its own setDraft before calling this. Must look like a chain —
    // a stray event handler argument would stringify a DOM node and explode.
    const draft = override && Array.isArray(override.hops) ? override : chain;
    if (!draft) return null;
    // remember exactly what we're sending so the response can't clobber
    // keystrokes typed during the round-trip
    const snapshot = JSON.stringify({ ...draft, lastDeploy: undefined });
    const c = await run(opts.label || 'Saving chain', () => api.put('/chains/' + chain.id, draft));
    if (c) {
      setSaved(c);
      // adopt the server's canonical copy only when the draft hasn't moved
      // during the round-trip; otherwise keep the newer draft (it re-saves)
      setChain((cur) =>
        JSON.stringify({ ...cur, lastDeploy: undefined }) === snapshot ? structuredClone(c) : cur
      );
      api
        .get('/chains')
        .then(setChains)
        .catch(() => {});
      if (!opts.quiet) notify('ok', 'Chain saved');
      // removed hops from a deployed chain are torn down server-side
      for (const cu of c.cleanup || []) {
        const parts = [...(cu.removed || []), ...(cu.errors || [])];
        notify(cu.errors?.length ? 'err' : 'ok', `Removed hop "${cu.hop}": ${parts.join(', ') || 'nothing to clean up'}`);
      }
      // keep the deployed-count badge honest after structural changes
      api
        .get(`/chains/${chain.id}/status`)
        .then(setStatus)
        .catch(() => {});
    }
    return c || null;
  }, [chain, run, notify]);

  // whether the draft differs from the server's copy — the unsaved badge,
  // the Save button, and the autosave/flush logic all hang off this
  const dirty =
    !!chain &&
    !!saved &&
    JSON.stringify({ ...chain, lastDeploy: undefined }) !== JSON.stringify({ ...saved, lastDeploy: undefined });

  const openChain = useCallback(
    async (id) => {
      // autosave flush — a pending draft is persisted before leaving it; only
      // a FAILED flush asks, so nothing is ever silently discarded
      if (chain && dirty && chain.id !== id) {
        const ok = await saveChain(undefined, { quiet: true });
        if (
          !ok &&
          !(await askConfirm(
            'Save failed',
            'Your edits could not be saved — opening another chain will discard them. Continue?',
            'Discard & open'
          ))
        )
          return;
      }
      setActiveId(id);
      loadChain(id).catch((err) => notify('err', err.message));
    },
    [chain, dirty, saveChain, askConfirm, loadChain, notify]
  );

  const refreshStatus = useCallback(async () => {
    if (!activeId) return;
    const st = await api.get(`/chains/${activeId}/status`).catch((err) => ({ error: err.message }));
    setStatus(st);
    api
      .get('/chains')
      .then(setChains)
      .catch(() => {});
    // sibling lanes' infra state changes out-of-band too (connector up, deploys
    // from the sidebar) — keep their rows honest on the shared canvas
    const ov = opViewRef.current;
    if (ov?.lanes?.length) {
      const sts = await Promise.all(
        ov.lanes.map((l) => api.get(`/chains/${l.chain.id}/status`).catch(() => null))
      );
      // key by id, not index — a lane switch may have reordered opView while
      // these fetches were in flight; index-mapping would stamp statuses
      // onto the wrong rows
      const byId = new Map(ov.lanes.map((l, i) => [l.chain.id, sts[i]]));
      setOpView((o) =>
        o ? { ...o, lanes: o.lanes.map((l) => ({ ...l, status: byId.get(l.chain.id) || l.status })) } : o
      );
    }
  }, [activeId]);

  // infra state changes out-of-band (cloudflared starting on the C2 box,
  // workers appearing/disappearing in a dashboard) — poll instead of waiting
  // for the next deploy to notice
  useEffect(() => {
    if (!activeId) return undefined;
    const t = setInterval(() => refreshStatus(), 10000);
    return () => clearInterval(t);
  }, [activeId, refreshStatus]);

  // accounts list via ref so the policy below always sees the current one
  // without churning callbacks
  const accountsRef = useRef([]);
  accountsRef.current = settings?.accounts || [];

  // every draft mutation re-seats accounts per the positional policy — the
  // canvas must reflect a hop add/remove immediately, not after a save
  const setDraft = (updater) =>
    setChain((c) => applyAccountPolicy(updater(structuredClone(c)), accountsRef.current));

  // AUTO-SAVE: persist draft edits shortly after they stop changing, so
  // nothing lives only in React state. Skipped while a request is in flight
  // (busy) so it can't race a deploy or double-fire a save; when that
  // finishes the effect re-runs and the debounce re-arms if edits remain.
  useEffect(() => {
    if (!chain || !dirty || busy) return undefined;
    const t = setTimeout(() => {
      saveChain(undefined, { quiet: true, label: 'Auto-saving' });
    }, 700);
    return () => clearTimeout(t);
  }, [chain, dirty, busy, saveChain]);

  // click a sibling lane's node on the shared canvas → open that lane. The
  // graph shows the whole operation; edits always land in the active lane.
  // MUST sync activeId — loadChain alone leaves it on the old lane, and the
  // next click back would hit the "same lane" guard and silently do nothing.
  const pickLane = useCallback(
    async (laneId, sel) => {
      if (!laneId || laneId === activeId) {
        if (sel && sel.type !== 'addhop') setSelected(sel);
        return;
      }
      if (dirty) {
        // autosave flush — normally a no-op (edits are already persisted);
        // only a FAILED save asks before discarding
        const ok = await saveChain(undefined, { quiet: true });
        if (
          !ok &&
          !(await askConfirm(
            'Save failed',
            'Your edits could not be saved — switching lanes will discard them. Switch anyway?',
            'Discard & switch'
          ))
        )
          return;
      }
      try {
        setActiveId(laneId);
        await loadChain(laneId);
        if (sel?.type === 'addhop') addHop();
        else if (sel) setSelected(sel);
      } catch (err) {
        notify('err', err.message);
      }
    },
    [activeId, dirty, saveChain, askConfirm, loadChain, notify, addHop]
  );

  // deleting the open chain must not leave a ghost canvas: adopt the first
  // remaining chain, or drop to the empty state
  const onChainDeleted = useCallback(
    async (id) => {
      const list = await api.get('/chains').catch(() => []);
      setChains(list);
      if (activeId !== id) return;
      if (list.length) {
        await loadChain(list[0].id).catch(() => {});
      } else {
        setActiveId(null);
        setChain(null);
        setSaved(null);
        setStatus(null);
        setOpView(null);
        setSelected(null);
      }
    },
    [activeId, loadChain]
  );

  // one graph per operation: the live active-lane draft plus fetched siblings.
  // Rows must hold still when you switch lanes — creation timestamps tie (both
  // lanes are born in the same request), so rank listener above stager.
  const canvasLanes = useMemo(() => {
    if (!chain) return [];
    const lanes = [{ chain, status, active: true }];
    for (const l of opView?.lanes || []) {
      if (l.chain && l.chain.id !== chain.id) lanes.push({ chain: l.chain, status: l.status, active: false });
    }
    // listener lane on top, stager below — regardless of which is open
    const rank = (c) =>
      c.laneName === 'listener' || c.laneName === 'tasking'
        ? 0
        : c.laneName === 'stager' || c.laneName === 'staging'
          ? 1
          : 2;
    return lanes.sort(
      (a, b) =>
        String(a.chain.createdAt || '').localeCompare(String(b.chain.createdAt || '')) ||
        rank(a.chain) - rank(b.chain) ||
        String(a.chain.name).localeCompare(String(b.chain.name))
    );
  }, [chain, status, opView]);

  return (
    <div className="app">
      <div className="topbar">
        <div className="title">
          <img src="/nightingale.png" alt="CloudflareDirector logo" style={{ width: 32, height: 32 }} />
          CloudflareDirector
        </div>
        {chain && (
          <Toolbar
            chain={chain}
            dirty={dirty}
            busy={busy}
            status={status}
            probe={probe}
            setProbe={setProbe}
            setDraft={setDraft}
            saveChain={saveChain}
            notify={notify}
            run={run}
            refreshStatus={refreshStatus}
            onExport={() => setModal('export')}
            askConfirm={askConfirm}
            opAction={opAction}
          />
        )}
        <div className="spacer" />
        <button className="btn" onClick={() => setModal('settings')}>
          Settings
        </button>
      </div>

      <ChainSidebar
        chains={chains}
        activeId={activeId}
        onOpen={openChain}
        onChanged={async () => {
          const list = await api.get('/chains').catch(() => []);
          setChains(list);
          // a lane deleted from the sidebar must not linger on the shared canvas
          setOpView((o) =>
            o ? { ...o, lanes: o.lanes.filter((l) => list.some((x) => x.id === l.chain.id)) } : o
          );
        }}
        onDeleted={onChainDeleted}
        notify={notify}
        run={run}
        askConfirm={askConfirm}
        reloadActive={activeId ? () => loadChain(activeId) : null}
        onOpAction={opAction}
      />

      <div className="canvas-wrap">
        {chain ? (
          <>
            {chain.quarantined && (
              <div className="canvas-banner">⛔ QUARANTINED — hop 1 serves the disguise page to everything</div>
            )}
            {validation.errors.length > 0 && (
              <div className="canvas-banner err">⛔ {validation.errors.join(' ')}</div>
            )}
            {validation.warnings.length > 0 && (
              <div className="canvas-banner warn">⚠ {validation.warnings.join(' ')}</div>
            )}
            <ChainCanvas
              lanes={canvasLanes}
              probe={probe}
              selected={selected}
              setSelected={setSelected}
              onAddHop={addHop}
              onPickLane={pickLane}
              accounts={settings?.accounts || []}
            />
          </>
        ) : (
          <div className="empty">
            <h2>No chains yet</h2>
            <p>Create a chain in the sidebar to start routing.</p>
          </div>
        )}
      </div>

      <div className="rightpanel">
        {chain && selected?.type === 'hop' && (
          <NodePanel
            chain={chain}
            hopIndex={chain.hops.findIndex((h) => h.id === selected.id)}
            setDraft={setDraft}
            saveChain={saveChain}
            notify={notify}
            run={run}
            refreshStatus={refreshStatus}
            askConfirm={askConfirm}
            onAdopt={adoptChain}
            accounts={settings?.accounts || []}
          />
        )}
        {chain && selected?.type === 'c2' && (
          <C2Panel
            chain={chain}
            setDraft={setDraft}
            saveChain={saveChain}
            run={run}
            notify={notify}
            status={status}
            accounts={settings?.accounts || []}
            refreshStatus={refreshStatus}
            askConfirm={askConfirm}
          />
        )}
        {chain && (!selected || selected.type === 'implant') && (
          <div>
            <h2>Implant</h2>
            <div className="panel-sub">Traffic starts here. The implant only ever talks to hop 1.</div>
            {opView && (
              <div className="hint" style={{ marginBottom: 10 }}>
                Shared canvas: you are editing <b>{chain.name}</b> — click another lane's nodes to switch.
              </div>
            )}
            <div className="field">
              <label>Transport</label>
              <select
                value={chain.transport}
                onChange={(e) => setDraft((c) => ({ ...c, transport: e.target.value }))}
              >
                <option value="http">HTTP — hops via service bindings (inner hops unexposed)</option>
                <option value="ws">WebSocket — hops via public fetch (all hops exposed)</option>
              </select>
              <div className="hint">
                WebSocket pass-through over service bindings is unreliable, so ws chains forward hop-to-hop with public
                URLs (still secret-gated).
              </div>
            </div>
            <div className="check">
              <input
                type="checkbox"
                id="keepxff"
                checked={!!chain.c2?.keepXFF}
                onChange={(e) => setDraft((c) => ({ ...c, c2: { ...c.c2, keepXFF: e.target.checked } }))}
              />
              <label htmlFor="keepxff" style={{ margin: 0 }}>
                Keep X-Forwarded-For / CF-Connecting-IP (Havoc TrustXForwardedFor)
              </label>
            </div>
            <div className="section">
              <h4>How the chain works</h4>
              <p className="muted">
                Each hop validates its secret header (timing-safe), forwards to the next hop with the next hop's secret
                injected, and serves a benign disguise page to anything unauthenticated — including when the C2 is
                unreachable. Inner hops have no public URL at all.
              </p>
            </div>
          </div>
        )}
      </div>

      {modal === 'settings' && (
        <SettingsModal
          onClose={() => setModal(null)}
          notify={notify}
          run={run}
          onSaved={(s) => {
            setSettings(s);
            // burner marks may have changed — re-seat the open draft's accounts
            // without discarding unsaved edits
            setChain((c) => (c ? applyAccountPolicy(structuredClone(c), s.accounts) : c));
          }}
        />
      )}
      {modal === 'export' && activeId && <ExportModal chainId={activeId} onClose={() => setModal(null)} notify={notify} />}
      {confirm && (
        <div className="modal-back" onClick={() => resolveConfirm(false)}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{confirm.title}</h2>
            <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>
              {confirm.message}
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => resolveConfirm(false)}>
                Cancel
              </button>
              <button className="btn danger" onClick={() => resolveConfirm(true)}>
                {confirm.yes || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className={'toast ' + toast.kind}>{toast.msg}</div>}
      {busy && <div className="toast">{busy}…</div>}
    </div>
  );
}

const HEADER_POOL = ['X-Visitor-Id', 'X-Client-Tag', 'X-Request-Tag', 'X-Session-Ref', 'X-App-Ref', 'X-Edge-Id'];
const hex = (bytes) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

function newHopDraft(index, existingHeaders = []) {
  const pool = HEADER_POOL.filter((h) => !existingHeaders.includes(h));
  return {
    id: 'h' + hex(8),
    name: 'Hop ' + (index + 1),
    workerName: 'edge-' + hex(5),
    secretHeader: pool[0] || HEADER_POOL[0],
    secretValue: hex(24),
    exposure: 'none', // inner hops start unexposed; hop 1 defaults to workers_dev from the server
    customDomain: '',
    zoneId: '',
    gateMode: 'disguise',
    disguise: 'portfolio',
    disguiseCustom: '',
    observability: false,
  };
}
