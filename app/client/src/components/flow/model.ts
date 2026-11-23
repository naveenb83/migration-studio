/** Pure graph helpers: containment tree, collapse, and the control-flow / data-flow models. No React here. */
import type { LayoutItem } from './layout';
import type { GraphDoc, GraphNode } from './types';

export interface Tree {
  byId: Map<string, GraphNode>;
  kids: Map<string, string[]>;
}

export function buildTree(doc: GraphDoc): Tree {
  const byId = new Map(doc.nodes.map((n) => [n.id, n] as const));
  const kids = new Map<string, string[]>();
  for (const n of doc.nodes) {
    if (n.parent && byId.has(n.parent)) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n.id]);
  }
  return { byId, kids };
}

/** Ancestors of `id`, outermost first, ending with `id`. */
export function pathTo(id: string, tree: Tree): string[] {
  const out: string[] = [];
  let cur: string | undefined = id;
  while (cur !== undefined && out.length < 200) {
    out.unshift(cur);
    const parent: string | null | undefined = tree.byId.get(cur)?.parent;
    cur = parent && tree.byId.has(parent) ? parent : undefined;
  }
  return out;
}

export function descendantCount(id: string, tree: Tree): number {
  return (tree.kids.get(id) ?? []).reduce((acc, k) => acc + 1 + descendantCount(k, tree), 0);
}

export function isContainer(n: GraphNode, tree: Tree): boolean {
  return tree.kids.has(n.id) || n.kind === 'event_handler' || n.category === 'container' || n.category === 'package';
}

/** The node that stands in for `id` on screen: the outermost collapsed ancestor, or `id` itself. */
export function representative(id: string, tree: Tree, collapsed: Set<string>): string {
  for (const p of pathTo(id, tree)) if (collapsed.has(p)) return p;
  return id;
}

export interface FlowNodeSpec {
  node: GraphNode;
  parent: string | null;
  container: boolean;
  hidden: number;
}

export interface FlowLinkSpec {
  id: string;
  source: string;
  target: string;
  label: string;
  color: string;
  dashed: boolean;
}

export interface FlowModel {
  nodes: FlowNodeSpec[];
  links: FlowLinkSpec[];
  items: LayoutItem[];
}

export const PRECEDENCE_COLOR: Record<string, string> = { success: '#059669', failure: '#dc2626', completion: '#64748b' };

/** Control flow: executables and event handlers, with collapsed containers standing in for their contents. */
export function controlFlowModel(doc: GraphDoc, tree: Tree, collapsed: Set<string>): FlowModel {
  const visible = doc.nodes.filter((n) => n.kind !== 'component' && representative(n.id, tree, collapsed) === n.id);
  const shown = new Set(visible.map((n) => n.id));
  const parentShown = (n: GraphNode): string | null => (n.parent && shown.has(n.parent) ? n.parent : null);
  const withKids = new Set<string>();
  for (const n of visible) {
    const p = parentShown(n);
    if (p) withKids.add(p);
  }
  const nodes: FlowNodeSpec[] = visible
    .map((n) => ({ node: n, parent: parentShown(n), container: isContainer(n, tree), hidden: descendantCount(n.id, tree) }))
    .sort((a, b) => pathTo(a.node.id, tree).length - pathTo(b.node.id, tree).length);
  const items: LayoutItem[] = nodes.map((s) => ({
    id: s.node.id,
    parent: s.parent,
    width: withKids.has(s.node.id) ? undefined : 220,
    height: withKids.has(s.node.id) ? undefined : 60,
  }));

  const links: FlowLinkSpec[] = [];
  const seen = new Set<string>();
  for (const e of doc.edges) {
    if (e.kind !== 'precedence') continue;
    const s = representative(e.from, tree, collapsed);
    const t = representative(e.to, tree, collapsed);
    if (s === t || !shown.has(s) || !shown.has(t)) continue;
    const value = e.value ?? 'success';
    const or = e.logical_and === false;
    const label = [value, e.expression ? `[${shorten(e.expression, 40)}]` : null, or ? 'OR' : null].filter(Boolean).join(' · ');
    const key = `${s}>${t}>${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ id: e.id, source: s, target: t, label, color: PRECEDENCE_COLOR[value] ?? '#64748b', dashed: or || value === 'completion' });
  }
  return { nodes, links, items };
}

/** Data flow for one Data Flow task: its components and the paths between them (error paths in red). */
export function dataFlowModel(doc: GraphDoc, flowId: string): FlowModel {
  const comps = doc.nodes.filter((n) => n.kind === 'component' && n.data_flow === flowId);
  const ids = new Set(comps.map((c) => c.id));
  const nodes: FlowNodeSpec[] = comps.map((c) => ({ node: c, parent: null, container: false, hidden: 0 }));
  const items: LayoutItem[] = comps.map((c) => ({ id: c.id, parent: null, width: 220, height: 66 }));
  const links: FlowLinkSpec[] = doc.edges
    .filter((e) => e.kind === 'path' && ids.has(e.from) && ids.has(e.to))
    .map((e) => ({ id: e.id, source: e.from, target: e.to, label: e.name ?? '', color: e.is_error ? '#dc2626' : '#64748b', dashed: Boolean(e.is_error) }));
  return { nodes, links, items };
}

export function dataFlowTasks(doc: GraphDoc): GraphNode[] {
  return doc.nodes.filter((n) => n.kind === 'executable' && n.category === 'data_flow');
}

export const CATEGORY_STYLE: Record<string, { label: string; color: string }> = {
  package: { label: 'Package', color: '#334155' },
  container: { label: 'Container', color: '#64748b' },
  execute_sql: { label: 'Execute SQL', color: '#0284c7' },
  data_flow: { label: 'Data Flow', color: '#4f46e5' },
  execute_package: { label: 'Execute Package', color: '#0d9488' },
  script: { label: 'Script', color: '#b45309' },
  file_system: { label: 'File System', color: '#78716c' },
  send_mail: { label: 'Send Mail', color: '#db2777' },
  other: { label: 'Other', color: '#6b7280' },
};

export function categoryStyle(category?: string): { label: string; color: string } {
  const key = category ?? 'other';
  return CATEGORY_STYLE[key] ?? { label: key.replace(/_/g, ' '), color: CATEGORY_STYLE.other.color };
}

export const ROLE_COLOR: Record<string, string> = { source: '#2563eb', transform: '#6b7280', destination: '#059669', command: '#d97706' };

export function shorten(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function matchIds(nodes: GraphNode[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return nodes
    .filter((n) => [n.name, n.sql, n.table, n.class_id, n.description, n.connection].some((v) => typeof v === 'string' && v.toLowerCase().includes(q)))
    .map((n) => n.id);
}
