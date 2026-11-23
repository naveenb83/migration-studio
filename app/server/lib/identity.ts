/** Who is calling, and which team they belong to (the roster in studio.entries). */
import type { Request } from 'express';
import { cfg, fq } from './config';
import { pack, teamById, type TeamT } from './pack';
import { query } from './sql';

export interface Caller {
  email: string;
  team: TeamT | null;
  role: string | null;
  isFacilitator: boolean;
}

export function emailOf(req: Request): string {
  const h = req.header('x-forwarded-email') || req.header('x-forwarded-preferred-username') || '';
  const e = (h || (cfg.isDev ? cfg.devUser || 'dev.user@example.com' : '')).trim().toLowerCase();
  if (!e) throw Object.assign(new Error('No user identity on the request'), { status: 401 });
  return e;
}

const rosterCache = new Map<string, { at: number; team_id: string | null; role: string | null }>();
const ROSTER_TTL_MS = 15_000;

export function forgetRoster(email: string): void {
  rosterCache.delete(email);
}

export async function caller(req: Request): Promise<Caller> {
  const email = emailOf(req);
  const isFacilitator = pack().engagement.facilitators.map((f) => f.toLowerCase()).includes(email);
  let hit = rosterCache.get(email);
  if (!hit || Date.now() - hit.at > ROSTER_TTL_MS) {
    const rows = await query<{ team_id: string; payload: string; deleted: boolean }>(
      `SELECT team_id, payload, deleted FROM ${fq('entries')} WHERE kind = 'roster' AND entry_key = :email ORDER BY ts DESC, id DESC LIMIT 1`,
      { email },
    );
    const r = rows[0];
    let role: string | null = null;
    if (r && !r.deleted) {
      try {
        role = String((JSON.parse(r.payload) as { role?: string }).role ?? '') || null;
      } catch {
        role = null;
      }
    }
    hit = { at: Date.now(), team_id: r && !r.deleted ? r.team_id : null, role };
    rosterCache.set(email, hit);
  }
  const team = hit.team_id ? teamById(hit.team_id) ?? null : null;
  return { email, team, role: hit.role, isFacilitator };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requireTeam(req: Request): Promise<Caller & { team: TeamT }> {
  const c = await caller(req);
  if (!c.team) throw new HttpError(409, 'Pick your team on the Setup page first.');
  return c as Caller & { team: TeamT };
}

export async function requireFacilitator(req: Request): Promise<Caller> {
  const c = await caller(req);
  if (!c.isFacilitator) throw new HttpError(403, 'Facilitators only.');
  return c;
}
