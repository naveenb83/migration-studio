/**
 * Legacy vs converted (Tasks 2-4): the team's converted SQL (drafts), the mapping, Run my files, Prove, run reports.
 *
 * The app never runs SQL itself: it writes an immutable run snapshot (config + file list with SHA-256) into the team's
 * folder and starts the convert job, which runs the converted code in the team's sandbox schema and compares it with
 * legacy. Table names never come from the client unchecked: overrides must be one of the team's own allowed tables.
 */
import type { Application as Express } from 'express';
import { z } from 'zod';
import { cfg, fq, studio } from '../lib/config';
import { list, readBytes, sha256Bytes, tryReadText, writeText } from '../lib/files';
import { sqlSummary } from '../lib/geniemigrate';
import { HttpError, requireTeam } from '../lib/identity';
import { activeRequest, recordRequest, runLabel, runNow } from '../lib/jobs';
import { pack, teamWorkDir, type TeamT } from '../lib/pack';
import { query } from '../lib/sql';
import { insertEntry, logEvent, route, SAFE_NAME } from './util';
import { draftsDir, readMeta, saveWithMeta } from './work';

const LABEL = z.string().regex(/^[A-Za-z0-9_:.-]{1,160}$/);
const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,120}$/;
const RUN_BY_DEFAULT = new Set(['genie_migrate', 'pasted', 'team_edit', 'prepared_example']);

interface ConvOutput {
  id: string;
  label?: string;
  legacy_object?: string;
  legacy_table: string;
  match?: string[];
  kinds?: string[];
  key?: string[];
  prepare?: string;
  explain?: string;
}
interface ConvCfg {
  sandbox: string;
  read_schemas: string[];
  inputs?: Record<string, string>;
  feeds?: Array<{ match: string; from: string; label?: string; why?: string }>;
  stand_ins?: Array<{ kind: string; name: string; sql: string; label?: string; why?: string }>;
  outputs: ConvOutput[];
  ignore_columns?: string[];
  edge?: Record<string, unknown> & { seed_sql?: string; label?: string; explain?: string };
}
interface Overrides {
  names?: Record<string, string>;
  outputs?: Record<string, string>;
  columns?: Record<string, Record<string, string | null>>;
}

function conv(): ConvCfg {
  const c = (pack() as { conversion?: ConvCfg }).conversion;
  if (!c) throw new HttpError(503, 'This pack has no legacy-vs-converted settings (pack.conversion).');
  return c;
}

/** Expand {cat} {prefix} {sandbox} everywhere, for one team. */
function expanded(team: TeamT): ConvCfg {
  const s = studio();
  const sandbox = conv().sandbox.split('{cat}').join(s.catalog).split('{prefix}').join(team.prefix);
  const walk = (v: unknown): unknown =>
    typeof v === 'string'
      ? v.split('{cat}').join(s.catalog).split('{prefix}').join(team.prefix).split('{sandbox}').join(sandbox)
      : Array.isArray(v)
        ? v.map(walk)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]))
          : v;
  const out = walk(conv()) as ConvCfg;
  // stand-in SQL keeps {sandbox}: the job fills it with the sandbox it actually uses (edge cases use their own)
  out.stand_ins = (conv().stand_ins ?? []).map((x) => ({ ...x, sql: x.sql.split('{cat}').join(s.catalog).split('{prefix}').join(team.prefix) }));
  for (const t of [out.sandbox, ...out.read_schemas]) if (!/^[a-z0-9_]+\.[a-z0-9_]+$/.test(t)) throw new HttpError(500, `bad schema in pack.conversion: ${t}`);
  return out;
}

async function overridesFor(teamId: string): Promise<Overrides> {
  const rows = await query<{ payload: string }>(
    `SELECT CAST(payload AS STRING) AS payload FROM ${fq('latest_entries')} WHERE team_id = :team AND kind = 'conversion_mapping' AND entry_key = 'mapping'`,
    { team: teamId },
  );
  try {
    return rows[0] ? (JSON.parse(rows[0].payload) as Overrides) : {};
  } catch {
    return {};
  }
}

/** Tables the converted code may read: every table in the team's allowed read schemas. */
async function candidateTables(c: ConvCfg): Promise<string[]> {
  const [cat] = c.read_schemas[0].split('.');
  const schemas = c.read_schemas.map((x) => x.split('.')[1]);
  const params = Object.fromEntries(schemas.map((x, i) => [`s${i}`, x]));
  const rows = await query<{ s: string; t: string }>(
    `SELECT table_schema AS s, table_name AS t FROM ${cat}.information_schema.tables WHERE ${schemas.map((_, i) => `table_schema = :s${i}`).join(' OR ')} ORDER BY 1, 2`,
    params,
  );
  return rows.map((r) => `${cat}.${r.s}.${r.t}`);
}

interface DraftInfo {
  name: string;
  size: number;
  source: string;
  from: string | null;
  include: boolean;
  saved_by: string | null;
  ts: string | null;
  sha256: string | null;
}

