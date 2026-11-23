/**
 * Genie Migrate "Analyze" output → the app's dependency model.
 *
 * Verified 23 Nov against a real migration project: Analyze writes `analysis.json` into the project's output folder
 * (report.schemaVersion "0.2", dialect, base = the input folder). It holds files (loc, sha256, statements analysed /
 * failed, references), objects (provenance internal | external | undetermined), objectLineage (from → to, aspect, op,
 * in = file id, via = statement), fileLineage (edges, cycles, executionOrder) and a facts graph whose `location`
 * relationships give 0-based [startLine, startCol, endLine, endCol] ranges for statements and queries.
 * There is no API: the app only READS this file. Unknown fields are ignored; nothing here executes code.
 */
export interface AFile {
  id: number;
  path: string;
  loc: number;
  hash: string | null;
  statementsAnalyzed: number;
  statementsFailed: number;
  unresolved: string[];
}
export interface AObject {
  id: number;
  name: string;
  provenance: string; // internal | external | undetermined (missing from the project)
  readBy: number[]; // file ids
  createdBy: number[]; // file ids
}
export interface AEdge {
  key: string; // stable id for decisions
  kind: 'reads' | 'lineage';
  fromObject: number | null; // null for file → object reads
  fromFile: number | null;
  to: number; // object id
  op: string;
  aspect: string;
  via: string | null;
  fileId: number | null;
  lines: [number, number] | null; // 1-based inclusive
}
export interface AnalysisModel {
  schemaVersion: string;
  generatedAt: string | null;
  dialect: string | null;
  base: string | null;
  analyzer: string | null;
  summary: Record<string, unknown>;
  files: AFile[];
  objects: AObject[];
  edges: AEdge[];
  fileEdges: Array<{ from: number; to: number; via?: string }>;
  cycles: unknown[];
  executionOrder: number[];
  missing: Array<{ id: number; name: string; readBy: string[] }>;
  warnings: string[];
}

type J = Record<string, unknown>;
const arr = (v: unknown): J[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as J[]) : []);
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export class AnalysisFormatError extends Error {}

