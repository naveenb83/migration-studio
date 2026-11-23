/** /api/me, /api/entries, /api/events, /api/setup/check, /api/pack/*, /api/data/:logical */
import type { Application as Express } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { cfg, fq, wsFull } from '../lib/config';
import { list, readText, remove, walk, writeText } from '../lib/files';
import { caller, forgetRoster, HttpError, requireTeam } from '../lib/identity';
import { genieFolder, pack, publicPack, tableFor, teamById, teamWorkDir } from '../lib/pack';
import { query } from '../lib/sql';
import { insertEntry, logEvent, route } from './util';

const KEY = z.string().regex(/^[A-Za-z0-9_.:@+-]{1,160}$/);
const Scalar = z.union([z.string().max(8000), z.number(), z.boolean(), z.null()]);
const Payload = z.record(z.string().max(60), z.union([Scalar, z.array(Scalar).max(50)])).refine((o) => Object.keys(o).length <= 40);

/** Register kinds the generic /api/entries write accepts (classroom_toggle and agenda have their own rules). */
const KINDS: Record<string, z.ZodType> = {
  lineage_row: Payload,
  rule_decision: Payload,
  classification: Payload.and(z.object({ class: z.enum(['defect', 'redesign', 'inherited_dq', 'open_question']) })),
  question_answer: Payload,
  finding_decision: Payload,
  closeout_answer: Payload,
  pilot_plan: Payload,
  estimate: Payload,
  task_progress: Payload.and(z.object({ status: z.enum(['started', 'done']) })),
};
const ROLES = ['driver', 'navigator', 'business_owner', 'observer', 'facilitator'] as const;