async function draftList(team: TeamT): Promise<DraftInfo[]> {
  const dir = draftsDir(team);
  const entries = (await list(dir)).filter((e) => !e.is_directory && !e.name.endsWith('.meta.json') && !e.name.startsWith('.') && /\.sql$/i.test(e.name));
  return Promise.all(
    entries.map(async (e) => {
      const m = await readMeta(`${dir}/${e.name}`);
      const source = m?.source ?? 'team_edit';
      return { name: e.name, size: e.size, source, from: m?.from ?? null, include: m?.include ?? RUN_BY_DEFAULT.has(source), saved_by: m?.saved_by ?? null, ts: m?.ts ?? null, sha256: m?.sha256 ?? null };
    }),
  );
}

/** Snapshot for one run: config (expanded + overrides) and the exact files with their SHA-256. */
async function writeSnapshot(team: TeamT, label: string): Promise<{ files: Array<{ name: string; sha256: string }> }> {
  const included = (await draftList(team)).filter((d) => d.include);
  if (included.length === 0) throw new HttpError(409, 'No converted files to run: import them in Convert, then tick "Run" in Review & save.');
  const files = await Promise.all(
    included.map(async (d) => {
      const path = `${draftsDir(team)}/${d.name}`;
      return { name: d.name, path, sha256: sha256Bytes(await readBytes(path)) };
    }),
  );
  const runDir = `${teamWorkDir(team)}/runs/${label}`;
  await writeText(`${runDir}/config.json`, JSON.stringify({ ...expanded(team), overrides: await overridesFor(team.id) }, null, 1));
  await writeText(`${runDir}/manifest.json`, JSON.stringify({ run_label: label, files }, null, 1));
  return { files: files.map(({ name, sha256 }) => ({ name, sha256 })) };
}

async function startRun(team: TeamT, email: string, kind: 'convert' | 'cprove', mode: string, labelKind: string, extra: Record<string, string> = {}) {
  if (!cfg.jobConvert) throw new HttpError(503, 'The convert job is not configured (DATABRICKS_JOB_CONVERT).');
  const busy = await activeRequest(team.id);
  if (busy) throw new HttpError(409, `Another run is in progress for your team (${busy.kind}, ${busy.run_label}). Wait for it to finish.`);
  const label = runLabel(team.id, labelKind);
  const snap = await writeSnapshot(team, label);
  const params = { catalog: studio().catalog, prefix: team.prefix, team_dir: teamWorkDir(team), run_label: label, mode, fault: extra.fault ?? '', output_id: extra.output_id ?? '' };
  const runId = await runNow(cfg.jobConvert, params);
  await recordRequest({ team_id: team.id, user_email: email, run_label: label, job_key: 'convert', job_run_id: runId, kind, params: { mode, ...extra, files: snap.files } });
  await logEvent(team.id, email, `${kind}_started`, kind === 'convert' ? 'task2' : 'task4', { run_label: label, mode, ...extra, files: snap.files.length });
  return { run_label: label, job_run_id: runId, files: snap.files };
}

