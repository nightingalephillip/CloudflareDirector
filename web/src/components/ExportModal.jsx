import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const FRAMEWORKS = [
  { id: 'generic', label: 'Generic HTTP' },
  { id: 'havoc', label: 'Havoc' },
  { id: 'mythic', label: 'Mythic' },
  { id: 'sliver', label: 'Sliver' },
];

export default function ExportModal({ chainId, onClose, notify }) {
  const [framework, setFramework] = useState('generic');
  const [includeSecrets, setIncludeSecrets] = useState(true);
  const [killdate, setKilldate] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    setError(null);
    api
      .post(`/chains/${chainId}/export`, { framework, options: { includeSecrets, killdate: killdate || undefined } })
      .then((r) => live && setResult(r))
      .catch((err) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [chainId, framework, includeSecrets, killdate]);

  const copy = async () => {
    await navigator.clipboard.writeText(result?.content || '');
    notify('ok', 'Copied to clipboard');
  };

  const download = () => {
    const blob = new Blob([result?.content || ''], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = result?.filename || 'profile.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="btn small close-x" onClick={onClose}>
          ✕
        </button>
        <h2>Export profile — pointed at hop 1</h2>

        <div className="tabs">
          {FRAMEWORKS.map((f) => (
            <button key={f.id} className={'tab' + (framework === f.id ? ' active' : '')} onClick={() => setFramework(f.id)}>
              {f.label}
            </button>
          ))}
        </div>

        <div className="check">
          <input type="checkbox" id="incsec" checked={includeSecrets} onChange={(e) => setIncludeSecrets(e.target.checked)} />
          <label htmlFor="incsec" style={{ margin: 0 }}>
            Include real secret values (uncheck to share redacted copies)
          </label>
        </div>
        <div className="field">
          <label>Killdate (optional — Havoc / Mythic)</label>
          <input type="text" placeholder="2026-12-31 12:00:00" value={killdate} onChange={(e) => setKilldate(e.target.value)} />
        </div>

        {error && <div className="toast err" style={{ position: 'static', marginBottom: 10 }}>{error}</div>}
        {result && (
          <>
            <div className="muted" style={{ marginBottom: 6 }}>
              {result.filename}
            </div>
            <pre className="code">{result.content}</pre>
            {result.commands?.length > 0 &&
              result.commands.map((c, i) => (
                <div key={i} className="cmd">
                  {c}
                </div>
              ))}
            {result.notes?.length > 0 && (
              <ul className="notes">
                {result.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button className="btn primary" onClick={copy}>
                Copy
              </button>
              <button className="btn" onClick={download}>
                Download
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