export function registerCore(app: Express): void {
  app.get(
    '/api/me',
    route(async (req) => {
      const c = await caller(req);
      const p = pack();
      return {
        email: c.email,
        team: c.team ? { id: c.team.id, name: c.team.name, prefix: c.team.prefix } : null,
        role: c.role,
        is_facilitator: c.isFacilitator,
        features: p.features,
        teams: [...p.teams, p.demo_team].map((t) => ({ id: t.id, name: t.name, prefix: t.prefix })),
        genie_aliases: Object.entries(cfg.genieSpaces).filter(([, v]) => v).map(([k]) => k),
        draft_enabled: Boolean(cfg.servingEndpoint),
        build: cfg.buildVersion,
        pack: publicPack(),
      };
    }),
  );

  /** Join a team / change role (the roster). */
  app.post(
    '/api/roster',
    route(async (req) => {
      const c = await caller(req);
      const body = z.object({ team_id: z.string(), role: z.enum(ROLES), display_name: z.string().max(80).optional() }).parse(req.body);
      const team = teamById(body.team_id);
      if (!team) throw new HttpError(400, 'Unknown team.');
      if (body.role === 'facilitator' && !c.isFacilitator) throw new HttpError(403, 'Only facilitators can take the facilitator role.');
      await insertEntry(team.id, c.email, 'roster', c.email, { role: body.role, display_name: body.display_name ?? null, previous_team: c.team?.id ?? null });
      forgetRoster(c.email);
      await logEvent(team.id, c.email, c.team && c.team.id !== team.id ? 'team_changed' : 'roster_set', null, { role: body.role });
      return { ok: true };
    }),
  );

  app.get(
    '/api/roster',
    route(async (req) => {
      const c = await requireTeam(req);
      return query(
        `SELECT entry_key AS email, payload:role::string AS role, payload:display_name::string AS display_name, CAST(ts AS STRING) AS since
         FROM ${fq('latest_entries')} WHERE kind = 'roster' AND team_id = :team ORDER BY ts`,
        { team: c.team.id },
      );
    }),
  );

  app.get(
    '/api/entries',
    route(async (req) => {
      const kind = z.string().regex(/^[a-z_]+$/).parse(req.query.kind);
      if (kind === 'agenda') {
        return query(`SELECT entry_key, payload, user_email, CAST(ts AS STRING) AS ts FROM ${fq('latest_entries')} WHERE kind = 'agenda' AND team_id = '_all'`);
      }
      const c = await requireTeam(req);
      const rows = await query<{ entry_key: string; payload: string; user_email: string; ts: string }>(
        `SELECT entry_key, payload, user_email, CAST(ts AS STRING) AS ts FROM ${fq('latest_entries')} WHERE kind = :kind AND team_id = :team ORDER BY ts`,
        { kind, team: c.team.id },
      );
      return rows.map((r) => ({ ...r, payload: safeJson(r.payload) }));
    }),
  );

  app.post(
    '/api/entries',
    route(async (req) => {
      const body = z.object({ kind: z.string(), entry_key: KEY, payload: z.unknown(), deleted: z.boolean().optional() }).parse(req.body);
      if (body.kind === 'agenda') {
        const c = await caller(req);
        if (!c.isFacilitator) throw new HttpError(403, 'Only facilitators set the agenda.');
        const payload = Payload.parse(body.payload ?? {});
        await insertEntry('_all', c.email, 'agenda', body.entry_key, payload, Boolean(body.deleted));
        return { ok: true };
      }
      const schema = KINDS[body.kind];
      if (!schema) throw new HttpError(400, `Kind '${body.kind}' cannot be written here.`);
      const c = await requireTeam(req);
      const payload = body.deleted ? {} : schema.parse(body.payload ?? {});
      await insertEntry(c.team.id, c.email, body.kind, body.entry_key, payload, Boolean(body.deleted));
      return { ok: true };
    }),
  );

  app.post(
    '/api/events',
    route(async (req) => {
      const body = z.object({ event_type: z.string().regex(/^[a-z_]{2,40}$/), task_id: z.string().max(40).nullish(), payload: z.unknown().optional() }).parse(req.body);
      const c = await caller(req);
      await logEvent(c.team?.id ?? null, c.email, body.event_type, body.task_id ?? null, body.payload ?? {});
      return { ok: true };
    }),
  );

  /** Setup: four access probes for the caller, recorded as an event. */
  app.post(
    '/api/setup/check',
    route(async (req) => {
      const c = await requireTeam(req);
      const probe = async (fn: () => Promise<string>) => {
        try {
          return { ok: true, detail: await fn() };
        } catch (e) {
          return { ok: false, detail: String((e as Error).message ?? e).slice(0, 300) };
        }
      };
      const p = pack();
      const firstLogical = Object.keys(p.dataset.tables)[0];
      const results = {
        read_team_data: await probe(async () => {
          const r = await query<{ n: number }>(`SELECT count(*) AS n FROM ${tableFor(firstLogical, c.team)}`);
          return `${Number(r[0]?.n ?? 0).toLocaleString()} rows in your team's ${firstLogical.split('_').join(' ')}`;
        }),
        write_team_files: await probe(async () => {
          const path = `${teamWorkDir(c.team)}/drafts/.access_check_${createHash('sha256').update(c.email).digest('hex').slice(0, 10)}.txt`;
          await writeText(path, `access check ${new Date().toISOString()}`);
          await remove(path);
          return 'saved and deleted a test file in your team folder';
        }),
        genie_migrate_input: await probe(async () => {
          let n = 0;
          for await (const o of wsFull().workspace.list({ path: genieFolder(c.team, 'genie_in') })) {
            void o;
            n++;
          }
          return `${n} item(s) ready in your Genie Migrate input folder`;
        }),
        skill_present: await probe(async () => {
          const dirs = ((p as { assistant?: { skill_dirs?: string[] } }).assistant?.skill_dirs ?? []).filter(Boolean);
          if (!dirs.length) return 'no skill configured for this engagement';
          const files = await list(`${cfg.packVolume}/${dirs[0]}`);
          if (!files.some((f) => /SKILL\.md$/i.test(f.name))) throw new Error('SKILL.md not found in the pack');
          return 'framework skill available';
        }),
      };
      await logEvent(c.team.id, c.email, 'access_check', 'setup', results);
      return results;
    }),
  );

  /** Read-only browsing of the pack's code folders (legacy code, prepared examples, graphs). */
  const PACK_DIRS = ['legacy', 'prepared_examples', 'estate/graphs'];
  const packRel = (rel: string) => {
    const r = String(rel ?? '').replace(/^\/+/, '');
    if (!r || r.includes('..') || !PACK_DIRS.some((d) => r === d || r.startsWith(`${d}/`))) throw new HttpError(400, 'Path not allowed.');
    return r;
  };
  app.get(
    '/api/pack/tree',
    route(async (req) => {
      const dir = packRel(String(req.query.dir ?? 'legacy'));
      const files = await walk(`${cfg.packVolume}/${dir}`, 400);
      return files.map((f) => ({ path: f.path.slice(cfg.packVolume.length + 1), size: f.size }));
    }),
  );
  app.get(
    '/api/pack/file',
    route(async (req) => {
      const rel = packRel(String(req.query.path ?? ''));
      const text = await readText(`${cfg.packVolume}/${rel}`);
      return { path: rel, content: text.slice(0, 600_000), truncated: text.length > 600_000 };
    }),
  );

  /** Sample rows from the caller's own team table (allow-listed logical name, server-side expansion). */
  app.get(
    '/api/data/:logical',
    route(async (req) => {
      const c = await requireTeam(req);
      const logical = z.string().regex(/^[a-z0-9_]+$/).parse(req.params.logical);
      const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 20) || 20));
      const t = tableFor(logical, c.team);
      const [rows, count] = await Promise.all([
        query(`SELECT * FROM ${t} LIMIT ${limit}`),
        query<{ n: number }>(`SELECT count(*) AS n FROM ${t}`),
      ]);
      return { logical, rows, total: Number(count[0]?.n ?? 0) };
    }),
  );
}

export function safeJson(s: unknown): unknown {
  if (typeof s !== 'string') return s;
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
