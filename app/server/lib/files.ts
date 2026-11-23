import { ws } from './config';
/** UC volume file helpers (Files API as the app service principal). Callers pass server-built paths only. */
import { createHash } from 'node:crypto';

export const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

const fsUrl = (path: string) => {
  const host = (ws().config.host ?? '').replace(/\/$/, '');
  return `${host}/api/2.0/fs/files${path.split('/').map(encodeURIComponent).join('/')}`;
};

async function authHeaders(extra: Record<string, string> = {}): Promise<Headers> {
  const h = new Headers(extra);
  await ws().config.authenticate(h);
  return h;
}

export async function readText(path: string): Promise<string> {
  const r = await fetch(fsUrl(path), { headers: await authHeaders() });
  if (r.status === 404) throw Object.assign(new Error(`not found: ${path}`), { status: 404 });
  if (!r.ok) throw new Error(`Files API ${r.status} reading ${path}: ${(await r.text()).slice(0, 200)}`);
  return await r.text();
}

export async function tryReadText(path: string): Promise<string | null> {
  try {
    return await readText(path);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/not.?found|404|does not exist/i.test(msg)) return null;
    throw e;
  }
}

export async function writeText(path: string, content: string): Promise<void> {
  const r = await fetch(`${fsUrl(path)}?overwrite=true`, {
    method: 'PUT',
    headers: await authHeaders({ 'Content-Type': 'application/octet-stream' }),
    body: Buffer.from(content, 'utf8'),
  });
  if (!r.ok) throw new Error(`Files API ${r.status} writing ${path}: ${(await r.text()).slice(0, 200)}`);
}

export async function remove(path: string): Promise<void> {
  await ws().files.delete({ file_path: path });
}

export interface Entry {
  name: string;
  path: string;
  is_directory: boolean;
  size: number;
  modified: number | null;
}

export async function list(dir: string): Promise<Entry[]> {
  const out: Entry[] = [];
  try {
    for await (const e of ws().files.listDirectoryContents({ directory_path: dir })) {
      out.push({
        name: e.name ?? '',
        path: e.path ?? '',
        is_directory: Boolean(e.is_directory),
        size: Number(e.file_size ?? 0),
        modified: e.last_modified ? Number(e.last_modified) : null,
      });
    }
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/not.?found|404|does not exist/i.test(msg)) return [];
    throw e;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Recursive list (bounded). */
export async function walk(dir: string, maxFiles = 500): Promise<Entry[]> {
  const out: Entry[] = [];
  const stack = [dir];
  while (stack.length && out.length < maxFiles) {
    const d = stack.pop() as string;
    for (const e of await list(d)) {
      if (e.is_directory) stack.push(e.path);
      else out.push(e);
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
