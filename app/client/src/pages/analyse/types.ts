/** Mirrors server/lib/analysis.ts (the parsed Genie Migrate Analyze model). */
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
  provenance: string;
  readBy: number[];
  createdBy: number[];
}
export interface AEdge {
  key: string;
  kind: 'reads' | 'lineage';
  fromObject: number | null;
  fromFile: number | null;
  to: number;
  op: string;
  aspect: string;
  via: string | null;
  fileId: number | null;
  lines: [number, number] | null;
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
export interface SnapMeta {
  id: string;
  source: 'genie_migrate_analyze' | 'uploaded';
  from: string;
  generated_at: string | null;
  schema_version: string;
  dialect: string | null;
  files: number;
  objects: number;
  missing: number;
  imported_by: string;
  imported_at: string;
}
export interface Decision {
  decision?: 'confirmed' | 'rejected' | 'follow_up';
  note?: string;
  source?: 'native' | 'manual';
  analysis_id?: string;
}
export interface ManualDep {
  from?: string;
  to?: string;
  op?: string;
  file?: string;
  lines?: string;
  note?: string;
}

/** Object names (db.schema.object) → last part; file names stay whole. */
export const shortName = (n: string) => (/\.(sql|dtsx|ya?ml|txt|xml|json)$/i.test(n) ? n : n.split('.').slice(-1)[0]);
export const linesText = (l: [number, number] | null) => (l ? (l[0] === l[1] ? `L${l[0]}` : `L${l[0]}–L${l[1]}`) : '');
