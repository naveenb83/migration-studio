/** Task 2: team files, drafts, Genie Migrate hand-off + import, prepared examples, streamed AI draft. */
import type { Application as Express } from 'express';
import { z } from 'zod';
import { cfg, ws, wsFull } from '../lib/config';
import { list, readText, sha256, tryReadText, writeText } from '../lib/files';
import { HttpError, requireTeam } from '../lib/identity';
import { genieFolder, pack, teamWorkDir, type TeamT } from '../lib/pack';
import { validateTeamFile, type ManifestItem } from '../lib/validate';
import { uploadedText } from './uploads';
import { logEvent, route, SAFE_NAME } from './util';

const SOURCES = ['team_edit', 'genie_migrate', 'genie_code', 'pasted', 'assistant_draft', 'prepared_example', 'seed'] as const;
type Source = (typeof SOURCES)[number];

interface Meta {
  source: Source;
  saved_by: string;
  ts: string;
  sha256: string;
  from?: string;
}

const manifest = () => pack().manifest as ManifestItem[];
const manifestItem = (name: string) => manifest().find((m) => m.file === name);
const draftsDir = (t: TeamT) => `${teamWorkDir(t)}/drafts`;

async function readMeta(path: string): Promise<Meta | null> {
  const raw = await tryReadText(`${path}.meta.json`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Meta;
  } catch {
    return null;
  }
}

async function saveWithMeta(path: string, content: string, source: Source, email: string, from?: string): Promise<Meta> {
  const meta: Meta = { source, saved_by: email, ts: new Date().toISOString(), sha256: sha256(content), ...(from ? { from } : {}) };
  await writeText(path, content);
  await writeText(`${path}.meta.json`, JSON.stringify(meta, null, 2));
  return meta;
}

async function workspaceText(path: string): Promise<string> {
  const r = await wsFull().workspace.export({ path, format: 'SOURCE' });
  return Buffer.from(r.content ?? '', 'base64').toString('utf8');
}

