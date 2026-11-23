/**
 * SSIS viewer: control flow and per-Data-Flow data flow, rendered from the scanner's graph JSON.
 * Layout is elkjs (layered, hierarchical); drawing is React Flow. If layout fails, it falls back to a tree.
 */
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Background, Controls, MiniMap, MarkerType, ReactFlow, useReactFlow, type Edge } from '@xyflow/react';
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@databricks/appkit-ui/react';
import { useApi } from '@/lib/poll';
import { EmptyState, ErrorState, Loading } from '@/components/common';
import { DetailsPanel } from './DetailsPanel';
import { SsisNode, type SsisFlowNode } from './SsisNode';
import { SsisTree } from './SsisTree';
import { layoutGraph, type Box } from './layout';
import { buildTree, controlFlowModel, dataFlowModel, dataFlowTasks, categoryStyle, isContainer, matchIds, ROLE_COLOR, type Tree } from './model';
import { GRAPH_SCHEMA, type GraphDoc, type GraphNode } from './types';

const NODE_TYPES = { ssis: SsisNode };

/** Defaults read the workshop estate; pass `listPath`/`graphPathFor` to show another set (e.g. a team's own uploads). */
export function SsisViewer({ packageId, listPath = '/api/estate-graphs', graphPathFor = (id: string) => `/api/estate-graph/${encodeURIComponent(id)}`, refreshKey = 0 }: { packageId?: string; listPath?: string; graphPathFor?: (id: string) => string; refreshKey?: number }) {
  const list = useApi<string[]>(listPath, [refreshKey]);
  const [picked, setPicked] = useState<string | null>(null);
  const active = picked ?? packageId ?? list.data?.[0] ?? null;
  const graph = useApi<GraphDoc>(active ? graphPathFor(active) : null, [active, refreshKey]);

  if (list.loading && !list.data) return <Loading label="Loading packages" />;
  if (list.error) return <ErrorState error={list.error} retry={() => void list.reload()} />;
  if (!list.data || list.data.length === 0 || !active) return <EmptyState title="No packages scanned yet">Run the estate scan to add SSIS packages.</EmptyState>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Package</span>
        <Select value={active} onValueChange={setPicked}>
          <SelectTrigger className="h-8 w-80" aria-label="Package">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {list.data.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {graph.loading && !graph.data ? (
        <Loading label="Loading graph" rows={6} />
      ) : graph.error ? (
        <ErrorState error={graph.error} retry={() => void graph.reload()} />
      ) : graph.data && graph.data.schema === GRAPH_SCHEMA ? (
        <GraphWorkspace key={active} doc={graph.data} />
      ) : graph.data ? (
        <ErrorState error="This package's graph is not in the expected format (migration-studio/estate-graph/v1)." />
      ) : null}
    </div>
  );
}

