import React, { useRef, useState } from 'react';
import { api } from '../api.js';

function ChainRow({ c, activeId, onOpen, duplicate, remove }) {
  return (
    <div className={'chain-item' + (c.id === activeId ? ' active' : '')} onClick={() => onOpen(c.id)}>
      <div className="name">
        <span className={'dot ' + (c.quarantined ? 'amber' : c.lastDeploy ? 'green' : 'gray')} />
        {c.name}
        {c.quarantined && <span className="badge q">quar</span>}
      </div>
      <div className="sub">
        {c.hopCount} hop{c.hopCount > 1 ? 's' : ''} · {c.c2Mode} {c.transport === 'ws' ? '· ws' : ''}
      </div>
      <div className="row2">
        <button className="btn small" onClick={(e) => { e.stopPropagation(); duplicate(c.id); }}>Duplicate</button>
        <button className="btn small danger" onClick={(e) => { e.stopPropagation(); remove(c); }}>Delete</button>
      </div>
    </div>
  );
}

// sidebar sort: listener lane first, stager below it (matches the canvas rows)
function laneRank(c) {
  if (c.laneName === 'listener' || c.laneName === 'tasking') return 0;
  if (c.laneName === 'stager' || c.laneName === 'staging') return 1;
  return 2;
}

export default function ChainSidebar({
  chains,
  activeId,
  onOpen,
  onChanged,
  onDeleted,
  notify,
  run,
  askConfirm,
  reloadActive,
  onOpAction,
}) {
  const fileRef = useRef(null);
  const [creating, setCreating] = useState(null); // null | 'chain' | 'operation'
  const [newName, setNewName] = useState('');

  const submitCreate = async () => {
    const name = newName.trim();
    const kind = creating;
    if (!name || !kind) return;
    setCreating(null);
    setNewName('');
    if (kind === 'chain') {
      const c = await run('Creating chain', () => api.post('/chains', { name }), { success: 'Chain created' });
      if (c) {
        await onChanged();
        onOpen(c.id);
      }
    } else {
      const r = await run(`Creating operation "${name}"`, () => api.post('/operations', { name }));
      if (r?.operation) {
        await onChanged();
        notify('ok', `Operation "${r.operation.name}" created — listener + stager lanes`);
        onOpen(r.chains[0].id);
      }
    }
  };

  const duplicate = async (id) => {
    const c = await run('Duplicating', () => api.post(`/chains/${id}/duplicate`), { success: 'Chain duplicated' });
    if (c) {
      await onChanged();
      onOpen(c.id);
    }
  };

  const remove = async (c) => {
    // a tunnel with a live connector can't be deleted — check BEFORE asking so
    // the confirm can say so and hand over the fix command
    let tunnelNote = '';
    if (c.c2Mode === 'tunnel') {
      const st = await run('Checking tunnel status', () =>
        api.get(`/chains/${c.id}/status`).catch(() => null)
      );
      if (st?.c2?.tunnelActive) {
        tunnelNote =
          '\n\n⚠ The cloudflared connector on the C2 box is RUNNING and holds this tunnel open — ' +
          'Cloudflare refuses to delete a live tunnel.\n\n' +
          'On the C2 box:\n' +
          '  1. stop the service:      net stop cloudflared   (or systemctl stop cloudflared)\n' +
          '  2. remove the connector:  cloudflared service uninstall\n\n' +
          'Then delete again — the app removes the tunnel and its DNS record itself via the API; ' +
          'there is no manual tunnel-destroy command.\n\n' +
          'You can also delete now: the workers burn immediately, and the tunnel/DNS are torn down ' +
          'on a later retry once the connector is gone.';
      }
    }
    if (
      !(await askConfirm(
        'Delete chain',
        `Delete "${c.name}" and DESTROY everything it created in Cloudflare?\n\nIts workers, custom domains, tunnel and DNS record are burned permanently — this cannot be undone.${tunnelNote}`,
        'Delete & destroy'
      ))
    )
      return;
    const r = await run('Deleting + destroying', () => api.del('/chains/' + c.id));
    if (r) {
      const parts = r.removed || [];
      notify('ok', `Chain deleted — torn down: ${parts.join(', ') || 'nothing was deployed'}`);
      await onDeleted(c.id);
    }
  };

  // ---- operation-level actions: fan out over both lanes ----
  const summarizeOp = (label, r) => {
    if (!r) return;
    const allOk = r.ok === r.total;
    notify(allOk ? 'ok' : 'err', `${label}: ${r.ok}/${r.total} lanes ok${allOk ? '' : ' — ' + r.lines.join(' | ')}`);
  };

  const opDeploy = async (op) => {
    summarizeOp(`Deploy operation "${op.name}"`, await run(`Deploying operation "${op.name}"`, () => onOpAction(op, 'deploy')));
  };

  const opQuarantine = async (op) => {
    const anyFree = op.chains.some((c) => !c.quarantined);
    const action = anyFree ? 'quarantine' : 'release';
    const label = anyFree ? 'Quarantining' : 'Releasing';
    summarizeOp(
      `${anyFree ? 'Quarantine' : 'Release'} operation "${op.name}"`,
      await run(`${label} operation "${op.name}"`, () => onOpAction(op, action))
    );
  };

  const opDestroy = async (op) => {
    if (
      !(await askConfirm(
        'Destroy operation',
        `Destroy ALL workers in "${op.name}"?\n\nBoth lanes (listener + stager) burn: every URL stops resolving and the tunnels/DNS are removed. There is no undo.`,
        'Destroy both lanes'
      ))
    )
      return;
    summarizeOp(
      `Destroy operation "${op.name}"`,
      await run(`Destroying operation "${op.name}"`, () => onOpAction(op, 'destroy'))
    );
  };

  const opDelete = async (op) => {
    if (
      !(await askConfirm(
        'Ungroup operation',
        `Ungroup "${op.name}"?\n\nThe chains remain as standalone chains — deployed workers are untouched.`,
        'Ungroup'
      ))
    )
      return;
    await run('Ungrouping', () => api.del('/operations/' + op.id), { success: 'Operation ungrouped' });
    await onChanged();
  };

  const importFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      const c = await run('Importing', () => api.post('/chains/import', { chain: json }), { success: 'Chain imported' });
      if (c) {
        await onChanged();
        onOpen(c.id);
      }
    } catch (err) {
      notify('err', 'Import failed: ' + err.message);
    }
  };

  // an operation is ONE entity in this list: a single card summarizing both
  // lanes. Its lanes live on the canvas (shared implant graph), navigated by
  // clicking the other lane's nodes. Standalone chains keep the plain card.
  const ops = [];
  const standalone = [];
  for (const c of chains) {
    if (c.opId) {
      let g = ops.find((o) => o.id === c.opId);
      if (!g) {
        g = { id: c.opId, name: c.opName || 'operation', chains: [] };
        ops.push(g);
      }
      g.chains.push(c);
    } else {
      standalone.push(c);
    }
  }

  return (
    <div className="sidebar">
      <h3>Chains</h3>
      <div className="chain-list">
        {chains.length === 0 && <div className="muted" style={{ padding: 10 }}>No chains yet.</div>}

        {ops.map((op) => {
          const lanes = [...op.chains].sort((a, b) => laneRank(a) - laneRank(b));
          const primary = lanes.find((c) => c.laneName === 'listener') || lanes[0];
          const active = op.chains.some((c) => c.id === activeId);
          const anyQ = op.chains.some((c) => c.quarantined);
          const anyFree = op.chains.some((c) => !c.quarantined);
          const allDeployed = op.chains.every((c) => c.lastDeploy);
          return (
            <div key={op.id} className={'chain-item op' + (active ? ' active' : '')} onClick={() => onOpen(primary.id)}>
              <div className="name">
                <span className={'dot ' + (anyQ ? 'amber' : allDeployed ? 'green' : 'gray')} />
                {op.name}
                <span className="badge">op</span>
                {anyQ && <span className="badge q">quar</span>}
              </div>
              <div className="sub">
                {lanes.map((c) => `${c.laneName || c.name} ${c.hopCount}h`).join(' · ')}
              </div>
              <div className="row2">
                <button className="btn small" onClick={(e) => { e.stopPropagation(); opDeploy(op); }}>Deploy all</button>
                <button className="btn small" onClick={(e) => { e.stopPropagation(); opQuarantine(op); }}>
                  {anyFree ? 'Quarantine' : 'Release'}
                </button>
                <button className="btn small danger" onClick={(e) => { e.stopPropagation(); opDestroy(op); }}>Destroy</button>
                <button className="btn small" title="Ungroup — chains become standalone, workers untouched"
                  onClick={(e) => { e.stopPropagation(); opDelete(op); }}>Ungroup</button>
              </div>
            </div>
          );
        })}

        {standalone.map((c) => (
          <ChainRow key={c.id} c={c} activeId={activeId} onOpen={onOpen} duplicate={duplicate} remove={remove} />
        ))}
      </div>
      <div className="foot">
        {creating ? (
          <input
            autoFocus
            className="new-chain-input"
            placeholder={creating === 'operation' ? 'operation name, Enter to create' : 'chain name, Enter to create'}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitCreate();
              if (e.key === 'Escape') setCreating(null);
            }}
            onBlur={() => setCreating(null)}
          />
        ) : (
          <>
            <button className="btn primary" onClick={() => { setCreating('chain'); setNewName(''); }}>+ New chain</button>
            <button className="btn primary" onClick={() => { setCreating('operation'); setNewName(''); }}>+ New operation</button>
          </>
        )}
        <button className="btn" onClick={() => fileRef.current?.click()}>Import</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={importFile} />
      </div>
    </div>
  );
}