export function registerConversion(app: Express): void {
  /** The converted SQL files in drafts, with a quick summary (the job does the real, parsed check). */
  app.get(
    '/api/converted',
    route(async (req) => {
      const c = await requireTeam(req);
      const dir = draftsDir(c.team);
      return Promise.all(
        (await draftList(c.team)).map(async (d) => ({ ...d, summary: sqlSummary((await tryReadText(`${dir}/${d.name}`)) ?? '') })),
      );
    }),
  );

  app.get(
    '/api/converted/:name',
    route(async (req) => {
      const c = await requireTeam(req);
      const name = String(req.params.name);
      if (!SAFE_NAME.test(name)) throw new HttpError(400, 'Bad file name.');
      const path = `${draftsDir(c.team)}/${name}`;
      const content = await tryReadText(path);
      if (content === null) throw new HttpError(404, 'No such converted file.');
      return { name, content, meta: await readMeta(path), summary: sqlSummary(content) };
    }),
  );

  /** Edit a converted file and/or choose whether it runs. An edit keeps where it came from. */
  app.put(
    '/api/converted/:name',
    route(async (req) => {
      const c = await requireTeam(req);
      const name = String(req.params.name);
      if (!SAFE_NAME.test(name) || !/\.sql$/i.test(name)) throw new HttpError(400, 'Bad file name.');
      const body = z.object({ content: z.string().max(400_000).optional(), include: z.boolean().optional() }).parse(req.body);
      const path = `${draftsDir(c.team)}/${name}`;
      const content = body.content ?? (await tryReadText(path));
      if (content === null) throw new HttpError(404, 'No such converted file.');
      const prev = await readMeta(path);
      const include = body.include ?? prev?.include ?? RUN_BY_DEFAULT.has(prev?.source ?? 'team_edit');
      const source = body.content !== undefined && body.content !== null ? 'team_edit' : (prev?.source ?? 'team_edit');
      const meta = await saveWithMeta(path, content, source, c.email, prev?.from, include);
      await logEvent(c.team.id, c.email, body.content !== undefined ? 'converted_edited' : 'converted_include', 'task2', { name, include, sha256: meta.sha256 });
      return { ok: true, meta };
    }),
  );

  /** What will be compared, and the team's mapping choices. */
  app.get(
    '/api/conversion',
    route(async (req) => {
      const c = await requireTeam(req);
      const x = expanded(c.team);
      return {
        sandbox: x.sandbox,
        read_schemas: x.read_schemas,
        outputs: x.outputs.map((o) => ({ id: o.id, label: o.label ?? o.id, legacy_object: o.legacy_object ?? null, legacy_table: o.legacy_table, key: o.key ?? [], explain: o.explain ?? '' })),
        feeds: (x.feeds ?? []).map((f) => ({ label: f.label ?? 'Feed', from: f.from, why: f.why ?? '' })),
        stand_ins: (x.stand_ins ?? []).map((s) => ({ label: s.label ?? 'Stand-in', name: s.name, why: s.why ?? '' })),
        ignore_columns: x.ignore_columns ?? [],
        edge: x.edge ? { label: x.edge.label ?? 'Edge cases', explain: x.edge.explain ?? '' } : null,
        overrides: await overridesFor(c.team.id),
        tables: await candidateTables(x),
        job_configured: Boolean(cfg.jobConvert),
      };
    }),
  );

  /** Save mapping choices. Every table must be one of the team's allowed tables; names are plain identifiers. */
  app.put(
    '/api/conversion/mapping',
    route(async (req) => {
      const c = await requireTeam(req);
      const body = z
        .object({
          names: z.record(z.string().max(200), z.string().max(300)).default({}),
          outputs: z.record(z.string().max(60), z.string().max(130)).default({}),
          columns: z.record(z.string().max(60), z.record(z.string().max(130), z.string().max(130).nullable())).default({}),
        })
        .parse(req.body);
      const x = expanded(c.team);
      const allowed = new Set(await candidateTables(x));
      for (const [k, v] of Object.entries(body.names)) {
        if (!/^[A-Za-z0-9_.`]+$/.test(k)) throw new HttpError(400, `Bad name ${k}`);
        if (!allowed.has(v)) throw new HttpError(400, `${v} isn't one of your team's tables`);
      }
      const ids = new Set(x.outputs.map((o) => o.id));
      const outputs: Record<string, string> = {};
      for (const [id, name] of Object.entries(body.outputs)) {
        if (!ids.has(id) || !IDENT.test(name)) throw new HttpError(400, `Bad output choice ${id}`);
        outputs[id] = `${x.sandbox}.${name.toLowerCase()}`;
      }
      for (const [id, cols] of Object.entries(body.columns)) {
        if (!ids.has(id)) throw new HttpError(400, `Unknown output ${id}`);
        for (const [l, cv] of Object.entries(cols)) if (!IDENT.test(l) || (cv !== null && !IDENT.test(cv))) throw new HttpError(400, `Bad column ${l}`);
      }
      const payload = { names: body.names, outputs, columns: body.columns };
      await insertEntry(c.team.id, c.email, 'conversion_mapping', 'mapping', payload);
      await logEvent(c.team.id, c.email, 'conversion_mapping_saved', 'task3', { names: Object.keys(body.names).length, outputs: Object.keys(outputs).length });
      return { ok: true, overrides: payload };
    }),
  );

  /** Task 2: Run my files (the converted SQL), then compare with legacy. */
  app.post('/api/convert-run', route(async (req) => {
    const c = await requireTeam(req);
    return startRun(c.team, c.email, 'convert', 'run', 'convert');
  }));

  /** Task 4: prove it. clean = gate; fault = gate on a copy with one planted fault; edge = tricky source rows. */
  app.post(
    '/api/conversion/prove',
    route(async (req) => {
      const c = await requireTeam(req);
      const body = z
        .object({
          mode: z.enum(['clean', 'fault', 'edge']),
          fault: z.enum(['wrong_value', 'missing_row', 'extra_row']).optional(),
          output_id: z.string().regex(/^[a-z0-9_]{1,60}$/).optional(),
        })
        .parse(req.body);
      if (body.mode === 'edge' && !conv().edge) throw new HttpError(400, 'This pack has no edge cases.');
      const fault = body.mode === 'fault' ? (body.fault ?? 'wrong_value') : undefined;
      const labelKind = body.mode === 'fault' ? `cprove_fault_${fault}` : `cprove_${body.mode}`;
      return startRun(c.team, c.email, 'cprove', `prove_${body.mode}`, labelKind, {
        ...(fault ? { fault } : {}),
        ...(body.output_id ? { output_id: body.output_id } : {}),
      });
    }),
  );

  /** The job's report for one of the team's runs: statements, stand-ins, feeds, matching, outcome. */
  app.get(
    '/api/conversion/report/:label',
    route(async (req) => {
      const c = await requireTeam(req);
      const label = LABEL.parse(req.params.label);
      if (!label.startsWith(`app_${c.team.id}_`)) throw new HttpError(404, 'Not one of your team runs.');
      const raw = await tryReadText(`${teamWorkDir(c.team)}/runs/${label}/report.json`);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return null;
      }
    }),
  );
}
