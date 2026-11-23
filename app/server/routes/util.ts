import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { fq } from '../lib/config';
import { HttpError } from '../lib/identity';
import { exec } from '../lib/sql';

type Handler = (req: Request, res: Response) => Promise<unknown>;

/** Wrap an async route: JSON result, readable errors, never a hung request. */
export const route =
  (fn: Handler) =>
  (req: Request, res: Response, _next: NextFunction): void => {
    fn(req, res)
      .then((out) => {
        if (!res.headersSent && out !== undefined) res.json(out);
      })
      .catch((e: unknown) => {
        const status = e instanceof HttpError ? e.status : Number((e as { status?: number })?.status) || 500;
        const message = String((e as Error)?.message ?? e).slice(0, 1200);
        if (status >= 500) console.error(`[api] ${req.method} ${req.path}:`, message);
        if (!res.headersSent) res.status(status).json({ error: message });
        else res.end();
      });
  };

export async function logEvent(teamId: string | null, email: string, eventType: string, taskId: string | null, payload: unknown): Promise<void> {
  await exec(
    `INSERT INTO ${fq('events')} (id, ts, team_id, user_email, event_type, task_id, payload)
     VALUES (:id, current_timestamp(), :team, :email, :type, :task, :payload)`,
    { id: randomUUID(), team: teamId, email, type: eventType, task: taskId, payload: JSON.stringify(payload ?? {}).slice(0, 20000) },
  );
}

export async function insertEntry(teamId: string, email: string, kind: string, key: string, payload: unknown, deleted = false): Promise<string> {
  const id = randomUUID();
  await exec(
    `INSERT INTO ${fq('entries')} (id, ts, team_id, user_email, kind, entry_key, payload, deleted)
     VALUES (:id, current_timestamp(), :team, :email, :kind, :key, :payload, :deleted)`,
    { id, team: teamId, email, kind, key, payload: JSON.stringify(payload ?? {}), deleted },
  );
  return id;
}

export const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;