function GraphWorkspace({ doc }: { doc: GraphDoc }) {
  const tree: Tree = useMemo(() => buildTree(doc), [doc]);
  const flows = useMemo(() => dataFlowTasks(doc), [doc]);
  const [dataView, setDataView] = useState(false);
  const [flowPick, setFlowPick] = useState<string | null>(null);
  const flowId = flowPick ?? flows[0]?.id ?? '';
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [treeMode, setTreeMode] = useState(false);
  const [layoutErr, setLayoutErr] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<{ key: string; map: Map<string, Box> } | null>(null);

  // Event handlers start collapsed; everything else starts open. The user's toggles win.
  const collapsed = useMemo(() => {
    const s = new Set<string>();
    for (const n of doc.nodes) {
      const isCollapsed = n.id in overrides ? Boolean(overrides[n.id]) : n.kind === 'event_handler';
      if (isCollapsed && tree.kids.has(n.id)) s.add(n.id);
    }
    return s;
  }, [doc, tree, overrides]);

  const toggle = useCallback((id: string) => setOverrides((o) => ({ ...o, [id]: !collapsed.has(id) })), [collapsed]);

  const showData = dataView && flowId !== '';
  const model = useMemo(() => (showData ? dataFlowModel(doc, flowId) : controlFlowModel(doc, tree, collapsed)), [doc, tree, collapsed, showData, flowId]);
  const direction = showData ? 'RIGHT' : 'DOWN';
  const layoutKey = `${showData ? flowId : 'control'}|${[...collapsed].sort().join(',')}`;

  useEffect(() => {
    let live = true;
    layoutGraph(
      model.items,
      model.links.map((l) => ({ id: l.id, source: l.source, target: l.target })),
      direction,
    )
      .then((map) => {
        if (live) setBoxes({ key: layoutKey, map });
      })
      .catch((e: unknown) => {
        if (live) setLayoutErr(e instanceof Error ? e.message : 'Layout failed');
      });
    return () => {
      live = false;
    };
  }, [model, direction, layoutKey]);

  const hits = useMemo(() => matchIds(model.nodes.map((s) => s.node), query), [model, query]);
  const hitKey = hits.join('|');
  const box = boxes?.key === layoutKey ? boxes.map : null;

  if (layoutErr || treeMode) {
    return (
      <div className="space-y-2">
        {layoutErr && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">Diagram layout failed ({layoutErr}). Showing the collapsible tree instead.</div>
        )}
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setTreeMode(false)} disabled={Boolean(layoutErr)}>
            Back to diagram
          </Button>
          <span className="text-xs text-muted-foreground">
            {doc.stats.nodes} steps · {doc.stats.edges} links
          </span>
        </div>
        <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
          <SsisTree doc={doc} onSelect={setSelected} />
          <div className="h-[620px] overflow-auto rounded-md border p-3">
            <DetailsPanel doc={doc} selectedId={selected} onSelect={setSelected} />
          </div>
        </div>
      </div>
    );
  }

  const rfNodes: SsisFlowNode[] = box
    ? model.nodes.map((spec) => {
        const n: GraphNode = spec.node;
        const b = box.get(n.id) ?? { x: 0, y: 0, width: 220, height: 60 };
        const isComp = n.kind === 'component';
        const cat = categoryStyle(n.category);
        const color = isComp ? (ROLE_COLOR[n.role ?? 'transform'] ?? '#6b7280') : n.kind === 'event_handler' ? '#7c3aed' : cat.color;
        const variant = isComp ? 'component' : spec.hidden > 0 && isContainer(n, tree) ? 'container' : 'exec';
        const sub = isComp
          ? `${(n.class_id ?? '').replace(/^Microsoft\./, '')}${n.table ? ` · ${n.table}` : ''}`
          : variant === 'container'
            ? n.kind === 'event_handler'
              ? 'Event handler'
              : cat.label
            : `${cat.label}${n.connection ? ` · ${n.connection}` : ''}`;
        return {
          id: n.id,
          type: 'ssis',
          position: { x: b.x, y: b.y },
          parentId: spec.parent ?? undefined,
          width: b.width,
          height: b.height,
          draggable: false,
          selected: selected === n.id,
          data: {
            id: n.id,
            label: n.name,
            sub,
            color,
            variant,
            direction,
            collapsed: collapsed.has(n.id),
            hidden: spec.hidden,
            disabled: Boolean(n.disabled),
            hasSql: Boolean(n.sql),
            errorOutputs: (n.outputs ?? []).filter((o) => o.is_error).length,
            highlight: hits.includes(n.id),
            onToggle: toggle,
          },
        };
      })
    : [];

  const rfEdges: Edge[] = model.links.map((l) => ({
    id: l.id,
    source: l.source,
    target: l.target,
    label: l.label || undefined,
    type: 'smoothstep',
    style: { stroke: l.color, strokeWidth: 1.6, strokeDasharray: l.dashed ? '6 4' : undefined },
    markerEnd: { type: MarkerType.ArrowClosed, color: l.color },
    labelStyle: { fontSize: 11, fill: '#334155' },
    labelBgStyle: { fill: '#ffffff', fillOpacity: 0.92 },
  }));

  const containerIds = doc.nodes.filter((n) => tree.kids.has(n.id)).map((n) => n.id);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={showData ? 'outline' : 'default'} onClick={() => setDataView(false)}>
          Control flow
        </Button>
        <Button size="sm" variant={showData ? 'default' : 'outline'} onClick={() => setDataView(true)} disabled={flows.length === 0}>
          Data flow {flows.length > 0 ? `(${flows.length})` : ''}
        </Button>
        {showData && (
          <Select value={flowId} onValueChange={setFlowPick}>
            <SelectTrigger className="h-8 w-72" aria-label="Data Flow task">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {flows.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Input className="h-8 w-64" placeholder="Search names, SQL, tables" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search the diagram" />
        {query && (
          <span className="text-xs text-muted-foreground">
            {hits.length} match{hits.length === 1 ? '' : 'es'} shown
          </span>
        )}
        {!showData && (
          <>
            <Button size="sm" variant="outline" onClick={() => setOverrides(Object.fromEntries(containerIds.map((id) => [id, false])))}>
              Expand all
            </Button>
            <Button size="sm" variant="outline" onClick={() => setOverrides(Object.fromEntries(containerIds.map((id) => [id, true])))}>
              Collapse all
            </Button>
          </>
        )}
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={treeMode} onCheckedChange={setTreeMode} aria-label="Tree view" />
          Tree view
        </label>
      </div>
      <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
        <div className="relative h-[620px] overflow-hidden rounded-md border bg-slate-50 dark:bg-slate-950" data-testid="ssis-canvas">
          {box ? (
            <ReactFlow
              key={layoutKey}
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={NODE_TYPES}
              fitView
              fitViewOptions={{ padding: 0.15 }}
              minZoom={0.05}
              maxZoom={2}
              nodesDraggable={false}
              nodesConnectable={false}
              onNodeClick={(_, node) => setSelected(node.id)}
              onPaneClick={() => setSelected(null)}
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable />
              <FitOnSearch ids={hitKey} />
            </ReactFlow>
          ) : (
            <div className="p-4">
              <Loading label="Laying out the diagram" rows={4} />
            </div>
          )}
        </div>
        <div className="h-[620px] overflow-auto rounded-md border p-3">
          <DetailsPanel doc={doc} selectedId={selected} onSelect={setSelected} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {model.nodes.length} steps shown · {model.links.length} links. Drag to pan, scroll to zoom, use the chevrons to collapse containers. Secrets are masked by the scanner.
      </p>
    </div>
  );
}

/** Fits the view to the search hits. Rendered inside ReactFlow so it can use the flow instance. */
function FitOnSearch({ ids }: { ids: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (!ids) return;
    void fitView({ nodes: ids.split('|').map((id) => ({ id })), padding: 0.3, duration: 400 });
  }, [ids, fitView]);
  return null;
}
