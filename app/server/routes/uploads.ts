/**
 * "Your own code" (optional): a team uploads its own SSIS packages, T-SQL / DDL, Agent scripts or framework YAML into
 * its own team folder, views them, copies them into its Genie Migrate input folder, drafts conversions with AI, and
 * scans them (scan job: parses only, nothing is executed) to get SSIS diagrams. Everything is scoped to the caller's
 * team; nothing leaves the team folder unless the team sends it to its own Genie Migrate input.
 */
import type { Application as Express } from 'express';
import { z } from 'zod';
import { cfg, wsFull } from '../lib/config';
import { decodeText, list, readBytes, remove, sha256Bytes, tryReadText, writeBytes, writeText } from '../lib/files';
import { HttpError, requireTeam } from '../lib/identity';
import { activeRequest, recordRequest, runLabel, runNow } from '../lib/jobs';
import { genieFolder, teamWorkDir, type TeamT } from '../lib/pack';
import { logEvent, route } from './util';

export const uploadsDir = (t: TeamT) => `${teamWorkDir(t)}/uploads`;
const scanDir = (t: TeamT) => `${uploadsDir(t)}/.scan`;
const NAME = /^[A-Za-z0-9][A-Za-z0-9 ._()+-]{0,150}$/;
const EXT = /\.(sql|dtsx|ya?ml|txt|xml)$/i;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 200;
const SCAN_TABLES = ['estate_inventory', 'estate_packages', 'estate_dataflows', 'estate_statements', 'estate_refs', 'estate_schedules', 'estate_landing', 'estate_blocker_map'];

function checkName(name: string): string {
  if (!NAME.test(name) || name.includes('..') || name.endsWith('.meta.json')) throw new HttpError(400, 'Use a plain file name (letters, digits, spaces, . _ - ( ) +).');
  if (!EXT.test(name)) throw new HttpError(400, 'Allowed file types: .sql, .dtsx, .yml, .yaml, .txt, .xml');
  return name;
}

interface UploadMeta {
  uploaded_by: string;
  ts: string;
  sha256: string;
  size: number;
  sent_to_genie_migrate?: string;
}

async function readMeta(path: string): Promise<UploadMeta | null> {
  const raw = await tryReadText(`${path}.meta.json`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UploadMeta;
  } catch {
    return null;
  }
}

