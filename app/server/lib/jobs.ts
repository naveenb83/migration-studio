/**
 * Job triggers and status, via the Jobs API directly (as the app SP, which holds CAN_MANAGE_RUN through the app
 * resource). No plugin cache: run status must never freeze. Requests never wait for a job (120 s proxy limit).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { fq, ws } from './config';
import { exec, query } from './sql';

export type RunState = 'queued' | 'running' | 'passed' | 'completed' | 'gate_rejected' | 'artifact_error' | 'infra_error';

export function runLabel(teamId: string, kind: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const ts = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
  return `app_${teamId}_${kind}_${ts}_${randomBytes(2).toString('hex')}`;
}

const ACTIVE = new Set(['PENDING', 'QUEUED', 'RUNNING', 'BLOCKED', 'WAITING_FOR_RETRY', 'TERMINATING']);

export async function runNow(jobId: number, params: Record<string, string>): Promise<number> {
  const r = await ws().jobs.runNow({ job_id: jobId, job_parameters: params });
  const id = Number(r.run_id);
  if (!id) throw new Error('Jobs API returned no run_id');
  return id;
}

export interface RunInfo {
  life: string;
  result: string;
  message: string;
  active: boolean;
  error: string;
  startedAt: number | null;
  endedAt: number | null;
}

export async function runInfo(runId: number): Promise<RunInfo> {
  const c = ws();
  const r = await c.jobs.getRun({ run_id: runId });
  const life = String(r.state?.life_cycle_state ?? r.status?.state ?? 'UNKNOWN');
  const result = String(r.state?.result_state ?? '');
  let error = '';
  if (!ACTIVE.has(life) && result && result !== 'SUCCESS') {
    const tasks = r.tasks ?? [];
    const last = tasks[tasks.length - 1];
    if (last?.run_id) {
      try {
        const out = await c.jobs.getRunOutput({ run_id: last.run_id });
        error = `${out.error ?? ''}\n${(out.error_trace ?? '').slice(-1500)}`.trim();
      } catch {
        error = '';
      }
    }
  }
  return {
    life,
    result,
    message: String(r.state?.state_message ?? ''),
    active: ACTIVE.has(life),
    error: error.slice(0, 2000),
    startedAt: r.start_time ? Number(r.start_time) : null,
    endedAt: r.end_time ? Number(r.end_time) : null,
  };
}

export interface RunLogRow {
  run_id: string;
  run_label: string;
  n_pass: number;
  n_fail: number;
  n_warn: number;
  n_info: number;
  n_error: number;
  n_blocking: number;
  apply_accepted: boolean | null;
  approval_mode: string | null;
  run_ts: string;
}

export async function runLogFor(teamId: string, label: string): Promise<RunLogRow | null> {
  const rows = await query<RunLogRow & Record<string, unknown>>(
    `SELECT run_id, run_label, n_pass, n_fail, n_warn, n_info, n_error, n_blocking, apply_accepted, approval_mode, CAST(run_ts AS STRING) AS run_ts
     FROM ${fq('v_run_log')} WHERE team_id = :team AND run_label = :label ORDER BY run_ts DESC LIMIT 1`,
    { team: teamId, label },
  );
  return rows[0] ?? null;
}

export function mapState(kind: string, info: RunInfo, log: RunLogRow | null): RunState {
  if (info.active) return info.life === 'RUNNING' ? 'running' : 'queued';
  if (info.result === 'SUCCESS') {
    if (!log) return 'completed';
    return Number(log.n_blocking) === 0 ? 'passed' : 'completed';
  }
  const text = `${info.error}\n${info.message}`;
  if (/recheck REJECTED|required artifacts missing|unresolved placeholders|config not found/i.test(text)) return 'artifact_error';
  if (log && (kind === 'prove' || kind === 'cprove' || /VALIDATION GATE FAILED/i.test(text))) return 'gate_rejected';
  return 'infra_error';
}

export async function recordRequest(r: {
  team_id: string;
  user_email: string;
  run_label: string;
  job_key: string;
  job_run_id: number;
  kind: string;
  params: Record<string, unknown>;
}): Promise<void> {
  await exec(
    `INSERT INTO ${fq('requests')} (id, ts, team_id, user_email, run_label, job_key, job_run_id, kind, params)
     VALUES (:id, current_timestamp(), :team_id, :user_email, :run_label, :job_key, :job_run_id, :kind, :params)`,
    { id: randomUUID(), team_id: r.team_id, user_email: r.user_email, run_label: r.run_label, job_key: r.job_key, job_run_id: r.job_run_id, kind: r.kind, params: JSON.stringify(r.params) },
  );
}

/** One in-flight run per team: returns the active request if there is one. */
export async function activeRequest(teamId: string): Promise<{ run_label: string; job_run_id: number; kind: string } | null> {
  const rows = await query<{ run_label: string; job_run_id: number; kind: string }>(
    `SELECT run_label, job_run_id, kind FROM ${fq('requests')} WHERE team_id = :team ORDER BY ts DESC LIMIT 3`,
    { team: teamId },
  );
  for (const r of rows) {
    try {
      if ((await runInfo(Number(r.job_run_id))).active) return r;
    } catch {
      /* unknown run: ignore */
    }
  }
  return null;
}
