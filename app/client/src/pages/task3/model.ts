/** Task 3 helpers: pure functions and shared shapes. No React here. */
import type { CheckRow, RunRow, RunState } from '@/lib/types';

export const STATUSES = ['PASS', 'FAIL', 'WARN', 'INFO', 'ERROR'] as const;
export type Status = (typeof STATUSES)[number];
export const LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6'] as const;

export const KIND_LABEL: Record<RunRow['kind'], string> = {
  baseline: 'Baseline',
  recheck: 'Recheck',
  prove: 'Prove (Task 4)',
  other: 'Other',
};

/** Same values the server accepts for kind=classification (docs/03_contracts.md). */
export const CLASS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'defect', label: 'Defect: our code or mapping is wrong' },
  { value: 'redesign', label: 'Agreed redesign: an intended difference' },
  { value: 'inherited_dq', label: 'Inherited data quality: already true in the source' },
  { value: 'open_question', label: 'Open question: needs a decision' },
];

export const STATE_TEXT: Record<RunState, string> = {
  queued: 'Queued',
  running: 'Running',
  passed: 'Passed (no blocking failures)',
  completed: 'Finished with failures',
  gate_rejected: 'Gate rejected this run',
  artifact_error: 'Artifact error (the run did not start its checks)',
  infra_error: 'Infrastructure error',
};

export interface Explanation {
  category: string | null;
  probable_cause: string | null;
  suggested_fix: string | null;
  confirm_query: string | null;
  from_baseline?: boolean;
  run_id?: string;
  run_label?: string | null;
}

export interface ChecksResponse {
  run_label: string;
  run_id: string;
  checks: CheckRow[];
}

export interface CompareRow {
  check_name: string;
  level: string | null;
  status_a: string | null;
  status_b: string | null;
}

export interface ClassroomStatus {
  on: boolean;
  unlocked: boolean;
  needed: string[];
  missing: string[];
}

export interface RecheckStart {
  run_label: string;
  job_run_id: number;
  apply_accepted: boolean;
}

export const enc = (s: string) => encodeURIComponent(s);

/** Run timestamps arrive as "YYYY-MM-DD HH:MM:SS.ffffff" (naive UTC). Returns epoch ms or NaN. */
export function tsMs(ts: string | null | undefined): number {
  if (!ts) return Number.NaN;
  const s = ts.replace(' ', 'T').replace(/\.(\d{3})\d+/, '.$1');
  return Date.parse(/[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
}

export function runCount(run: RunRow, s: Status): number {
  switch (s) {
    case 'PASS':
      return Number(run.n_pass);
    case 'FAIL':
      return Number(run.n_fail);
    case 'WARN':
      return Number(run.n_warn);
    case 'INFO':
      return Number(run.n_info);
    case 'ERROR':
      return Number(run.n_error);
  }
}

/** A check is SIMULATED when the classroom approval was applied to it (never a real sign-off). */
export function isSimulated(c: Pick<CheckRow, 'accepted_applied' | 'approval_status'>): boolean {
  return c.accepted_applied === true || c.approval_status === 'SIMULATED';
}

export function isClassified(c: Pick<CheckRow, 'classification' | 'class_owner'>): boolean {
  return Boolean(c.classification) && Boolean(c.class_owner && c.class_owner.trim());
}

/** Done-when rule: every non-PASS check in the selected run has a classification with an owner. */
export function coversNonPass(checks: CheckRow[]): boolean {
  if (checks.length === 0) return false;
  return checks.every((c) => c.status === 'PASS' || isClassified(c));
}

/** Baseline first (the server orders it), otherwise the first non-prove run. */
export function defaultRunLabel(runs: RunRow[]): string | null {
  const r = runs.find((x) => x.kind === 'baseline') ?? runs.find((x) => x.kind !== 'prove') ?? runs[0];
  return r ? r.run_label : null;
}

export function levelRows(checks: CheckRow[]): Array<Record<string, string | number>> {
  return LEVELS.map((level) => {
    const row: Record<string, string | number> = { level };
    for (const s of STATUSES) row[s] = checks.filter((c) => c.level === level && c.status === s).length;
    return row;
  });
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function cellText(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}
