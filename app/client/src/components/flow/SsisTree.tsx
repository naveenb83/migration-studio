/** Fallback view when the diagram cannot be laid out: the same steps as a collapsible tree. */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { categoryStyle } from './model';
import type { GraphDoc, GraphNode } from './types';

export function SsisTree({ doc, onSelect }: { doc: GraphDoc; onSelect: (id: string) => void }) {
  const { roots, kids, next } = useMemo(() => {
    const kids = new Map<string, GraphNode[]>();
    const roots: GraphNode[] = [];
    for (const n of doc.nodes) {
      if (n.kind === 'component') {
        if (n.data_flow) kids.set(n.data_flow, [...(kids.get(n.data_flow) ?? []), n]);
        continue;
      }
      if (n.parent) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
      else roots.push(n);
    }
    const names = new Map(doc.nodes.map((n) => [n.id, n.name] as const));
    const next = new Map<string, string[]>();
    for (const e of doc.edges) {
      if (e.kind !== 'precedence') continue;
      next.set(e.from, [...(next.get(e.from) ?? []), `${e.value ?? 'success'} → ${names.get(e.to) ?? e.to}`]);
    }
    return { roots, kids, next };
  }, [doc]);
  return (
    <div className="max-h-[620px] overflow-auto rounded-md border p-2 text-sm" data-testid="ssis-tree">
      {roots.map((r) => (
        <TreeItem key={r.id} node={r} kids={kids} next={next} depth={0} onSelect={onSelect} />
      ))}
    </div>
  );
}

function TreeItem({ node, kids, next, depth, onSelect }: { node: GraphNode; kids: Map<string, GraphNode[]>; next: Map<string, string[]>; depth: number; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(depth < 2);
  const children = kids.get(node.id) ?? [];
  const cat = categoryStyle(node.kind === 'component' ? 'other' : node.category);
  const links = next.get(node.id) ?? [];
  return (
    <div style={{ marginLeft: depth === 0 ? 0 : 14 }}>
      <div className="flex items-center gap-1 py-0.5">
        {children.length > 0 ? (
          <button type="button" className="rounded p-0.5 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${node.name}`}>
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="inline-block w-5" />
        )}
        <button type="button" className="truncate text-left hover:underline" onClick={() => onSelect(node.id)}>
          {node.name}
        </button>
        <span className="shrink-0 rounded px-1 text-[10px] text-white" style={{ background: node.kind === 'component' ? '#64748b' : cat.color }}>
          {node.kind === 'component' ? (node.role ?? 'component') : cat.label}
        </span>
        {node.sql && <span className="shrink-0 rounded bg-sky-100 px-1 text-[10px] text-sky-800">SQL</span>}
      </div>
      {open && links.length > 0 && (
        <div className="ml-7 text-[11px] text-muted-foreground">{links.map((l) => <div key={l}>then {l}</div>)}</div>
      )}
      {open && children.map((c) => <TreeItem key={c.id} node={c} kids={kids} next={next} depth={depth + 1} onSelect={onSelect} />)}
    </div>
  );
}
