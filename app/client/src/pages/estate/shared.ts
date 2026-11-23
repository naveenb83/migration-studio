/** Estate tables come back from SQL, so numbers may arrive as strings. Labels for landing destinations are fixed vocabulary. */
export const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export const isTrue = (v: unknown): boolean => v === true || String(v).toLowerCase() === 'true';

export const LANDING_LABEL: Record<string, string> = {
  lakeflow_connect: 'Lakeflow Connect',
  databricks_jobs: 'Databricks jobs',
  databricks_sql: 'Databricks SQL',
  federation_bridge: 'Read in place (federation)',
  review: 'Needs review',
};

export function landingTone(landing: string): string {
  if (landing === 'review') return 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-200';
  if (landing === 'federation_bridge') return 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-200';
  return 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200';
}

export interface InventoryRow {
  artifact_id: string;
  side: string;
  kind: string;
  rel_path: string;
  parse_status: string;
  n_executables: number | string | null;
  n_data_flows: number | string | null;
  n_components: number | string | null;
  n_sql: number | string | null;
  schedule_text: string | null;
  n_warnings: number | string | null;
  warnings: string | null;
  error: string | null;
}

export interface LandingRow {
  object_name: string;
  object_kind: string;
  side: string;
  landing: string;
  reason: string | null;
  artifact_id: string | null;
  package_id: string | null;
}

/** "HH:MM" to minutes after midnight, or null when the scanner did not record a time. */
export function minutesOf(t: string | null): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? '');
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
