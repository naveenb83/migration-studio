/** Legacy vs converted: shapes from /api/converted, /api/conversion and the job's run report. */
export interface ConvertedFile {
  name: string;
  size: number;
  source: string;
  from: string | null;
  include: boolean;
  saved_by: string | null;
  ts: string | null;
  sha256: string | null;
  summary: { statements: number; creates: string[]; writes: string[]; commentOnly: boolean; warnings: string[] };
}

export interface ConversionInfo {
  sandbox: string;
  read_schemas: string[];
  outputs: Array<{ id: string; label: string; legacy_object: string | null; legacy_table: string; key: string[]; explain: string }>;
  feeds: Array<{ label: string; from: string; why: string }>;
  stand_ins: Array<{ label: string; name: string; why: string }>;
  ignore_columns: string[];
  edge: { label: string; explain: string } | null;
  overrides: { names?: Record<string, string>; outputs?: Record<string, string>; columns?: Record<string, Record<string, string | null>> };
  tables: string[];
  job_configured: boolean;
}

export interface ReportStep {
  n: number;
  kind: string;
  status: 'ran' | 'failed' | 'blocked' | 'skip' | 'run';
  reason: string;
  target: string | null;
  from_procedure: string | null;
  reads: Record<string, string>;
  ms: number;
  preview: string;
  sql: string;
}

export interface ReportOutput {
  id: string;
  label: string;
  explain: string;
  legacy_table: string;
  converted_object: string | null;
  found_by: string;
  columns: Array<{ legacy: string; converted: string; how: string; legacy_type: string; converted_type: string; key: boolean }>;
  keys: Array<{ legacy: string; converted: string }>;
  ignored_legacy: string[];
  ignored_converted: string[];
  unmatched_legacy: string[];
  unmatched_converted: string[];
  rows?: { legacy: number; converted: number };
  error?: string;
}

export interface RunReport {
  run_label: string;
  mode: string;
  started: string;
  finished?: string;
  files: Array<{ name: string; path: string; sha256: string; steps: ReportStep[] }>;
  prep: Array<{ label: string; name: string; why: string; sql: string; status: string; error?: string }>;
  feeds: Array<{ label: string; target: string; from: string; why: string; how?: string; rows?: number; status: string; error?: string }>;
  outputs: ReportOutput[];
  unresolved: Array<{ name: string; file: string; n: number }>;
  edge: { schemas: Record<string, string>; seed_statements: number; legacy_runner: Array<{ file: string; statements: number }>; explain: string } | null;
  fault: { output: string; fault: string; view: string; what: string; column: string; key: string } | null;
  validation: { run_id?: string; n_pass?: number; n_fail?: number; n_warn?: number; n_info?: number; n_error?: number; n_blocking?: number; gate: boolean; gate_error: string | null } | null;
  errors: string[];
}

export const short = (fqn: string | null | undefined) => (fqn ? fqn.split('.').slice(-2).join('.') : '');

export const STEP_TONE: Record<string, string> = {
  ran: 'text-emerald-700',
  failed: 'text-red-700',
  blocked: 'text-amber-700',
  skip: 'text-muted-foreground',
};

/** Every compared output has a converted object and at least one matched column. */
export const comparedAll = (r: RunReport | null | undefined) =>
  r ? r.outputs.length > 0 && r.outputs.every((o) => Boolean(o.converted_object) && o.columns.length > 0) : null;
