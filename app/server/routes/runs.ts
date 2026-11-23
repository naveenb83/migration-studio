/** Recheck / Prove triggers, run status, results reads (by exact run_label), classroom toggle. */
import type { Application as Express } from 'express';
import { z } from 'zod';
import { cfg, fq, studio } from '../lib/config';
import { writeText } from '../lib/files';
import { HttpError, requireTeam } from '../lib/identity';
import { activeRequest, mapState, recordRequest, runInfo, runLabel, runLogFor, runNow } from '../lib/jobs';
import { expand, pack, teamWorkDir } from '../lib/pack';
import { renderRules } from '../lib/rules';
import { query } from '../lib/sql';
import { insertEntry, logEvent, route } from './util';

const LABEL = z.string().regex(/^[A-Za-z0-9_:.-]{1,160}$/);
const CHECK = z.string().regex(/^[A-Za-z0-9_]{1,120}$/);

/** Latest run_id for a label within the caller's team (a label is unique per trigger; this guards retries). */
async function runIdFor(teamId: string, label: string): Promise<string | null> {
  const r = await runLogFor(teamId, label);
  return r?.run_id ?? null;
}

async function classroomOn(teamId: string): Promise<boolean> {
  const rows = await query<{ on: boolean }>(
    `SELECT coalesce(payload:on::boolean, false) AS on FROM ${fq('latest_entries')} WHERE team_id = :team AND kind = 'classroom_toggle' AND entry_key = 'classroom'`,
    { team: teamId },
  );
  return Boolean(rows[0]?.on);
}

function redesignChecks(): string[] {
  return ((pack().recon as { redesign_checks?: string[] }).redesign_checks ?? []).filter(Boolean);
}

async function classroomStatus(teamId: string) {
  const needed = redesignChecks();
  const rows = await query<{ check_name: string; classification: string }>(
    `SELECT check_name, classification FROM ${fq('v_classifications')} WHERE team_id = :team`,
    { team: teamId },
  );
  const cls = new Map(rows.map((r) => [r.check_name, r.classification]));
  const missing = needed.filter((n) => cls.get(n) !== 'redesign');
  return { on: await classroomOn(teamId), unlocked: needed.length > 0 && missing.length === 0, needed, missing };
}