export function parseAnalysis(raw: unknown): AnalysisModel {
  if (!raw || typeof raw !== 'object') throw new AnalysisFormatError('Not a JSON object.');
  const d = raw as J;
  const report = (d.report ?? {}) as J;
  const schemaVersion = str(report.schemaVersion);
  if (!schemaVersion || !Array.isArray(d.files) || !Array.isArray(d.objects)) {
    throw new AnalysisFormatError('This does not look like a Genie Migrate analysis (expected report.schemaVersion, files and objects).');
  }
  const warnings: string[] = [];
  if (!/^0\./.test(schemaVersion)) warnings.push(`Analysis schema ${schemaVersion} is newer than the tested 0.2: some details may be missing.`);

  const entities = new Map<number, J>(arr((d.facts as J | undefined)?.entities).map((e) => [num(e.id), e]));
  const rels = arr((d.facts as J | undefined)?.relationships);
  const location = new Map<number, [number, number]>();
  const parentOf = new Map<number, number>(); // contains: target → source
  const opsOn = new Map<number, number[]>(); // relation → operating query/statement ids
  for (const r of rels) {
    const s = num(r.source), t = num(r.target);
    if (r.type === 'location' && Array.isArray(r.range) && r.range.length >= 3) location.set(s, [num(r.range[0]) + 1, num(r.range[2]) + 1]);
    else if (r.type === 'contains') parentOf.set(t, s);
    else if (r.type === 'operates') opsOn.set(t, [...(opsOn.get(t) ?? []), s]);
  }
  const fileOf = (node: number): number | null => {
    let cur: number | undefined = node;
    for (let i = 0; i < 50 && cur !== undefined; i++) {
      if (entities.get(cur)?.type === 'file') return cur;
      cur = parentOf.get(cur);
    }
    return null;
  };
  const linesOf = (node: number): [number, number] | null => {
    let cur: number | undefined = node;
    for (let i = 0; i < 50 && cur !== undefined; i++) {
      const l = location.get(cur);
      if (l) return l;
      cur = parentOf.get(cur);
    }
    return null;
  };
  // object id → evidence per (operation) from the facts graph
  const evidence = new Map<string, { fileId: number | null; lines: [number, number] | null }>();
  for (const [relId, ops] of opsOn) {
    const ent = entities.get(relId);
    const obj = ent ? num(ent.object, -1) : -1;
    if (obj < 0) continue; // CTE / alias names: not objects
    for (const op of ops) {
      const r = rels.find((x) => x.type === 'operates' && num(x.source) === op && num(x.target) === relId);
      const k = `${obj}:${str(r?.aspect) ?? ''}:${str(r?.op) ?? ''}`;
      if (!evidence.has(k)) evidence.set(k, { fileId: fileOf(op), lines: linesOf(op) });
    }
  }

  const files: AFile[] = arr(d.files).map((f) => ({
    id: num(f.id),
    path: str(f.path) ?? '?',
    loc: num(f.loc),
    hash: str(f.contentHash),
    statementsAnalyzed: num(f.statementsAnalyzed),
    statementsFailed: num(f.statementsFailed),
    unresolved: arr(f.unresolvedReferences)
      .map((u) => str(u.name) ?? str(u.raw) ?? JSON.stringify(u))
      .concat((Array.isArray(f.unresolvedReferences) ? (f.unresolvedReferences as unknown[]) : []).filter((u): u is string => typeof u === 'string')),
  }));
  const objects: AObject[] = arr(d.objects).map((o) => ({ id: num(o.id), name: str(o.name) ?? `#${String(o.id)}`, provenance: str(o.provenance) ?? 'unknown', readBy: [], createdBy: [] }));
  const objById = new Map(objects.map((o) => [o.id, o]));

  const edges: AEdge[] = [];
  for (const f of arr(d.files)) {
    for (const ref of arr(f.references)) {
      const obj = num(ref.object, -1);
      const o = objById.get(obj);
      if (!o) continue;
      const op = str(ref.op) ?? 'uses', aspect = str(ref.aspect) ?? '';
      if (op === 'read' || aspect === 'data') {
        if (!o.readBy.includes(num(f.id))) o.readBy.push(num(f.id));
        const ev = evidence.get(`${obj}:${aspect}:${op}`);
        edges.push({ key: `r:${num(f.id)}:${obj}:${op}`, kind: 'reads', fromObject: null, fromFile: num(f.id), to: obj, op, aspect, via: null, fileId: num(f.id), lines: ev?.lines ?? null });
      }
    }
  }
  for (const l of arr(d.objectLineage)) {
    const from = num(l.from, -1), to = num(l.to, -1), fileId = l.in === undefined ? null : num(l.in);
    if (!objById.has(from) || !objById.has(to)) continue;
    const op = str(l.op) ?? '', aspect = str(l.aspect) ?? '';
    const target = objById.get(to) as AObject;
    if (fileId !== null && op === 'create' && !target.createdBy.includes(fileId)) target.createdBy.push(fileId);
    const ev = evidence.get(`${to}:${aspect}:${op}`) ?? evidence.get(`${from}:data:read`);
    edges.push({ key: `l:${from}:${to}:${fileId ?? 'x'}`, kind: 'lineage', fromObject: from, fromFile: null, to, op, aspect, via: str(l.via), fileId, lines: ev?.lines ?? null });
  }
  const fl = (d.fileLineage ?? {}) as J;
  // file lineage edges are ordering constraints: { before, after } (older drafts: { from, to })
  const fileEdges = arr(fl.edges).map((e) => ({ from: num(e.before ?? e.from), to: num(e.after ?? e.to), via: str(e.via) ?? undefined }));
  const fileName = new Map(files.map((f) => [f.id, f.path]));
  const missing = objects.filter((o) => o.provenance === 'undetermined').map((o) => ({ id: o.id, name: o.name, readBy: o.readBy.map((id) => fileName.get(id) ?? `#${id}`) }));
  const analysisEnt = [...entities.values()].find((e) => e.type === 'analysis');
  return {
    schemaVersion,
    generatedAt: str(report.generatedAt),
    dialect: str(report.dialect),
    base: str(report.base),
    analyzer: analysisEnt ? `${str(analysisEnt.analyzerComponent) ?? ''} ${str(analysisEnt.analyzerVersion) ?? ''}`.trim() || null : null,
    summary: (d.summary ?? {}) as Record<string, unknown>,
    files,
    objects,
    edges,
    fileEdges,
    cycles: Array.isArray(fl.cycles) ? fl.cycles : [],
    executionOrder: Array.isArray(fl.executionOrder) ? (fl.executionOrder as unknown[]).map((x) => num(x)) : [],
    missing,
    warnings,
  };
}
