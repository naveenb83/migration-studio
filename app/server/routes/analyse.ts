/**
 * Genie Analyse: import Genie Migrate "Analyze" results (analysis.json, written by the migration project into its
 * output folder; there is no API) for the caller's team, keep an immutable snapshot in the team folder, serve the
 * parsed dependency model and line-level evidence. Read-only towards the workspace: nothing is executed, team files are
 * never overwritten.
 */
import type { Application as Express } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { list, readText, tryReadText, writeText } from '../lib/files';
import { HttpError, requireTeam } from '../lib/identity';
import { AnalysisFormatError, parseAnalysis } from '../lib/analysis';
import { cfg, wsFull } from '../lib/config';
import { genieFolder, pack, teamWorkDir, workspaceRoot, type TeamT } from '../lib/pack';
import { logEvent, route } from './util';

const snapDir = (t: TeamT) => `${teamWorkDir(t)}/analysis`;
const teamRoot = (t: TeamT) => `${workspaceRoot()}/teams/${t.id}`;
const searchFolders = (t: TeamT) => [genieFolder(t, 'genie_out'), `${teamRoot(t)}/genie_analyse`];
const ID = /^an-\d{14}-[a-f0-9]{4}$/;

interface SnapMeta {
  id: string;
  source: 'genie_migrate_analyze' | 'uploaded';
  from: string;
  generated_at: string | null;
  schema_version: string;
  dialect: string | null;
  files: number;
  objects: number;
  missing: number;
  imported_by: string;
  imported_at: string;
  sha256: string;
}

async function exportBytes(path: string): Promise<Buffer> {
  const r = await wsFull().workspace.export({ path, format: 'SOURCE' });
  return Buffer.from(r.content ?? '', 'base64');
}

async function folderUrl(path: string): Promise<string | null> {
  try {
    const id = (await wsFull().workspace.getStatus({ path })).object_id;
    return id ? `${(wsFull().config.host ?? '').replace(/\/$/, '')}/browse/folders/${String(id)}` : null;
  } catch {
    return null;
  }
}

async function findAnalyses(t: TeamT): Promise<Array<{ path: string; modified: number | null; size: number | null }>> {
  const out: Array<{ path: string; modified: number | null; size: number | null }> = [];
  for (const root of searchFolders(t)) {
    const stack: Array<[string, number]> = [[root, 0]];
    while (stack.length && out.length < 50) {
      const [p, depth] = stack.pop() as [string, number];
      try {
        for await (const o of wsFull().workspace.list({ path: p })) {
          const path = o.path ?? '';
          if (String(o.object_type) === 'DIRECTORY' && depth < 3) stack.push([path, depth + 1]);
          else if (/(^|\/)analysis[^/]*\.json$/i.test(path)) out.push({ path, modified: o.modified_at ? Number(o.modified_at) : null, size: o.size ? Number(o.size) : null });
        }
      } catch {
        /* folder may not exist yet */
      }
    }
  }
  return out.sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0));
}

async function saveSnapshot(t: TeamT, email: string, text: string, source: SnapMeta['source'], from: string): Promise<SnapMeta> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new HttpError(422, 'The file is not valid JSON.');
  }
  let model;
  try {
    model = parseAnalysis(raw);
  } catch (e) {
    if (e instanceof AnalysisFormatError) throw new HttpError(422, e.message);
    throw e;
  }
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const id = `an-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}-${createHash('sha1').update(text + Math.random()).digest('hex').slice(0, 4)}`;
  const meta: SnapMeta = {
    id, source, from, generated_at: model.generatedAt, schema_version: model.schemaVersion, dialect: model.dialect,
    files: model.files.length, objects: model.objects.length, missing: model.missing.length,
    imported_by: email, imported_at: d.toISOString(), sha256: createHash('sha256').update(text).digest('hex'),
  };
  await writeText(`${snapDir(t)}/${id}.json`, text);
  await writeText(`${snapDir(t)}/${id}.meta.json`, JSON.stringify(meta, null, 2));
  await logEvent(t.id, email, 'genie_analyse_imported', 'task1', { id, source, from, files: meta.files, missing: meta.missing });
  return meta;
}

async function snapshots(t: TeamT): Promise<SnapMeta[]> {
  const metas = (await list(snapDir(t))).filter((e) => e.name.endsWith('.meta.json'));
  const out: SnapMeta[] = [];
  for (const m of metas) {
    const raw = await tryReadText(m.path);
    if (raw) {
      try {
        out.push(JSON.parse(raw) as SnapMeta);
      } catch {
        /* skip */
      }
    }
  }
  return out.sort((a, b) => b.imported_at.localeCompare(a.imported_at));
}