export function registerRuns(app: Express): void {
  app.post(
    '/api/recheck',
    route(async (req) => {
      const c = await requireTeam(req);
      const busy = await activeRequest(c.team.id);
      if (busy) throw new HttpError(409, `Another run is in progress for your team (${busy.kind}, ${busy.run_label}). Wait for it to finish.`);
      const applyAccepted = await classroomOn(c.team.id);
      const label = runLabel(c.team.id, 'recheck');
      const params = { catalog: studio().catalog, prefix: c.team.prefix, run_label: label, apply_accepted: applyAccepted ? 'true' : 'false' };
      const runId = await runNow(cfg.jobRecheck, params);
      await recordRequest({ team_id: c.team.id, user_email: c.email, run_label: label, job_key: 'recheck', job_run_id: runId, kind: 'recheck', params });
      await logEvent(c.team.id, c.email, 'recheck_started', 'task2', { run_label: label, apply_accepted: applyAccepted });
      return { run_label: label, job_run_id: runId, apply_accepted: applyAccepted };
    }),
  );

  app.post(
    '/api/prove',
    route(async (req) => {
      const c = await requireTeam(req);
      if (!cfg.jobProve) throw new HttpError(503, 'The Prove job is not configured.');
      const body = z
        .object({
          template_ids: z.array(z.string().regex(/^[a-z0-9_]+$/)).min(1).max(6),
          params: z.record(z.string(), z.record(z.string(), z.number())).default({}),
          fault_id: z.string().regex(/^[a-z_]+$/).nullable(),
        })
        .parse(req.body);
      const busy = await activeRequest(c.team.id);
      if (busy) throw new HttpError(409, `Another run is in progress for your team (${busy.kind}, ${busy.run_label}). Wait for it to finish.`);
      const yaml = renderRules(c.team.id, body.template_ids, body.params);
      const config = `${teamWorkDir(c.team)}/team_rules.recon.yml`;
      await writeText(config, yaml);
      let vars = '';
      if (body.fault_id) {
        const f = pack().faults.find((x) => x.id === body.fault_id);
        if (!f?.target || !f.view) throw new HttpError(400, 'Unknown fault.');
        vars = JSON.stringify({ [f.target]: expand(f.view, c.team) });
      }
      const label = runLabel(c.team.id, body.fault_id ? `prove_${body.fault_id}` : 'prove_clean');
      const params = { catalog: studio().catalog, prefix: c.team.prefix, config, vars, run_label: label, results_schema: `${studio().catalog}.${c.team.prefix}recon` };
      const runId = await runNow(cfg.jobProve, params);
      await recordRequest({
        team_id: c.team.id, user_email: c.email, run_label: label, job_key: 'prove', job_run_id: runId, kind: 'prove',
        params: { template_ids: body.template_ids, params: body.params, fault_id: body.fault_id },
      });
      await logEvent(c.team.id, c.email, 'prove_started', 'task4', { run_label: label, fault_id: body.fault_id, templates: body.template_ids });
      return { run_label: label, job_run_id: runId, rules_yaml: yaml };
    }),
  );

  /** Short poll (client calls every ~10 s). Only the team's own runs. */
  app.get(
    '/api/jobs/:id',
    route(async (req) => {
      const c = await requireTeam(req);
      const id = Number(req.params.id);
      const rows = await query<{ run_label: string; kind: string; params: string }>(
        `SELECT run_label, kind, params FROM ${fq('requests')} WHERE team_id = :team AND job_run_id = :id LIMIT 1`,
        { team: c.team.id, id },
      );
      const r = rows[0];
      if (!r) throw new HttpError(404, 'Not one of your team runs.');
      const info = await runInfo(id);
      let log = null;
      if (!info.active) {
        for (let i = 0; i < 3 && !log; i++) {
          log = await runLogFor(c.team.id, r.run_label);
          if (!log && i < 2) await new Promise((res) => setTimeout(res, 2500));
        }
      }
      const state = mapState(r.kind, info, log);
      const reason =
        state === 'artifact_error' || state === 'infra_error'
          ? (info.error.match(/(recheck REJECTED[^\n]*|unresolved placeholders[^\n]*|config not found[^\n]*|[A-Za-z]*Exception:[^\n]*)/)?.[0] ?? info.message).slice(0, 500)
          : null;
      return { run_label: r.run_label, kind: r.kind, job_run_id: id, state, life: info.life, result: info.result, started_at: info.startedAt, ended_at: info.endedAt, run_log: log, reason };
    }),
  );

  app.get(
    '/api/requests',
    route(async (req) => {
      const c = await requireTeam(req);
      return query(
        `SELECT run_label, kind, job_run_id, user_email, CAST(ts AS STRING) AS ts, params FROM ${fq('requests')} WHERE team_id = :team ORDER BY ts DESC LIMIT 30`,
        { team: c.team.id },
      );
    }),
  );

  /** The team's labelled runs (one row per label: the latest run_id). */
  app.get(
    '/api/runs',
    route(async (req) => {
      const c = await requireTeam(req);
      return query(
        `SELECT run_label, run_id, CAST(run_ts AS STRING) AS run_ts, entity, n_pass, n_fail, n_warn, n_info, n_error, n_blocking, apply_accepted, approval_mode,
                CASE WHEN run_label LIKE 'baseline%' THEN 'baseline' WHEN run_label LIKE '%_prove_%' THEN 'prove' WHEN run_label LIKE '%recheck%' THEN 'recheck' ELSE 'other' END AS kind
         FROM ${fq('v_run_log')} WHERE team_id = :team AND run_label NOT LIKE 'seed\\_%'
         QUALIFY row_number() OVER (PARTITION BY run_label ORDER BY run_ts DESC) = 1
         ORDER BY CASE WHEN run_label LIKE 'baseline%' THEN 0 ELSE 1 END, run_ts DESC LIMIT 100`,
        { team: c.team.id },
      );
    }),
  );

  app.get(
    '/api/runs/:label/checks',
    route(async (req) => {
      const c = await requireTeam(req);
      const label = LABEL.parse(req.params.label);
      const runId = await runIdFor(c.team.id, label);
      if (!runId) throw new HttpError(404, 'No results for that run label yet.');
      const rows = await query(
        `SELECT r.level, r.check_name, r.description, r.severity, r.status, r.raw_status, r.metric, r.raw_metric, r.expect, r.detail, r.raw_detail,
                r.coverage, r.sample_rows, r.accepted_applied, r.approval_status, r.approval_mode,
                k.classification, k.owner AS class_owner, k.evidence AS class_evidence, k.saved_by AS class_saved_by
         FROM ${fq('v_check_results')} r
         LEFT JOIN ${fq('v_classifications')} k ON k.team_id = r.team_id AND k.check_name = r.check_name
         WHERE r.team_id = :team AND r.run_id = :run ORDER BY r.level, r.check_name`,
        { team: c.team.id, run: runId },
      );
      const layerMap = pack().recon.check_layer_map;
      return { run_label: label, run_id: runId, checks: rows.map((r) => ({ ...r, layer: layerMap[String(r.check_name)] ?? null })) };
    }),
  );

  app.get(
    '/api/runs/:label/samples/:check',
    route(async (req) => {
      const c = await requireTeam(req);
      const runId = await runIdFor(c.team.id, LABEL.parse(req.params.label));
      if (!runId) return [];
      const rows = await query<{ row_no: number; sample_json: string }>(
        `SELECT row_no, sample_json FROM ${fq('v_mismatch_samples')} WHERE team_id = :team AND run_id = :run AND check_name = :check ORDER BY row_no LIMIT 100`,
        { team: c.team.id, run: runId, check: CHECK.parse(req.params.check) },
      );
      return rows.map((r) => {
        try {
          return JSON.parse(r.sample_json) as unknown;
        } catch {
          return { raw: r.sample_json };
        }
      });
    }),
  );

  /** Explanation for this run, else the pre-generated baseline explanation for the same check (labelled). */
  app.get(
    '/api/runs/:label/explanation/:check',
    route(async (req) => {
      const c = await requireTeam(req);
      const check = CHECK.parse(req.params.check);
      const runId = await runIdFor(c.team.id, LABEL.parse(req.params.label));
      const rows = await query(
        `SELECT e.run_id, l.run_label, e.category, e.probable_cause, e.suggested_fix, e.confirm_query, e.endpoint, CAST(e.explained_ts AS STRING) AS explained_ts
         FROM ${fq('v_ai_explanations')} e JOIN ${fq('v_run_log')} l ON l.team_id = e.team_id AND l.run_id = e.run_id
         WHERE e.team_id = :team AND e.check_name = :check AND (e.run_id = :run OR l.run_label LIKE 'baseline%' OR l.run_label LIKE 'seed\\_%')
         ORDER BY CASE WHEN e.run_id = :run THEN 0 ELSE 1 END, e.explained_ts DESC LIMIT 1`,
        { team: c.team.id, check, run: runId ?? '' },
      );
      const r = rows[0] as Record<string, unknown> | undefined;
      return r ? { ...r, from_baseline: r.run_id !== runId } : null;
    }),
  );

  app.get(
    '/api/runs/:label/artifacts',
    route(async (req) => {
      const c = await requireTeam(req);
      const runId = await runIdFor(c.team.id, LABEL.parse(req.params.label));
      if (!runId) return [];
      return query(
        `SELECT artifact, path, sha256, executed_as FROM ${fq('v_run_artifacts')} WHERE team_id = :team AND run_id = :run ORDER BY artifact`,
        { team: c.team.id, run: runId },
      );
    }),
  );

  /** Per-check status in two runs (e.g. baseline vs a recheck). */
  app.get(
    '/api/compare',
    route(async (req) => {
      const c = await requireTeam(req);
      const [a, b] = [LABEL.parse(req.query.a), LABEL.parse(req.query.b)];
      const [ra, rb] = await Promise.all([runIdFor(c.team.id, a), runIdFor(c.team.id, b)]);
      if (!ra || !rb) throw new HttpError(404, 'Both runs need results.');
      return query(
        `SELECT coalesce(x.check_name, y.check_name) AS check_name, coalesce(x.level, y.level) AS level, x.status AS status_a, y.status AS status_b
         FROM (SELECT * FROM ${fq('v_check_results')} WHERE team_id = :team AND run_id = :ra) x
         FULL OUTER JOIN (SELECT * FROM ${fq('v_check_results')} WHERE team_id = :team AND run_id = :rb) y ON x.check_name = y.check_name
         ORDER BY level, check_name`,
        { team: c.team.id, ra, rb },
      );
    }),
  );

  app.get('/api/classroom', route(async (req) => classroomStatus((await requireTeam(req)).team.id)));

  app.post(
    '/api/classroom',
    route(async (req) => {
      const c = await requireTeam(req);
      const { on } = z.object({ on: z.boolean() }).parse(req.body);
      const s = await classroomStatus(c.team.id);
      if (on && !s.unlocked) throw new HttpError(409, `Classify these checks as agreed redesign first: ${s.missing.join(', ')}`);
      await insertEntry(c.team.id, c.email, 'classroom_toggle', 'classroom', { on });
      await logEvent(c.team.id, c.email, 'classroom_toggle', 'task3', { on });
      return { ...s, on };
    }),
  );
}
