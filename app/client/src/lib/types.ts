/** Client-side shapes of the studio API (see docs/03_contracts.md §10). */
export interface TeamRef {
  id: string;
  name: string;
  prefix: string;
}

export interface DoneWhen {
  id: string;
  label: string;
  rule?: string;
}

export interface TaskDef {
  id: string;
  title: string;
  kicker?: string;
  minutes?: number;
  steps?: string[];
  done_when?: DoneWhen[];
  watch_for?: string;
  fallback?: string;
}

export interface RuleTemplate {
  id: string;
  label: string;
  description?: string;
  level?: string;
  severity?: string;
  expect?: string;
  sql: string;
  sample_sql?: string;
  catches?: string[];
  key_check?: boolean;
  params?: Array<{ name: string; label: string; default?: number; options?: number[] }>;
}

export interface ManifestItem {
  artifact: string;
  file: string;
  required: boolean;
  kind: string;
  view_schema?: string;
  allowed_mechanisms?: string[];
}

/** The public pack (no physical table names). Loose: pages read what they need. */
export interface PublicPack {
  engagement: { id: string; title: string; customer_label?: string; date?: string; timezone?: string; disclaimer?: string; facilitators: string[] };
  teams: TeamRef[];
  demo_team: TeamRef;
  dataset: {
    id: string;
    title: string;
    summary?: string;
    grain_legacy?: string;
    grain_new?: string;
    logical_tables: string[];
    lanes?: Record<string, Array<{ id: string; label: string; code_path?: string; table?: string }>>;
  } & Record<string, unknown>;
  manifest: ManifestItem[];
  recon: {
    check_layer_map: Record<string, string>;
    layers: Record<string, { title: string; compares: string; question: string; how: string }>;
    expected_scorecards?: Record<string, Record<string, number>>;
    redesign_checks?: string[];
  };
  faults: Array<{ id: string; label: string; description: string; target?: string }>;
  rule_templates: RuleTemplate[];
  agenda: Array<{ start: string; end: string; title: string; task_id: string | null; outputs?: string }>;
  tasks: TaskDef[];
  rules_contract: Array<{ key: string; label: string; help?: string }>;
  lineage_template: { columns: string[]; seed_rows?: Array<Record<string, unknown>> };
  prompts: Array<{ id: string; title: string; text: string }>;
  questions: Array<{ id: string; group?: string; question: string; why?: string; who?: string; priority?: string }>;
  findings: Array<{ id: string; noticed: string; why?: string; decision?: string }>;
  outcomes: Array<{ id: string; challenge: string; today: string; measure: string }>;
  pipelines_landing: Array<{ today: string; goes_to: string; check?: string }>;
  closeout_questions: string[];
  pilot?: Record<string, string[]>;
  genie_migrate?: { url?: string; steps?: string[]; ssis_preview?: boolean; prepared_example_dir?: string };
  genie_spaces?: Record<string, { title: string; description?: string; instructions?: string; sample_questions?: string[] }>;
  assistant?: { skill_dirs?: string[]; extra_instructions?: string };
  estate?: { code_dirs?: string[]; dataset_status?: Record<string, string>; sql_instances?: Record<string, string> };
  features: Record<string, boolean>;
  narrative?: Array<{ title: string; body: string }>;
}

export interface Me {
  email: string;
  team: TeamRef | null;
  role: string | null;
  is_facilitator: boolean;
  features: Record<string, boolean>;
  teams: TeamRef[];
  genie_aliases: string[];
  draft_enabled: boolean;
  build: string;
  pack: PublicPack;
}

export interface EntryRow<P = Record<string, unknown>> {
  entry_key: string;
  payload: P;
  user_email: string;
  ts: string;
}

export interface RunRow {
  run_label: string;
  run_id: string;
  run_ts: string;
  entity: string;
  n_pass: number;
  n_fail: number;
  n_warn: number;
  n_info: number;
  n_error: number;
  n_blocking: number;
  apply_accepted: boolean | null;
  approval_mode: string | null;
  kind: 'baseline' | 'recheck' | 'prove' | 'other';
}

export interface CheckRow {
  level: string;
  check_name: string;
  description: string;
  severity: string;
  status: string;
  raw_status: string;
  metric: number | null;
  raw_metric: number | null;
  expect: string;
  detail: string;
  raw_detail: string | null;
  coverage: number | null;
  sample_rows: number | null;
  accepted_applied: boolean | null;
  approval_status: string | null;
  approval_mode: string | null;
  classification: string | null;
  class_owner: string | null;
  class_evidence: string | null;
  class_saved_by: string | null;
  layer: string | null;
}

export type RunState = 'queued' | 'running' | 'passed' | 'completed' | 'gate_rejected' | 'artifact_error' | 'infra_error';

export interface JobStatus {
  run_label: string;
  kind: string;
  job_run_id: number;
  state: RunState;
  life: string;
  result: string;
  started_at: number | null;
  ended_at: number | null;
  run_log: Pick<RunRow, 'run_id' | 'run_label' | 'n_pass' | 'n_fail' | 'n_warn' | 'n_info' | 'n_error' | 'n_blocking' | 'apply_accepted' | 'approval_mode' | 'run_ts'> | null;
  reason: string | null;
}

export const TERMINAL: RunState[] = ['passed', 'completed', 'gate_rejected', 'artifact_error', 'infra_error'];
