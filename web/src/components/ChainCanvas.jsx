import React, { useEffect, useMemo, useState } from 'react';
import { ReactFlow, MarkerType, ReactFlowProvider, useReactFlow, useStoreApi, Handle, Position } from '@xyflow/react';

function RdrNode({ data, selected }) {
  const [copied, setCopied] = useState(false);
  const copyable =
    (data.kind === 'hop' || data.kind === 'c2') && typeof data.sub === 'string' && data.sub && !data.sub.startsWith('(');

  const copySub = async (e) => {
    // keep React Flow from treating the press as a drag/select
    e.stopPropagation();
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(data.sub);
    } catch {
      // clipboard API unavailable outside secure contexts — fall back
      const ta = document.createElement('textarea');
      ta.value = data.sub;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className={'rdr-node ' + data.kind + (selected ? ' selected' : '') + (data.dim ? ' dim' : '')}>
      {/* edges anchor on these; invisible but measurable */}
      <Handle type="target" position={Position.Left} className="rdr-handle" isConnectable={false} />
      <Handle type="source" position={Position.Right} className="rdr-handle" isConnectable={false} />
      <div className="head">
        {data.state && <span className={'dot ' + data.state} />}
        <b>{data.label}</b>
        {data.badges?.map((b, i) => (
          <span key={i} className={'badge' + (b.q ? ' q' : '')}>
            {b.text}
          </span>
        ))}
      </div>
      {data.sub && (
        <div
          className={'sub' + (copyable ? ' copyable' : '')}
          title={copyable ? 'Click to copy' : undefined}
          onClick={copyable ? copySub : undefined}
          onMouseDown={copyable ? (e) => e.stopPropagation() : undefined}
        >
          {copied ? 'copied ✓' : data.sub}
        </div>
      )}
      {data.meta && (
        <div className="meta">
          {data.meta.map((m, i) => (
            <span key={i} className="badge">
              {m}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// row caption for multi-lane (operation) graphs; clicking jumps to that lane
function LaneLabelNode({ data }) {
  return (
    <div className={'lane-label' + (data.active ? ' active' : '') + (data.onPick ? ' clickable' : '')} onClick={data.onPick}>
      <span className={'dot ' + (data.state || 'gray')} />
      <b>{data.text}</b>
      {data.sub && <span className="lbl-sub">{data.sub}</span>}
      {data.active && <span className="lbl-editing">editing</span>}
    </div>
  );
}

// translucent frame around a lane's cards row — solid green when edited,
// dashed and empty on the unselected lane; on the unselected lane the frame
// itself is clickable to switch editing there, on the active one it's
// click-through so pane deselect still works
function LaneBoxNode({ data }) {
  return (
    <div
      className={'lane-box' + (data.active ? '' : ' inactive clickable')}
      onClick={data.onPick}
      title={data.onPick ? 'Click to edit this lane' : undefined}
    />
  );
}

const nodeTypes = { rdr: RdrNode, laneLabel: LaneLabelNode, laneBox: LaneBoxNode };

// horizontal grid for the fixed layout — wide enough that a hop card at its
// max-width (260px, see .rdr-node) never touches the next node's badges
const SPACING = 340;
// vertical gap between operation lanes
const LANE_GAP = 340;

// lanes: [{ chain, status, active }] — one entry per operation lane; a single
// chain is a one-element array and renders exactly like the old layout
export default function ChainCanvas({ lanes = [], probe, setSelected, onAddHop, onPickLane, accounts = [] }) {
  const { nodes, edges, shapeKey } = useMemo(() => {
    const st = (laneStatus, hopId) => {
      if (!laneStatus) return 'gray';
      const h = laneStatus.hops?.[hopId];
      if (!h) return 'gray';
      return h.deployed ? 'green' : 'red';
    };
    const accOf = (accountId) => accounts.find((x) => x.id === accountId) || accounts[0];
    const accLabel = (accountId) => {
      const a = accOf(accountId);
      return a ? a.label || a.accountId : null;
    };
    const rowY = (li) => 80 + li * LANE_GAP;
    const nodes = [];
    const edges = [];

    nodes.push({
      id: 'implant',
      type: 'rdr',
      position: { x: 0, y: 80 + (Math.max(lanes.length, 1) - 1) * (LANE_GAP / 2) },
      data: {
        kind: 'implant',
        label: 'Implant',
        sub: 'traffic starts here',
        state: 'gray',
        badges: [{ text: 'callback' }],
      },
    });

    lanes.forEach((lane, li) => {
      const chain = lane.chain;
      const laneStatus = lane.status;
      // probe results exist only for the lane that was actually probed
      const laneProbe = lane.active ? probe : null;
      const y = rowY(li);
      // cards on an unselected lane only switch to it — their editors open on
      // the second click, once the lane is the selected one
      const pick = (rdr) => (lane.active || !onPickLane ? undefined : () => onPickLane(chain.id, null));

      const deployed = Object.values(laneStatus?.hops || {}).filter((h) => h.deployed).length;
      const canAdd = chain.hops.length < 3;
      {
        // frame just the cards row (hops/add/C2) — the lane label above stays
        // outside; pushed first so it renders behind this row's cards,
        // click-through so pane deselect and card clicks still work inside it
        const lastX = (chain.hops.length + (canAdd ? 2 : 1)) * SPACING;
        const boxX = SPACING - 15;
        nodes.push({
          id: chain.id + ':lanebox',
          type: 'laneBox',
          position: { x: boxX, y: y - 12 },
          selectable: false,
          draggable: false,
          zIndex: 0,
          style: { width: lastX + 290 - boxX, height: 135, pointerEvents: lane.active ? 'none' : 'auto' },
          data: { active: !!lane.active, onPick: lane.active || !onPickLane ? undefined : () => onPickLane(chain.id, null) },
        });
      }
      nodes.push({
        id: chain.id + ':label',
        type: 'laneLabel',
        position: { x: SPACING - 40, y: y - 92 },
        selectable: false,
        data: {
          text: (chain.laneName || chain.name) + ' lane',
          sub: `${deployed}/${chain.hops.length} deployed`,
          state: chain.quarantined ? 'amber' : deployed === chain.hops.length && chain.hops.length ? 'green' : 'gray',
          active: lane.active,
          onPick: pick(null),
        },
      });

      chain.hops.forEach((hop, i) => {
        const badges = [];
        const acc = accOf(hop.accountId);
        if (accounts.length > 1 && acc) badges.push({ text: '@' + (acc.label || acc.accountId) });
        if (acc?.burner) badges.push({ text: 'burner', q: true });
        if (hop.paused) badges.push({ text: 'paused', q: true });
        if (i === 0 && chain.quarantined) badges.push({ text: 'quarantine', q: true });
        badges.push({ text: hop.exposure === 'none' ? 'unexposed' : hop.exposure === 'custom' ? 'custom' : 'workers.dev' });
        if (!hop.paused && chain.transport === 'http' && i < chain.hops.length - 1) {
          const next = chain.hops[i + 1];
          const crossAccount = accounts.length > 1 && accLabel(hop.accountId) !== accLabel(next.accountId);
          badges.push({ text: crossAccount ? 'fetch →' : 'service binding' });
        }
        if (!hop.paused && chain.transport === 'ws' && i < chain.hops.length - 1) badges.push({ text: 'fetch' });
        if (hop.observability) badges.push({ text: 'logs' });
        nodes.push({
          id: hop.id,
          type: 'rdr',
          position: { x: (i + 1) * SPACING, y },
          data: {
            kind: 'hop',
            rdr: { type: 'hop', id: hop.id },
            label: hop.name,
            sub: laneStatus?.hops?.[hop.id]?.url || '(no public URL)',
            state: st(laneStatus, hop.id),
            badges,
            dim: !lane.active,
            onPick: pick({ type: 'hop', id: hop.id }),
          },
        });
      });

      const c2 = chain.c2 || {};
      nodes.push({
        id: chain.id + ':c2',
        type: 'rdr',
        position: { x: (chain.hops.length + (canAdd ? 2 : 1)) * SPACING, y },
        data: {
          kind: 'c2',
          rdr: { type: 'c2' },
          label: 'C2',
          sub: c2.mode === 'tunnel' ? c2.hostname || '(tunnel hostname unset)' : c2.url || '(listener URL unset)',
          state: laneStatus?.c2?.tunnelActive ? 'green' : laneStatus?.c2?.tunnelStatus ? 'red' : 'gray',
          badges: [{ text: c2.mode === 'tunnel' ? 'cloudflared tunnel' : 'direct' }],
          dim: !lane.active,
          onPick: pick({ type: 'c2' }),
        },
      });

      if (canAdd) {
        // every lane that can take a hop shows + Add hop; on an inactive lane
        // it first switches to that lane, then adds
        nodes.push({
          id: chain.id + ':add',
          type: 'rdr',
          position: { x: (chain.hops.length + 1) * SPACING, y },
          data: {
            kind: 'add',
            label: '+ Add hop',
            sub: 'up to 3',
            state: null,
            onPick: lane.active
              ? onAddHop
              : onPickLane
                ? () => onPickLane(chain.id, null)
                : undefined,
          },
        });
      }

      const slug = (s) =>
        String(s || '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 24) || 'hop';

      const mkEdge = (src, tgt, hop) => {
        // probe stamps are matched by slug so paused hops (no stamp) don't
        // shift everyone's index
        const p = (laneProbe?.hops || []).find((x) => x.slug === slug(hop?.name));
        let label = hop ? hop.secretHeader + ' ✓' : '';
        let color = '#4b5462';
        if (p) {
          label = p.name + ' ' + (p.ok ? '✓' : '✗');
          color = p.ok ? '#34d399' : '#f87171';
        }
        return {
          id: src + '-' + tgt,
          source: src,
          target: tgt,
          animated: !!p?.ok,
          style: { stroke: color, strokeWidth: 1.5 },
          label,
          labelStyle: { fill: p ? (p.ok ? '#a7f3d0' : '#ffb4b4') : '#8b93a1', fontSize: 11 },
          labelBgStyle: { fill: '#11141b' },
          labelBgPadding: [4, 2],
          labelBgBorderRadius: 3,
          markerEnd: { type: MarkerType.ArrowClosed, color: '#4b5462' },
        };
      };

      const mkPlain = (src, tgt, label) => ({
        id: src + '-' + tgt,
        source: src,
        target: tgt,
        style: { stroke: '#4b5462', strokeWidth: 1.5, strokeDasharray: tgt === chain.id + ':add' ? '5,4' : undefined },
        label: label || '',
        labelStyle: { fill: '#8b93a1', fontSize: 11 },
        labelBgStyle: { fill: '#11141b' },
        labelBgPadding: [4, 2],
        labelBgBorderRadius: 3,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#4b5462' },
      });

      // edges follow the effective path: paused hops get a dashed "bypassed"
      // stub from the last active node and are skipped by real traffic
      let prev = 'implant';
      chain.hops.forEach((hop) => {
        if (hop.paused) {
          const be = mkPlain(prev, hop.id, 'bypassed');
          be.style = { ...be.style, stroke: '#3f4756' };
          edges.push(be);
        } else {
          edges.push(mkEdge(prev, hop.id, hop));
          prev = hop.id;
        }
      });
      const addId = chain.id + ':add';
      const c2Id = chain.id + ':c2';
      if (canAdd) {
        edges.push(mkPlain(prev, addId));
        edges.push(mkPlain(addId, c2Id, laneProbe ? laneProbe.latencyMs + 'ms round trip' : ''));
      } else {
        edges.push(mkPlain(prev, c2Id, laneProbe ? laneProbe.latencyMs + 'ms round trip' : ''));
      }
    });

    return {
      nodes,
      edges,
      shapeKey: lanes.map((l) => l.chain.id + ':' + l.chain.hops.length).join('|'),
    };
  }, [lanes, probe, onAddHop, onPickLane]);

  return (
    <ReactFlowProvider>
      <CanvasInner nodes={nodes} edges={edges} shapeKey={shapeKey} setSelected={setSelected} />
    </ReactFlowProvider>
  );
}

function CanvasInner({ nodes, edges, shapeKey, setSelected }) {
  const { fitView } = useReactFlow();
  const store = useStoreApi();
  // re-fit whenever the graph shape changes so added hops stay in view
  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.25, duration: 200 }), 60);
    return () => clearTimeout(t);
  }, [shapeKey, fitView]);

  // selection lives in our state: the 10s status poll rebuilds the node array
  // every cycle (which drops RF's internal selected flag), and RF's pane-click
  // unselect only mutates its internal copy without ever reaching our nodes —
  // so we track the ids ourselves and re-apply them on every rebuild
  const [selIds, setSelIds] = useState(() => new Set());
  useEffect(() => {
    setSelIds(new Set());
  }, [shapeKey]);

  const selNodes = useMemo(() => {
    const { nodeLookup } = store.getState();
    // carry RF's measured size into every object we hand back — a changed
    // object identity makes RF rebuild its internal node, which would
    // otherwise reset `measured` and flip the card to visibility:hidden
    return nodes.map((n) => {
      const measured = nodeLookup.get(n.id)?.measured;
      return measured?.width ? { ...n, selected: selIds.has(n.id), measured } : n;
    });
  }, [nodes, selIds, store]);

  return (
    <ReactFlow
      nodes={selNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      onSelectionChange={(sel) => {
        // sel.nodes IS the selected set — RF hands back our user node objects,
        // whose own .selected flag it never sets in controlled mode
        setSelIds(new Set(sel.nodes.map((n) => n.id)));
      }}
      onPaneClick={() => setSelIds(new Set())}
      onNodeClick={(_, node) => {
        if (node.type === 'laneBox') return; // decorative frame, never a selection
        if (node.data.onPick) {
          node.data.onPick();
          return;
        }
        setSelected(node.data.rdr || { type: 'implant' });
      }}
      fitView
      fitViewOptions={{ padding: 0.25 }}
      proOptions={{ hideAttribution: true }}
      minZoom={0.4}
    />
  );
}
