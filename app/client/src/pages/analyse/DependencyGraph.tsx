/** Files and objects from a Genie Migrate analysis as a left-to-right dependency graph (React Flow + elkjs). */
import { useEffect, useMemo, useState } from 'react';
import { Background, Controls, MarkerType, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { layoutGraph } from '@/components/flow/layout';
import { Loading } from '@/components/common';
import { shortName, type AnalysisModel, type Decision } from './types';

const NODE_W = 230;
const NODE_H = 54;

function style(kind: string): React.CSSProperties {
  const base: React.CSSProperties = { width: NODE_W, borderRadius: 10, fontSize: 12, padding: 8, textAlign: 'left' };
  if (kind === 'file') return { ...base, background: '#eef2ff', border: '2px solid #6366f1' };
  if (kind === 'internal') return { ...base, background: '#ecfdf5', border: '2px solid #059669' };
  if (kind === 'undetermined') return { ...base, background: '#fffbeb', border: '2px dashed #d97706' };
  if (kind === 'manual') return { ...base, background: '#f5f3ff', border: '2px dashed #7c3aed' };
  return { ...base, background: '#f8fafc', border: '2px solid #94a3b8' };
}

export function DependencyGraph({ model, decisions, manual, onSelect, selected }: {
  model: AnalysisModel;
  decisions: Map<string, Decision>;
  manual: Array<{ key: string; from: string; to: string; op: string }>;
  onSelect: (edgeKey: string) => void;
  selected: string | null;
}) {
  const [pos, setPos] = useState<Map<string, { x: number; y: number }> | null>(null);
  const [failed, setFailed] = useState(false);
  const { nodes0, edges0 } = useMemo(() => {
    const nodes0: Array<{ id: string; label: string; sub: string; kind: string }> = [];
    for (const f of model.files) nodes0.push({ id: `f${f.id}`, label: f.path, sub: `${f.loc} lines · ${f.statementsAnalyzed} statements${f.statementsFailed ? ` · ${f.statementsFailed} failed` : ''}`, kind: 'file' });
    for (const o of model.objects) nodes0.push({ id: `o${o.id}`, label: shortName(o.name), sub: o.provenance === 'undetermined' ? 'missing: not in the project' : o.provenance, kind: o.provenance });
    const manualNames = new Set<string>();
    manual.forEach((m) => [m.from, m.to].forEach((n) => n && !model.objects.some((o) => o.name === n || shortName(o.name) === n) && manualNames.add(n)));
    manualNames.forEach((n) => nodes0.push({ id: `m:${n}`, label: n, sub: 'manual addition', kind: 'manual' }));
    const idFor = (name: string) => {
      const o = model.objects.find((x) => x.name === name || shortName(x.name) === name);
      return o ? `o${o.id}` : `m:${name}`;
    };
    const edges0: Array<{ id: string; source: string; target: string; label: string; manual: boolean }> = [];
    for (const e of model.edges) {
      // a file that creates an object is shown through the lineage edges; plain reads link file → object
      if (e.kind === 'reads') edges0.push({ id: e.key, source: `o${e.to}`, target: `f${e.fromFile ?? 0}`, label: 'read by', manual: false });
      else edges0.push({ id: e.key, source: `o${e.fromObject ?? 0}`, target: `o${e.to}`, label: e.via ?? e.op, manual: false });
    }
    for (const f of model.files)
      for (const o of model.objects.filter((x) => x.createdBy.includes(f.id))) edges0.push({ id: `c:${f.id}:${o.id}`, source: `f${f.id}`, target: `o${o.id}`, label: 'creates', manual: false });
    for (const m of manual) edges0.push({ id: m.key, source: idFor(m.from), target: idFor(m.to), label: m.op || 'depends on', manual: true });
    return { nodes0, edges0: edges0.filter((e) => nodes0.some((n) => n.id === e.source) && nodes0.some((n) => n.id === e.target)) };
  }, [model, manual]);

  useEffect(() => {
    let live = true;
    layoutGraph(nodes0.map((n) => ({ id: n.id, parent: null, width: NODE_W, height: NODE_H })), edges0.map((e) => ({ id: e.id, source: e.source, target: e.target })), 'RIGHT')
      .then((m) => live && setPos(new Map([...m.entries()].map(([k, b]) => [k, { x: b.x, y: b.y }]))))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [nodes0, edges0]);

  if (failed) return <div className="text-sm text-muted-foreground">The graph could not be laid out; use the Dependencies table.</div>;
  if (!pos) return <Loading label="Laying out the dependency graph" rows={4} />;
  const nodes: Node[] = nodes0.map((n) => ({
    id: n.id,
    position: pos.get(n.id) ?? { x: 0, y: 0 },
    data: { label: (<div><div className="truncate font-semibold" title={n.label}>{n.label}</div><div className="truncate text-[10px] text-muted-foreground">{n.sub}</div></div>) },
    style: style(n.kind),
    sourcePosition: 'right' as Node['sourcePosition'],
    targetPosition: 'left' as Node['targetPosition'],
  }));
  const edges: Edge[] = edges0.map((e) => {
    const d = decisions.get(e.id)?.decision;
    const color = e.manual ? '#7c3aed' : d === 'confirmed' ? '#059669' : d === 'rejected' ? '#dc2626' : d === 'follow_up' ? '#d97706' : '#64748b';
    return {
      id: e.id, source: e.source, target: e.target, label: e.label, animated: selected === e.id,
      style: { stroke: color, strokeWidth: selected === e.id ? 3 : 1.5, strokeDasharray: e.manual || d === 'rejected' ? '6 4' : undefined },
      labelStyle: { fontSize: 10 }, markerEnd: { type: MarkerType.ArrowClosed, color },
    };
  });
  return (
    <div className="h-[520px] rounded-md border">
      <ReactFlow nodes={nodes} edges={edges} fitView fitViewOptions={{ padding: 0.15 }} onEdgeClick={(_e, edge) => onSelect(edge.id)} nodesDraggable={false} proOptions={{ hideAttribution: true }}>
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