export function registerUploads(app: Express): void {
  app.get(
    '/api/uploads',
    route(async (req) => {
      const c = await requireTeam(req);
      const dir = uploadsDir(c.team);
      const files = (await list(dir)).filter((e) => !e.is_directory && !e.name.startsWith('.') && !e.name.endsWith('.meta.json'));
      const summaryRaw = await tryReadText(`${scanDir(c.team)}/scan_summary.json`);
      let scan: unknown = null;
      if (summaryRaw) {
        try {
          const s = JSON.parse(summaryRaw) as { scan_id?: string; artifacts?: number; packages?: Record<string, unknown>; table_rows?: Record<string, number>; errors?: string[] };
          scan = { scan_id: s.scan_id, artifacts: s.artifacts, packages: Object.keys(s.packages ?? {}), table_rows: s.table_rows ?? {}, errors: (s.errors ?? []).slice(0, 20) };
        } catch {
          scan = null;
        }
      }
      return {
        folder: dir,
        files: await Promise.all(files.map(async (f) => ({ name: f.name, size: f.size, modified: f.modified, meta: await readMeta(`${dir}/${f.name}`) }))),
        scan,
        scan_enabled: Boolean(cfg.jobScan),
      };
    }),
  );

  app.get(
    '/api/uploads/file/:name',
    route(async (req) => {
      const c = await requireTeam(req);
      const name = checkName(String(req.params.name));
      const path = `${uploadsDir(c.team)}/${name}`;
      const b = await readBytes(path);
      const text = decodeText(b);
      return { name, content: text.slice(0, 1_500_000), truncated: text.length > 1_500_000, meta: await readMeta(path) };
    }),
  );

  /** Upload one file (base64 body; the client sends files one by one). */
  app.post(
    '/api/uploads',
    route(async (req) => {
      const c = await requireTeam(req);
      const body = z.object({ name: z.string(), content_base64: z.string().max(Math.ceil((MAX_BYTES * 4) / 3) + 16) }).parse(req.body);
      const name = checkName(body.name.trim());
      const buf = Buffer.from(body.content_base64, 'base64');
      if (!buf.length) throw new HttpError(400, 'The file is empty.');
      if (buf.length > MAX_BYTES) throw new HttpError(413, 'Files are limited to 8 MB each.');
      const dir = uploadsDir(c.team);
      const existing = (await list(dir)).filter((e) => !e.is_directory && !e.name.endsWith('.meta.json'));
      if (existing.length >= MAX_FILES && !existing.some((e) => e.name === name)) throw new HttpError(409, `Your team folder already holds ${MAX_FILES} uploaded files.`);
      await writeBytes(`${dir}/${name}`, buf);
      const meta: UploadMeta = { uploaded_by: c.email, ts: new Date().toISOString(), sha256: sha256Bytes(buf), size: buf.length };
      await writeText(`${dir}/${name}.meta.json`, JSON.stringify(meta, null, 2));
      await logEvent(c.team.id, c.email, 'own_code_uploaded', null, { name, size: buf.length });
      return { ok: true, name, meta };
    }),
  );

  app.delete(
    '/api/uploads/file/:name',
    route(async (req) => {
      const c = await requireTeam(req);
      const name = checkName(String(req.params.name));
      const path = `${uploadsDir(c.team)}/${name}`;
      await remove(path);
      await remove(`${path}.meta.json`).catch(() => undefined);
      await logEvent(c.team.id, c.email, 'own_code_deleted', null, { name });
      return { ok: true };
    }),
  );

  /** Copy an uploaded file into the team's Genie Migrate input folder (own_code/ sub-folder) as a plain workspace file. */
  app.post(
    '/api/uploads/file/:name/to-genie-migrate',
    route(async (req) => {
      const c = await requireTeam(req);
      const name = checkName(String(req.params.name));
      const path = `${uploadsDir(c.team)}/${name}`;
      const text = decodeText(await readBytes(path));
      const folder = `${genieFolder(c.team, 'genie_in')}/own_code`;
      const w = wsFull().workspace;
      await w.mkdirs({ path: folder });
      await w.import({ path: `${folder}/${name}`, format: 'RAW', overwrite: true, content: Buffer.from(text, 'utf8').toString('base64') });
      const meta = (await readMeta(path)) ?? { uploaded_by: c.email, ts: new Date().toISOString(), sha256: '', size: text.length };
      await writeText(`${path}.meta.json`, JSON.stringify({ ...meta, sent_to_genie_migrate: `${folder}/${name}` }, null, 2));
      await logEvent(c.team.id, c.email, 'own_code_to_genie_migrate', 'task2', { name });
      return { ok: true, path: `${folder}/${name}` };
    }),
  );

  /** Scan the team's uploads (job: parses SSIS / T-SQL / Agent / YAML into graph JSON + estate rows in the team folder). */
  app.post(
    '/api/uploads/scan',
    route(async (req) => {
      const c = await requireTeam(req);
      if (!cfg.jobScan) throw new HttpError(503, 'Scanning is not configured in this workspace.');
      const files = (await list(uploadsDir(c.team))).filter((e) => !e.is_directory && !e.name.startsWith('.') && !e.name.endsWith('.meta.json'));
      if (!files.length) throw new HttpError(409, 'Upload some files first.');
      const busy = await activeRequest(c.team.id);
      if (busy) throw new HttpError(409, `Another run is in progress for your team (${busy.kind}, ${busy.run_label}). Wait for it to finish.`);
      const label = runLabel(c.team.id, 'scan');
      const params = { pack_volume: cfg.packVolume, input_dir: uploadsDir(c.team), out_dir: scanDir(c.team), scan_id: label, run_label: label };
      const runId = await runNow(cfg.jobScan, params);
      await recordRequest({ team_id: c.team.id, user_email: c.email, run_label: label, job_key: 'scan', job_run_id: runId, kind: 'scan', params: { files: files.length } });
      await logEvent(c.team.id, c.email, 'own_code_scan_started', null, { run_label: label, files: files.length });
      return { run_label: label, job_run_id: runId };
    }),
  );

  app.get(
    '/api/uploads/graphs',
    route(async (req) => {
      const c = await requireTeam(req);
      return (await list(`${scanDir(c.team)}/graphs`)).filter((e) => e.name.endsWith('.json')).map((e) => e.name.replace(/\.json$/, ''));
    }),
  );

  app.get(
    '/api/uploads/graph/:id',
    route(async (req) => {
      const c = await requireTeam(req);
      const id = z.string().regex(/^[A-Za-z0-9_.-]{1,160}$/).parse(req.params.id);
      return JSON.parse(decodeText(await readBytes(`${scanDir(c.team)}/graphs/${id}.json`))) as unknown;
    }),
  );

  app.get(
    '/api/uploads/scan-table/:table',
    route(async (req) => {
      const c = await requireTeam(req);
      const t = z.enum(SCAN_TABLES as [string, ...string[]]).parse(req.params.table);
      const raw = await tryReadText(`${scanDir(c.team)}/tables/${t}.json`);
      if (!raw) return [];
      return (JSON.parse(raw) as unknown[]).slice(0, 2000);
    }),
  );
}

/** Text of an uploaded file for the AI draft route (team-scoped, path built here). */
export async function uploadedText(team: TeamT, name: string): Promise<string> {
  return decodeText(await readBytes(`${uploadsDir(team)}/${checkName(name)}`));
}