export function registerAnalyse(app: Express): void {
  app.get(
    '/api/genie-analyse',
    route(async (req) => {
      const c = await requireTeam(req);
      const [candidates, imports] = await Promise.all([findAnalyses(c.team), snapshots(c.team)]);
      return {
        candidates,
        imports,
        input_folder: genieFolder(c.team, 'genie_in'),
        input_url: await folderUrl(genieFolder(c.team, 'genie_in')),
        output_folder: genieFolder(c.team, 'genie_out'),
        output_url: await folderUrl(genieFolder(c.team, 'genie_out')),
        workspace_url: (wsFull().config.host ?? '').replace(/\/$/, ''),
      };
    }),
  );

  app.post(
    '/api/genie-analyse/import',
    route(async (req) => {
      const c = await requireTeam(req);
      const { path } = z.object({ path: z.string().max(600) }).parse(req.body);
      if (!searchFolders(c.team).some((f) => path.startsWith(`${f}/`)) || path.includes('..')) throw new HttpError(400, "Import only from your team's Genie Migrate folders.");
      const bytes = await exportBytes(path);
      if (bytes.length > 25 * 1024 * 1024) throw new HttpError(413, 'Analysis file is larger than 25 MB.');
      return saveSnapshot(c.team, c.email, bytes.toString('utf8'), 'genie_migrate_analyze', path);
    }),
  );

  /** Fallback: an analysis.json exported/downloaded elsewhere and uploaded from the browser. */
  app.post(
    '/api/genie-analyse/upload',
    route(async (req) => {
      const c = await requireTeam(req);
      const body = z.object({ name: z.string().max(200), content: z.string().max(25 * 1024 * 1024) }).parse(req.body);
      return saveSnapshot(c.team, c.email, body.content, 'uploaded', body.name);
    }),
  );

  app.get(
    '/api/genie-analyse/model',
    route(async (req) => {
      const c = await requireTeam(req);
      const all = await snapshots(c.team);
      const id = typeof req.query.id === 'string' && ID.test(req.query.id) ? req.query.id : all[0]?.id;
      if (!id) return null;
      const meta = all.find((m) => m.id === id);
      if (!meta) throw new HttpError(404, 'No such analysis.');
      return { meta, model: parseAnalysis(JSON.parse(await readText(`${snapDir(c.team)}/${id}.json`))) };
    }),
  );

  /** Evidence lines for one file of an analysis: from the analysed folder if it is the team's own, else the pack copy. */
  app.get(
    '/api/genie-analyse/evidence',
    route(async (req) => {
      const c = await requireTeam(req);
      const q = z.object({ id: z.string().regex(ID), file: z.string().max(300), from: z.coerce.number().int().min(1), to: z.coerce.number().int().min(1) }).parse(req.query);
      if (q.file.includes('..')) throw new HttpError(400, 'Bad file.');
      const model = parseAnalysis(JSON.parse(await readText(`${snapDir(c.team)}/${q.id}.json`)));
      const f = model.files.find((x) => x.path === q.file);
      if (!f) throw new HttpError(404, 'File not in this analysis.');
      let bytes: Buffer | null = null;
      let source = '';
      const base = (model.base ?? '').replace(/\/$/, '');
      if (base && (base === teamRoot(c.team) || base.startsWith(`${teamRoot(c.team)}/`))) {
        try {
          bytes = await exportBytes(`${base}/${q.file}`);
          source = 'analysed folder';
        } catch {
          bytes = null;
        }
      }
      if (!bytes) {
        const legacyDirs = ((pack() as { estate?: { code_dirs?: string[] } }).estate?.code_dirs ?? []).map((d) => `${cfg.packVolume}/${d.replace(/^legacy\//, 'legacy/')}`);
        for (const d of [`${cfg.packVolume}/legacy`, ...legacyDirs]) {
          const name = q.file.split('/').pop() as string;
          const sub = (await list(d)).filter((e) => e.is_directory).map((e) => `${e.path}/${name}`);
          for (const p of [`${d}/${name}`, ...sub]) {
            const t = await tryReadText(p);
            if (t !== null) {
              bytes = Buffer.from(t, 'utf8');
              source = 'pack copy';
              break;
            }
          }
          if (bytes) break;
        }
      }
      if (!bytes) throw new HttpError(404, 'The analysed file is not available to show.');
      const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
      const lines = text.split('\n');
      const a = Math.max(1, q.from - 2), b = Math.min(lines.length, q.to + 2);
      const now = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      return { file: q.file, source, from: q.from, to: q.to, lines: lines.slice(a - 1, b).map((t, i) => ({ n: a + i, text: t.replace(/\r$/, '') })), stale: Boolean(f.hash && f.hash !== now), truncated: b - a > 400 };
    }),
  );
}
