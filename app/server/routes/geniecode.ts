/**
 * Genie Code hand-off. Genie Code is the workspace's coding agent (notebooks, SQL editor, files); it has no API, so
 * the app (1) copies the team's files (and any uploads) into the team's Genie Code folder as workspace files plus a
 * README of suggested prompts, (2) links straight to them, and (3) brings edited files back: into drafts, or straight
 * into a team file through the same save validation, with provenance `genie_code`. The framework skill is installed
 * as a workspace skill (/Workspace/.assistant/skills/<name>/SKILL.md) by the facilitator; the app reports whether
 * it is there.
 */
import type { Application as Express } from 'express';
import { z } from 'zod';
import { wsFull } from '../lib/config';
import { sha256, tryReadText, writeText } from '../lib/files';
import { HttpError, requireTeam } from '../lib/identity';
import { pack, teamWorkDir, workspaceRoot, type TeamT } from '../lib/pack';
import { validateTeamFile, type ManifestItem } from '../lib/validate';
import { uploadedText } from './uploads';
import { logEvent, route, SAFE_NAME } from './util';

const folderFor = (t: TeamT) => `${workspaceRoot()}/teams/${t.id}/genie_code`;
const skillName = () => ((pack() as { assistant?: { skill_dirs?: string[] } }).assistant?.skill_dirs?.[0] ?? '').split('/').filter(Boolean).pop() ?? '';
const host = () => (wsFull().config.host ?? '').replace(/\/$/, '');

async function objectId(path: string): Promise<number | null> {
  try {
    return Number((await wsFull().workspace.getStatus({ path })).object_id) || null;
  } catch {
    return null;
  }
}

async function exportText(path: string): Promise<string> {
  const r = await wsFull().workspace.export({ path, format: 'SOURCE' });
  return Buffer.from(r.content ?? '', 'base64').toString('utf8');
}

async function importText(path: string, text: string): Promise<void> {
  await wsFull().workspace.import({ path, format: 'RAW', overwrite: true, content: Buffer.from(text, 'utf8').toString('base64') });
}

function readme(team: TeamT): string {
  const p = pack() as { prompts?: Array<{ id: string; title: string; text: string }>; engagement: { title: string } };
  const skill = skillName();
  return [
    `# Genie Code workspace: ${team.name}`,
    '',
    `${p.engagement.title}. These are COPIES of your team files, made by Migration Studio. Edit them here with Genie Code`,
    '(open the Genie Code pane, or the full-page Genie Code view). When you are happy, go back to Migration Studio →',
    'Task 2 → Genie Code → "Bring back": it diffs each file against your team file and saves it with provenance "Genie Code".',
    'Nothing here is executed until you bring it back and press "Run my files".',
    '',
    skill ? `The framework skill is installed for this workspace. Mention it to be sure Genie Code follows it: @${skill}` : '',
    '',
    '## Suggested prompts',
    `- "@${skill} Review 10_stg…stageview.sql against the legacy source view in own_code/ (or the Task 1 code) and fix the type and status code rules."`,
    `- "@${skill} Check the schedule in the 40_workflow YAML: the curation must run after the ingest has finished."`,
    '- "Explain what this file does, line by line, and list anything that differs from the legacy procedure."',
    ...(p.prompts ?? []).slice(0, 10).map((x) => `- ${x.title}: "${x.text}"`),
    '',
  ].join('\n');
}

