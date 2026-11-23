/** Home summary, facilitator board + health, pack reload, evidence export, estate reads. */
import type { Application as Express } from 'express';
import { z } from 'zod';
import { cfg, fq, ws } from '../lib/config';
import { list, readText, sha256, tryReadText, writeText } from '../lib/files';
import { caller, requireFacilitator, requireTeam } from '../lib/identity';
import { activeRequest, runInfo } from '../lib/jobs';
import { allTeams, loadPack, pack, packLoadedAt, teamWorkDir } from '../lib/pack';
import { query } from '../lib/sql';
import { safeJson } from './core';
import { logEvent, route } from './util';

const ESTATE_TABLES = ['estate_inventory', 'estate_packages', 'estate_dataflows', 'estate_statements', 'estate_refs', 'estate_blocker_map', 'estate_schedules', 'estate_landing', 'estate_scan_log'];

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export function registerFac(app: Express): void {
  app.get(
    '/api/home',
    route(async (req) => {
      const c = await caller(req);
      const agenda = await query<{ entry_key: string; payload: string; ts: string }>(
        `SELECT entry_key, payload, CAST(ts AS STRING) AS ts FROM ${fq('latest_entries')} WHERE kind = 'agenda' AND team_id = '_all'`,
      );
      const team = c.team
        ? {
            last_run: (
              await query(
                `SELECT run_label, n_pass, n_fail, n_warn, n_info, n_error, n_blocking, CAST(run_ts AS STRING) AS run_ts FROM ${fq('v_run_log')}
                 WHERE team_id = :team ORDER BY run_ts DESC LIMIT 1`,
                { team: c.team.id },
              )
            )[0] ?? null,
            active: await safe(() => activeRequest(c.team!.id), null),
            tasks_done: (await query<{ task_id: string }>(`SELECT task_id FROM ${fq('v_task_progress')} WHERE team_id = :team AND status = 'done'`, { team: c.team.id })).map((r) => r.task_id),
          }
        : null;
      const measures = {
        time_per_step: await safe(() => query(`SELECT task_id, percentile_approx(minutes, 0.5) AS median_minutes, count(*) AS teams FROM ${fq('v_time_per_step')} WHERE minutes IS NOT NULL GROUP BY task_id ORDER BY task_id`), []),
        assets_created: Number((await safe(() => query<{ n: number }>(`SELECT count(*) AS n FROM ${fq('events')} WHERE event_type IN ('file_saved','draft_saved','genie_migrate_import','genie_migrate_paste','prove_started')`), [{ n: 0 }]))[0]?.n ?? 0),
        blocker_map: await safe(() => query(`SELECT * FROM ${fq('estate_blocker_map')} LIMIT 20`), []),
        landing: await safe(() => query(`SELECT landing, count(*) AS n FROM ${fq('estate_landing')} GROUP BY landing ORDER BY n DESC`), []),
      };
      return { agenda: agenda.map((a) => ({ ...a, payload: safeJson(a.payload) })), team, measures };
    }),
  );

  app.get(
    '/api/fac/board',
    route(async (req) => {
      await requireFacilitator(req);
      const [runs, acts, done, reqs] = await Promise.all([
        query(`SELECT team_id, run_label, n_pass, n_fail, n_warn, n_info, n_error, n_blocking, CAST(run_ts AS STRING) AS run_ts FROM ${fq('v_run_log')} QUALIFY row_number() OVER (PARTITION BY team_id ORDER BY run_ts DESC) = 1`),
        query(`SELECT team_id, CAST(max(ts) AS STRING) AS last_activity, max_by(event_type, ts) AS last_event, max_by(task_id, ts) AS last_task FROM ${fq('events')} WHERE team_id IS NOT NULL GROUP BY team_id`),
        query(`SELECT team_id, collect_set(task_id) AS tasks_done FROM ${fq('v_task_progress')} WHERE status = 'done' GROUP BY team_id`),
        query<{ team_id: string; run_label: string; kind: string; job_run_id: number; ts: string }>(
          `SELECT team_id, run_label, kind, job_run_id, CAST(ts AS STRING) AS ts FROM ${fq('requests')} QUALIFY row_number() OVER (PARTITION BY team_id ORDER BY ts DESC) = 1`,
        ),
      ]);
      const by = <T extends Record<string, unknown>>(rows: T[]) => new Map(rows.map((r) => [String(r.team_id), r]));
      const [mr, ma, md, mq] = [by(runs), by(acts), by(done), by(reqs)];
      return Promise.all(
        allTeams().map(async (t) => {
          const last = mq.get(t.id) as { run_label: string; kind: string; job_run_id: number; ts: string } | undefined;
          const info = last ? await safe(() => runInfo(Number(last.job_run_id)), null) : null;
          return {
            team_id: t.id, name: t.name, prefix: t.prefix,
            last_run: mr.get(t.id) ?? null,
            activity: ma.get(t.id) ?? null,
            tasks_done: (md.get(t.id) as { tasks_done?: string[] } | undefined)?.tasks_done ?? [],
            last_request: last ? { ...last, life: info?.life ?? null, result: info?.result ?? null } : null,
          };
        }),
      );
    }),
  );

  app.get(
    '/api/fac/health',
    route(async (req) => {
      await requireFacilitator(req);
      const c = ws();
      const check = async (name: string, fn: () => Promise<string>) => {
        const t0 = Date.now();
        try {
          return { name, ok: true, detail: await fn(), ms: Date.now() - t0 };
        } catch (e) {
          return { name, ok: false, detail: String((e as Error).message).slice(0, 240), ms: Date.now() - t0 };
        }
      };
      return Promise.all([
        check('SQL warehouse', async () => `${(await query<{ ok: number }>('SELECT 1 AS ok'))[0]?.ok === 1 ? 'responding' : 'odd result'}`),
        check('Pack', () => Promise.resolve(`${pack().engagement.title}, loaded ${packLoadedAt()}`)),
        check('Results views', async () => `${(await query<{ n: number }>(`SELECT count(*) AS n FROM ${fq('v_run_log')}`))[0]?.n} runs across teams`),
        check('Recheck job', async () => (await c.jobs.get({ job_id: cfg.jobRecheck })).settings?.name ?? 'ok'),
        check('Prove job', async () => (cfg.jobProve ? ((await c.jobs.get({ job_id: cfg.jobProve })).settings?.name ?? 'ok') : 'not configured')),
        check('Model endpoint', async () => (cfg.servingEndpoint ? String((await c.servingEndpoints.get({ name: cfg.servingEndpoint })).state?.ready ?? 'unknown') : 'not configured')),
        ...Object.entries(cfg.genieSpaces)
          .filter(([, v]) => v)
          .map(([k, id]) => check(`Genie space (${k})`, async () => (await c.genie.getSpace({ space_id: id })).title ?? 'ok')),
        check('Estate tables', async () => `${(await query<{ n: number }>(`SELECT count(*) AS n FROM ${fq('estate_inventory')}`))[0]?.n} inventory rows`),
      ]);
    }),
  );

  app.post(
    '/api/fac/reload-pack',
    route(async (req) => {
      const c = await requireFacilitator(req);
      const p = await loadPack();
      await logEvent(null, c.email, 'pack_reloaded', null, { title: p.engagement.title });
      return { ok: true, loaded_at: packLoadedAt() };
    }),
  );

  app.get(
    '/api/estate/:table',
    route(async (req) => {
      await caller(req);
      const t = z.enum(ESTATE_TABLES as [string, ...string[]]).parse(req.params.table);
      return safe(() => query(`SELECT * FROM ${fq(t)} LIMIT 1000`), []);
    }),
  );

  app.get(
    '/api/estate-graphs',
    route(async (req) => {
      await caller(req);
      return (await list(`${cfg.packVolume}/estate/graphs`)).filter((e) => e.name.endsWith('.json')).map((e) => e.name.replace(/\.json$/, ''));
    }),
  );

  app.get(
    '/api/estate-graph/:id',
    route(async (req) => {
      await caller(req);
      const id = z.string().regex(/^[A-Za-z0-9_.-]{1,120}$/).parse(req.params.id);
      return JSON.parse(await readText(`${cfg.packVolume}/estate/graphs/${id}.json`)) as unknown;
    }),
  );

  /** Team evidence pack: markdown (+ checks CSV); a copy goes to the exports volume. */
  app.get(
    '/api/export',
    route(async (req) => {
      const c = await requireTeam(req);
      const team = c.team;
      const latest = (kind: string) =>
        query<{ entry_key: string; payload: string; user_email: string }>(
          `SELECT entry_key, payload, user_email FROM ${fq('latest_entries')} WHERE team_id = :team AND kind = :kind ORDER BY entry_key`,
          { team: team.id, kind },
        );
      const [lineage, rules, classes, questions, closeout, runs] = await Promise.all([
        latest('lineage_row'), latest('rule_decision'), latest('classification'), latest('question_answer'), latest('closeout_answer'),
        query<Record<string, unknown>>(
          `SELECT run_label, n_pass, n_fail, n_warn, n_info, n_error, n_blocking, apply_accepted, CAST(run_ts AS STRING) AS run_ts FROM ${fq('v_run_log')}
           WHERE team_id = :team QUALIFY row_number() OVER (PARTITION BY run_label ORDER BY run_ts DESC) = 1 ORDER BY run_ts`,
          { team: team.id },
        ),
      ]);
      const files = await Promise.all(
        pack().manifest.map(async (m) => {
          const t = await tryReadText(`${teamWorkDir(team)}/${m.file}`);
          const meta = safeJson((await tryReadText(`${teamWorkDir(team)}/${m.file}.meta.json`)) ?? '{}') as { source?: string; saved_by?: string; ts?: string };
          return { file: m.file, sha256: t === null ? '(missing)' : sha256(t), source: meta.source ?? 'seed', saved_by: meta.saved_by ?? '', ts: meta.ts ?? '' };
        }),
      );
      const kv = (p: string) => Object.entries((safeJson(p) as Record<string, unknown>) ?? {}).map(([k, v]) => `${k}: ${String(v)}`).join('; ');
      const md = [
        `# Evidence pack: ${team.name}`,
        `${pack().engagement.title} · exported ${new Date().toISOString()} by ${c.email}`,
        '',
        `> ${(pack().engagement as { disclaimer?: string }).disclaimer ?? 'Workshop exercise.'} Classroom approvals are SIMULATED, not sign-off.`,
        '',
        '## Lineage worksheet', ...lineage.map((r) => `- **${r.entry_key}**: ${kv(r.payload)}`), '',
        '## Rules agreed', ...rules.map((r) => `- **${r.entry_key}**: ${kv(r.payload)}`), '',
        '## Team files (what the recheck executes)', '| File | SHA-256 | Source | Saved by | When |', '|---|---|---|---|---|',
        ...files.map((f) => `| ${f.file} | \`${f.sha256.slice(0, 16)}\` | ${f.source} | ${f.saved_by} | ${f.ts} |`), '',
        '## Labelled runs', '| Run label | PASS | FAIL | WARN | INFO | ERROR | Classroom |', '|---|---|---|---|---|---|---|',
        ...runs.map((r) => `| ${String(r.run_label)} | ${String(r.n_pass)} | ${String(r.n_fail)} | ${String(r.n_warn)} | ${String(r.n_info)} | ${String(r.n_error)} | ${r.apply_accepted ? 'SIMULATED' : ''} |`), '',
        '## Classifications', ...classes.map((r) => `- **${r.entry_key}**: ${kv(r.payload)}`), '',
        '## Open questions', ...questions.map((r) => `- **${r.entry_key}**: ${kv(r.payload)}`), '',
        '## Close-out', ...closeout.map((r) => `- **${r.entry_key}**: ${kv(r.payload)}`), '',
      ].join('\n');
      const csv = ['run_label,n_pass,n_fail,n_warn,n_info,n_error,n_blocking,run_ts', ...runs.map((r) => [r.run_label, r.n_pass, r.n_fail, r.n_warn, r.n_info, r.n_error, r.n_blocking, r.run_ts].map((v) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v as string | number | boolean))).join(','))].join('\n');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      let saved: string | null = null;
      if (cfg.exportsVolume) {
        saved = `${cfg.exportsVolume}/${team.id}/evidence_${stamp}.md`;
        await safe(async () => {
          await writeText(saved as string, md);
          await writeText(`${cfg.exportsVolume}/${team.id}/runs_${stamp}.csv`, csv);
        }, undefined);
      }
      await logEvent(team.id, c.email, 'export', 'close', { saved });
      return { markdown: md, csv, saved };
    }),
  );
}