export function registerWork(app: Express): void {
  app.get(
    '/api/teamfiles',
    route(async (req) => {
      const c = await requireTeam(req);
      const dir = teamWorkDir(c.team);
      const present = new Map((await list(dir)).map((e) => [e.name, e]));
      return Promise.all(
        manifest().map(async (m) => {
          const e = present.get(m.file);
          const content = e ? await tryReadText(`${dir}/${m.file}`) : null;
          return {
            ...m,
            exists: Boolean(e),
            size: e?.size ?? 0,
            sha256: content !== null ? sha256(content) : null,
            meta: e ? (await readMeta(`${dir}/${m.file}`)) ?? { source: 'seed' } : null,
          };
        }),
      );
    }),
  );

  app.get(
    '/api/teamfiles/:name',
    route(async (req) => {
      const c = await requireTeam(req);
      const item = manifestItem(String(req.params.name));
      if (!item) throw new HttpError(404, 'Not a team file.');
      const path = `${teamWorkDir(c.team)}/${item.file}`;
      const content = await tryReadText(path);
      return { item, content: content ?? '', exists: content !== null, sha256: content !== null ? sha256(content) : null, meta: await readMeta(path) };
    }),
  );

  app.put(
    '/api/teamfiles/:name',
    route(async (req) => {
      const c = await requireTeam(req);
      const item = manifestItem(String(req.params.name));
      if (!item) throw new HttpError(404, 'Not a team file.');
      const body = z.object({ content: z.string().max(400_000), source: z.enum(SOURCES).default('team_edit'), from: z.string().max(300).optional() }).parse(req.body);
      const errors = validateTeamFile(item, body.content);
      if (errors.length) throw new HttpError(422, errors.join(' '));
      const meta = await saveWithMeta(`${teamWorkDir(c.team)}/${item.file}`, body.content, body.source, c.email, body.from);
      await logEvent(c.team.id, c.email, 'file_saved', 'task2', { file: item.file, source: body.source, sha256: meta.sha256 });
      return { ok: true, meta };
    }),
  );

  app.get(
    '/api/drafts',
    route(async (req) => {
      const c = await requireTeam(req);
      const dir = draftsDir(c.team);
      const entries = (await list(dir)).filter((e) => !e.is_directory && !e.name.endsWith('.meta.json') && !e.name.startsWith('.'));
      return Promise.all(entries.map(async (e) => ({ name: e.name, size: e.size, modified: e.modified, meta: await readMeta(`${dir}/${e.name}`) })));
    }),
  );

  app.get(
    '/api/drafts/:name',
    route(async (req) => {
      const c = await requireTeam(req);
      const name = String(req.params.name);
      if (!SAFE_NAME.test(name)) throw new HttpError(400, 'Bad draft name.');
      const path = `${draftsDir(c.team)}/${name}`;
      return { name, content: (await tryReadText(path)) ?? '', meta: await readMeta(path) };
    }),
  );

  app.post(
    '/api/drafts',
    route(async (req) => {
      const c = await requireTeam(req);
      const body = z.object({ name: z.string().regex(SAFE_NAME), content: z.string().max(400_000), source: z.enum(SOURCES).default('team_edit'), from: z.string().max(300).optional() }).parse(req.body);
      if (body.name.endsWith('.meta.json')) throw new HttpError(400, 'Bad draft name.');
      const meta = await saveWithMeta(`${draftsDir(c.team)}/${body.name}`, body.content, body.source, c.email, body.from);
      await logEvent(c.team.id, c.email, 'draft_saved', 'task2', { name: body.name, source: body.source });
      return { ok: true, meta };
    }),
  );

  /** Genie Migrate hand-off: folders, link and steps; list of converted files in the team's output folder. */
  app.get(
    '/api/genie-migrate',
    route(async (req) => {
      const c = await requireTeam(req);
      const gm = (pack() as { genie_migrate?: { url?: string; steps?: string[]; ssis_preview?: boolean } }).genie_migrate ?? {};
      const listFolder = async (path: string) => {
        const out: Array<{ path: string; name: string; type: string }> = [];
        try {
          for await (const o of wsFull().workspace.list({ path })) {
            out.push({ path: o.path ?? '', name: (o.path ?? '').split('/').pop() ?? '', type: String(o.object_type ?? '') });
            if (out.length > 200) break;
          }
        } catch (e) {
          return { error: String((e as Error).message).slice(0, 200), items: out };
        }
        return { items: out };
      };
      const outRoot = genieFolder(c.team, 'genie_out');
      const out = await listFolder(outRoot);
      // one level deeper: Genie Migrate writes a project sub-folder
      const nested: Array<{ path: string; name: string; type: string }> = [];
      for (const d of out.items.filter((i) => i.type === 'DIRECTORY').slice(0, 10)) nested.push(...(await listFolder(d.path)).items);
      return {
        url: gm.url ?? null,
        steps: gm.steps ?? [],
        ssis_preview: Boolean(gm.ssis_preview),
        input_folder: genieFolder(c.team, 'genie_in'),
        output_folder: outRoot,
        input: (await listFolder(genieFolder(c.team, 'genie_in'))).items,
        output: [...out.items.filter((i) => i.type !== 'DIRECTORY'), ...nested.filter((i) => i.type !== 'DIRECTORY')],
        output_error: out.error ?? null,
      };
    }),
  );

  app.post(
    '/api/genie-migrate/import',
    route(async (req) => {
      const c = await requireTeam(req);
      const body = z
        .union([z.object({ path: z.string().max(600) }), z.object({ name: z.string().regex(SAFE_NAME), pasted_sql: z.string().min(1).max(400_000) })])
        .parse(req.body);
      if ('path' in body) {
        const root = genieFolder(c.team, 'genie_out');
        if (!body.path.startsWith(`${root}/`) || body.path.includes('..')) throw new HttpError(400, "Import only from your team's Genie Migrate output folder.");
        const text = await workspaceText(body.path);
        const name = (body.path.split('/').pop() ?? 'converted').replace(/[^A-Za-z0-9._-]/g, '_');
        const meta = await saveWithMeta(`${draftsDir(c.team)}/${name.match(/\.(sql|ya?ml|py)$/i) ? name : `${name}.sql`}`, text, 'genie_migrate', c.email, body.path);
        await logEvent(c.team.id, c.email, 'genie_migrate_import', 'task2', { from: body.path });
        return { ok: true, name, meta };
      }
      const meta = await saveWithMeta(`${draftsDir(c.team)}/${body.name}`, body.pasted_sql, 'pasted', c.email);
      await logEvent(c.team.id, c.email, 'genie_migrate_paste', 'task2', { name: body.name });
      return { ok: true, name: body.name, meta };
    }),
  );

  /** Copy a prepared example (labelled: NOT a live conversion) into drafts. */
  app.post(
    '/api/prepared',
    route(async (req) => {
      const c = await requireTeam(req);
      const body = z.object({ name: z.string().regex(SAFE_NAME) }).parse(req.body);
      const dir = (pack() as { genie_migrate?: { prepared_example_dir?: string } }).genie_migrate?.prepared_example_dir ?? 'prepared_examples';
      const text = await readText(`${cfg.packVolume}/${dir}/${body.name}`);
      const meta = await saveWithMeta(`${draftsDir(c.team)}/prepared_${body.name}`, text, 'prepared_example', c.email, `${dir}/${body.name}`);
      await logEvent(c.team.id, c.email, 'prepared_example_used', 'task2', { name: body.name });
      return { ok: true, name: `prepared_${body.name}`, meta };
    }),
  );

  /** Streamed single-shot AI draft (SSE). Bounded input. Labelled as an AI draft in the UI. */
  app.post('/api/draft', async (req, res) => {
    let c: Awaited<ReturnType<typeof requireTeam>>;
    let body: { source_path: string; target: string; instructions?: string };
    try {
      c = await requireTeam(req);
      body = z.object({ source_path: z.string().max(300), target: z.string().max(200), instructions: z.string().max(2000).optional() }).parse(req.body);
      if (!cfg.servingEndpoint) throw new HttpError(503, 'No model endpoint configured.');
      if (!/^(legacy|uploads)\//.test(body.source_path) || body.source_path.includes('..')) throw new HttpError(400, 'Pick a legacy file or one of your uploads.');
    } catch (e) {
      res.status((e as HttpError).status || 400).json({ error: String((e as Error).message) });
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    try {
      const p = pack() as { assistant?: { skill_dirs?: string[]; extra_instructions?: string } };
      const skillDir = p.assistant?.skill_dirs?.[0];
      const skill = skillDir ? ((await tryReadText(`${cfg.packVolume}/${skillDir}/SKILL.md`)) ?? '') : '';
      const source = (body.source_path.startsWith('uploads/') ? await uploadedText(c.team, body.source_path.slice('uploads/'.length)) : await readText(`${cfg.packVolume}/${body.source_path}`)).slice(0, 60_000);
      const item = manifestItem(body.target);
      const system = [
        'You convert legacy SQL Server / SSIS logic into Databricks artefacts for a migration workshop.',
        'Return ONLY the file content for the requested target, then a short "Review notes" section as SQL comments listing assumptions and anything a human must check.',
        p.assistant?.extra_instructions ?? '',
        skill ? `Framework skill:\n${skill.slice(0, 40_000)}` : '',
      ].join('\n\n');
      const user = `Target file: ${body.target}${item ? ` (kind: ${item.kind})` : ''}\n${body.instructions ? `Extra instructions: ${body.instructions}\n` : ''}\nLegacy source (${body.source_path}):\n\n${source}`;
      const host = (ws().config.host ?? '').replace(/\/$/, '');
      const headers = new Headers({ 'Content-Type': 'application/json' });
      await ws().config.authenticate(headers);
      const ac = new AbortController();
      const firstTokenTimer = setTimeout(() => ac.abort(), 60_000);
      req.on('close', () => ac.abort());
      const r = await fetch(`${host}/serving-endpoints/${encodeURIComponent(cfg.servingEndpoint)}/invocations`, {
        method: 'POST',
        headers,
        signal: ac.signal,
        body: JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 4000, stream: true }),
      });
      if (!r.ok || !r.body) throw new Error(`Model endpoint returned ${r.status}: ${(await r.text()).slice(0, 300)}`);
      const reader: ReadableStreamDefaultReader<Uint8Array> = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let all = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const data = t.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const j = JSON.parse(data) as { choices?: Array<{ delta?: { content?: unknown } }> };
            const d = j.choices?.[0]?.delta?.content;
            const text = typeof d === 'string' ? d : Array.isArray(d) ? d.map((x: { text?: string }) => x?.text ?? '').join('') : '';
            if (text) {
              clearTimeout(firstTokenTimer);
              all += text;
              send({ delta: text });
            }
          } catch {
            /* ignore keep-alive lines */
          }
        }
      }
      clearTimeout(firstTokenTimer);
      await logEvent(c.team.id, c.email, 'ai_draft', 'task2', { source: body.source_path, target: body.target, chars: all.length });
      send({ done: true, chars: all.length });
    } catch (e) {
      const aborted = (e as Error).name === 'AbortError';
      send({ error: aborted ? 'No response from the model within 60 s. Use the prepared example instead.' : String((e as Error).message).slice(0, 400) });
    }
    res.end();
  });
}