export function registerGenieCode(app: Express): void {
  app.get(
    '/api/genie-code',
    route(async (req) => {
      const c = await requireTeam(req);
      const folder = folderFor(c.team);
      const skill = skillName();
      const skillPath = skill ? `/Workspace/.assistant/skills/${skill}/SKILL.md` : null;
      const files: Array<{ path: string; name: string; url: string; modified: number | null }> = [];
      const folderId = await objectId(folder);
      if (folderId) {
        const stack = [folder];
        while (stack.length && files.length < 300) {
          const d = stack.pop() as string;
          for await (const o of wsFull().workspace.list({ path: d })) {
            const path = o.path ?? '';
            if (String(o.object_type) === 'DIRECTORY') stack.push(path);
            else if (!path.endsWith('README_GENIE_CODE.md'))
              files.push({ path, name: path.slice(folder.length + 1), url: `${host()}/editor/files/${String(o.object_id)}`, modified: o.modified_at ? Number(o.modified_at) : null });
          }
        }
      }
      return {
        workspace_url: host(),
        folder,
        folder_url: folderId ? `${host()}/browse/folders/${folderId}` : null,
        readme_url: (await objectId(`${folder}/README_GENIE_CODE.md`)) ? `${host()}/editor/files/${await objectId(`${folder}/README_GENIE_CODE.md`)}` : null,
        skill: { name: skill, path: skillPath, installed: skillPath ? Boolean(await objectId(skillPath)) : false },
        files: files.sort((a, b) => a.name.localeCompare(b.name)),
      };
    }),
  );

  /** Copy the chosen team files (and uploads) into the team's Genie Code folder. */
  app.post(
    '/api/genie-code/prepare',
    route(async (req) => {
      const c = await requireTeam(req);
      const body = z.object({ team_files: z.array(z.string()).max(30).default([]), uploads: z.array(z.string()).max(50).default([]) }).parse(req.body);
      const manifest = pack().manifest as ManifestItem[];
      const folder = folderFor(c.team);
      const w = wsFull().workspace;
      await w.mkdirs({ path: folder });
      const copied: string[] = [];
      for (const f of body.team_files) {
        if (!manifest.some((m) => m.file === f)) throw new HttpError(400, `Not a team file: ${f}`);
        const text = await tryReadText(`${teamWorkDir(c.team)}/${f}`);
        if (text === null) continue;
        await importText(`${folder}/${f}`, text);
        copied.push(f);
      }
      if (body.uploads.length) await w.mkdirs({ path: `${folder}/own_code` });
      for (const u of body.uploads) {
        await importText(`${folder}/own_code/${u}`, await uploadedText(c.team, u));
        copied.push(`own_code/${u}`);
      }
      await importText(`${folder}/README_GENIE_CODE.md`, readme(c.team));
      await logEvent(c.team.id, c.email, 'genie_code_prepared', 'task2', { files: copied });
      const id = await objectId(folder);
      return { ok: true, copied, folder, folder_url: id ? `${host()}/browse/folders/${id}` : null };
    }),
  );

  app.get(
    '/api/genie-code/file',
    route(async (req) => {
      const c = await requireTeam(req);
      const path = z.string().max(600).parse(req.query.path);
      if (!path.startsWith(`${folderFor(c.team)}/`) || path.includes('..')) throw new HttpError(400, "Only files in your team's Genie Code folder.");
      return { path, content: await exportText(path) };
    }),
  );

  /** Bring a Genie Code file back: into a team file (validated) or into drafts. Provenance: genie_code. */
  app.post(
    '/api/genie-code/bring-back',
    route(async (req) => {
      const c = await requireTeam(req);
      const body = z.object({ path: z.string().max(600), target_file: z.string().max(200).nullable().default(null) }).parse(req.body);
      const folder = folderFor(c.team);
      if (!body.path.startsWith(`${folder}/`) || body.path.includes('..')) throw new HttpError(400, "Only files in your team's Genie Code folder.");
      const text = await exportText(body.path);
      const meta = { source: 'genie_code', saved_by: c.email, ts: new Date().toISOString(), sha256: sha256(text), from: body.path };
      if (body.target_file) {
        const item = (pack().manifest as ManifestItem[]).find((m) => m.file === body.target_file);
        if (!item) throw new HttpError(400, 'Not a team file.');
        const errors = validateTeamFile(item, text);
        if (errors.length) throw new HttpError(422, errors.join(' '));
        const dest = `${teamWorkDir(c.team)}/${item.file}`;
        await writeText(dest, text);
        await writeText(`${dest}.meta.json`, JSON.stringify(meta, null, 2));
        await logEvent(c.team.id, c.email, 'file_saved', 'task2', { file: item.file, source: 'genie_code', sha256: meta.sha256 });
        return { ok: true, saved_as: item.file, meta };
      }
      const name = `genie_code_${(body.path.split('/').pop() ?? 'file').replace(/[^A-Za-z0-9._-]/g, '_')}`;
      if (!SAFE_NAME.test(name)) throw new HttpError(400, 'Bad file name.');
      const dest = `${teamWorkDir(c.team)}/drafts/${name}`;
      await writeText(dest, text);
      await writeText(`${dest}.meta.json`, JSON.stringify(meta, null, 2));
      await logEvent(c.team.id, c.email, 'draft_saved', 'task2', { name, source: 'genie_code' });
      return { ok: true, saved_as: `drafts/${name}`, meta };
    }),
  );
}

