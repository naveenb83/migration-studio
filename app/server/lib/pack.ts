/**
 * Engagement pack: loaded from the pack volume at start-up, validated (loosely: required shape only), cached.
 * Everything customer-specific lives here. Physical table templates are expanded ONLY on the server.
 */
import { z } from 'zod';
import { cfg, studio } from './config';
import { readText } from './files';

const Team = z.object({ id: z.string().regex(/^[a-z0-9_]+$/), name: z.string(), prefix: z.string().regex(/^[a-z][a-z0-9_]*_$/) });

export const PackSchema = z
  .object({
    pack_version: z.number(),
    engagement: z.object({ id: z.string(), title: z.string(), facilitators: z.array(z.string()) }).passthrough(),
    workspace: z.object({ studio_schema: z.string(), root: z.string() }).passthrough(),
    teams: z.array(Team).min(1),
    demo_team: Team,
    dataset: z.object({ id: z.string(), title: z.string(), tables: z.record(z.string(), z.string()) }).passthrough(),
    manifest: z.array(
      z.object({ artifact: z.string(), file: z.string(), required: z.boolean(), kind: z.string() }).passthrough(),
    ),
    recon: z.object({ check_layer_map: z.record(z.string(), z.string()), layers: z.record(z.string(), z.any()) }).passthrough(),
    faults: z.array(z.object({ id: z.string(), label: z.string(), target: z.string().optional(), view: z.string().optional() }).passthrough()),
    rule_templates: z.array(z.object({ id: z.string(), label: z.string(), sql: z.string() }).passthrough()).default([]),
    rule_context: z
      .object({ entity: z.string(), tables: z.record(z.string(), z.string()), derived: z.record(z.string(), z.string()) })
      .optional(),
    tasks: z.array(z.object({ id: z.string(), title: z.string() }).passthrough()),
    features: z.record(z.string(), z.boolean()),
  })
  .passthrough();

export type Pack = z.infer<typeof PackSchema>;
export type TeamT = z.infer<typeof Team>;

let current: Pack | null = null;
let loadedAt = '';

export async function loadPack(): Promise<Pack> {
  const path = `${cfg.packVolume}/${cfg.packFile}`;
  const raw = await readText(path);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Pack ${path} is not valid JSON: ${(e as Error).message}`);
  }
  const parsed = PackSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Pack ${path} failed validation: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  current = parsed.data;
  loadedAt = new Date().toISOString();
  return current;
}

export function pack(): Pack {
  if (!current) throw new Error('Pack not loaded');
  return current;
}

export const packLoadedAt = () => loadedAt;

export function allTeams(): TeamT[] {
  const p = pack();
  return [...p.teams, p.demo_team];
}

export function teamById(id: string): TeamT | undefined {
  return allTeams().find((t) => t.id === id);
}

const IDENT = /^[A-Za-z0-9_]+\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/;

/** Expand a template like "{cat}.{prefix}edh.fact_x" for one team. Server-only. */
export function expand(template: string, team: TeamT): string {
  const s = studio();
  const out = template.split('{cat}').join(s.catalog).split('{prefix}').join(team.prefix).split('{studio}').join(s.schema);
  if (!IDENT.test(out)) throw new Error(`expanded name is not a 3-part identifier: ${out}`);
  return out;
}

export function tableFor(logical: string, team: TeamT): string {
  const t = pack().dataset.tables[logical];
  if (!t) throw new Error(`unknown logical table ${logical}`);
  return expand(t, team);
}

export const teamWorkDir = (team: TeamT) => `/Volumes/${studio().catalog}/${team.prefix}workshop/team_work`;
export const legacyCodeDir = (team: TeamT) => `/Volumes/${studio().catalog}/${team.prefix}workshop/legacy_code`;
export const workspaceRoot = () => pack().workspace.root.replace(/\/$/, '');
export const genieFolder = (team: TeamT, which: 'genie_in' | 'genie_out') => `${workspaceRoot()}/teams/${team.id}/${which}`;

/** The public part of the pack: no physical table names, views, or table lists. */
export function publicPack(): Record<string, unknown> {
  const p = pack() as Record<string, unknown> & Pack;
  const { dataset, faults, genie_spaces, rule_context, workspace, conversion, ...rest } = p as Record<string, unknown> & {
    dataset: Pack['dataset'];
    faults: Pack['faults'];
    genie_spaces?: Record<string, Record<string, unknown>>;
    rule_context?: unknown;
    conversion?: unknown;
    workspace: Pack['workspace'];
  };
  void rule_context;
  void conversion; // table templates and SQL: served per team by /api/conversion, never in the public pack
  const { tables, ...datasetPublic } = dataset;
  const genie = Object.fromEntries(
    Object.entries(genie_spaces ?? {}).map(([k, v]) => {
      const { tables: _t, ...pub } = v;
      void _t;
      return [k, pub];
    }),
  );
  return {
    ...rest,
    workspace: { root: workspace.root },
    dataset: { ...datasetPublic, logical_tables: Object.keys(tables) },
    faults: faults.map(({ view: _v, ...f }) => {
      void _v;
      return f;
    }),
    genie_spaces: genie,
  };
}
