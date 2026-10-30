import React from 'react';
import { api } from '../api.js';

export default function Toolbar({
  chain,
  dirty,
  busy,
  status,
  probe,
  setProbe,
  setDraft,
  saveChain,
  notify,
  run,
  refreshStatus,
  onExport,
  askConfirm,
  opAction,
}) {
  const ensureSaved = async () => {
    if (dirty) await saveChain();
  };

  const deployAll = async () => {
    await ensureSaved();
    // an operation is open: deploy EVERY lane, not just the selected one —
    // "all" meaning only this chain's hops read wrong on the shared canvas
    if (chain.opId && opAction) {
      const r = await run('Deploying operation', () => opAction({ id: chain.opId }, 'deploy'));
      if (r) {
        const allOk = r.ok === r.total;
        notify(
          allOk ? 'ok' : 'err',
          `Deploy: ${r.ok}/${r.total} lanes ok${allOk ? '' : ' — ' + r.lines.join(' | ')}`
        );
        await refreshStatus();
      }
      return;
    }
    const r = await run('Deploying chain', () => api.post(`/chains/${chain.id}/deploy`, {}), {
      success: 'Chain deployed',
    });
    if (r) {
      if (!r.ok) notify('err', 'Deploy had failures: ' + r.results.filter((x) => !x.ok).map((x) => x.name + ': ' + x.error).join('; '));
      await refreshStatus();
    }
  };

  const destroy = async () => {
    if (
      !(await askConfirm(
        'Destroy chain',
        'Destroy ALL workers/domains/tunnel for this chain?\n\nBeacons will die and this cannot be undone from the GUI (redeploy is possible).',
        'Destroy'
      ))
    )
      return;
    await ensureSaved();
    const r = await run('Destroying chain', () => api.post(`/chains/${chain.id}/destroy`, {}), { success: 'Chain destroyed' });
    if (r) {
      if (!r.ok) notify('err', 'Destroy finished with errors: ' + r.errors.join('; '));
      await refreshStatus();
    }
  };

  const quarantine = async (q) => {
    await ensureSaved();
    const r = await run(q ? 'Quarantining' : 'Releasing', () => api.post(`/chains/${chain.id}/${q ? 'quarantine' : 'release'}`), {
      success: q ? 'Quarantined — hop 1 blackholes everything' : 'Released — chain live again',
    });
    if (r) await refreshStatus();
  };

  const testPath = async () => {
    await ensureSaved();
    const p = await run('Testing path', () => api.post(`/chains/${chain.id}/probe`, {}));
    if (p) {
      setProbe(p);
      notify(p.ok ? 'ok' : 'err', p.note || p.error || 'Probe done');
    }
  };

  const deployedCount = status?.hops ? Object.values(status.hops).filter((h) => h.deployed).length : null;

  return (
    <>
      <input
        className="chain-name"
        value={chain.name}
        onChange={(e) => setDraft((c) => ({ ...c, name: e.target.value }))}
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--line)',
          borderRadius: 6,
          color: 'var(--fg)',
          padding: '5px 9px',
          font: 'inherit',
          fontWeight: 600,
          width: 180,
        }}
      />
      {dirty && <span className="badge" style={{ color: 'var(--amber)', borderColor: 'var(--amber)' }}>unsaved</span>}
      {deployedCount !== null && (
        <span className="badge">
          {deployedCount}/{chain.hops.length} deployed
        </span>
      )}
      <button className="btn" disabled={!!busy || !dirty} onClick={() => saveChain()} title="Save draft to server">
        Save
      </button>
      <button
        className="btn primary"
        disabled={!!busy}
        onClick={deployAll}
        title={chain.opId ? 'Deploy every lane of the operation' : 'Deploy all hops of this chain'}
      >
        Deploy all
      </button>
      <button className="btn" disabled={!!busy} onClick={testPath} title="Send a canary through the whole chain">
        Test path
      </button>
      <button
        className={'btn ' + (chain.quarantined ? '' : 'warn')}
        disabled={!!busy}
        onClick={() => quarantine(!chain.quarantined)}
        title="Quarantine = hop 1 serves the disguise page to everything; infra stays intact"
      >
        {chain.quarantined ? 'Release' : 'Quarantine'}
      </button>
      <button className="btn" disabled={!!busy} onClick={onExport}>
        Export
      </button>
      <button className="btn danger" disabled={!!busy} onClick={destroy}>
        Destroy
      </button>
    </>
  );
}
