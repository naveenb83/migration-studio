/** elkjs layered layout with hierarchy (containers laid out around their children) and orthogonal edges. */
import ELK, { type ElkExtendedEdge, type ElkNode } from 'elkjs/lib/elk.bundled.js';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** width/height undefined means "sized by the layout" (an expanded container). Positions are relative to the parent. */
export interface LayoutItem {
  id: string;
  parent: string | null;
  width?: number;
  height?: number;
}

export interface LayoutLink {
  id: string;
  source: string;
  target: string;
}

const elk = new ELK();

export async function layoutGraph(items: LayoutItem[], links: LayoutLink[], direction: 'DOWN' | 'RIGHT'): Promise<Map<string, Box>> {
  const ids = new Set(items.map((i) => i.id));
  const parentOf = new Map<string, string | null>();
  for (const it of items) parentOf.set(it.id, it.parent !== null && ids.has(it.parent) ? it.parent : null);

  const chain = (id: string): string[] => {
    const out: string[] = [];
    let cur: string | null = id;
    while (cur !== null && out.length < 200) {
      out.unshift(cur);
      cur = parentOf.get(cur) ?? null;
    }
    return out;
  };

  const kids = new Map<string | null, LayoutItem[]>();
  for (const it of items) {
    const p = parentOf.get(it.id) ?? null;
    kids.set(p, [...(kids.get(p) ?? []), it]);
  }

  // An edge lives in the deepest container that holds both ends (ELK hierarchy rule).
  const edgesAt = new Map<string | null, ElkExtendedEdge[]>();
  for (const l of links) {
    if (!ids.has(l.source) || !ids.has(l.target) || l.source === l.target) continue;
    const a = chain(l.source);
    const b = chain(l.target);
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    if (i === a.length || i === b.length) continue; // one end contains the other: skip
    const container = i === 0 ? null : a[i - 1];
    edgesAt.set(container, [...(edgesAt.get(container) ?? []), { id: l.id, sources: [l.source], targets: [l.target] }]);
  }

  const build = (parent: string | null): ElkNode[] =>
    (kids.get(parent) ?? []).map((it): ElkNode => {
      if ((kids.get(it.id) ?? []).length > 0) {
        return {
          id: it.id,
          layoutOptions: { 'elk.padding': '[top=36,left=14,bottom=14,right=14]' },
          children: build(it.id),
          edges: edgesAt.get(it.id) ?? [],
        };
      }
      return { id: it.id, width: it.width ?? 220, height: it.height ?? 60 };
    });

  const root: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': '28',
      'elk.layered.spacing.nodeNodeBetweenLayers': '56',
      'elk.padding': '[top=20,left=20,bottom=20,right=20]',
    },
    children: build(null),
    edges: edgesAt.get(null) ?? [],
  };

  const laid = await elk.layout(root);
  const out = new Map<string, Box>();
  const walk = (n: ElkNode) => {
    for (const c of n.children ?? []) {
      out.set(c.id, { x: c.x ?? 0, y: c.y ?? 0, width: c.width ?? 0, height: c.height ?? 0 });
      walk(c);
    }
  };
  walk(laid);
  return out;
}
