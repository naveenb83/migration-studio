import { getExecutionContext } from '@databricks/appkit';
/**
 * Runtime configuration. Everything customer-specific comes from the environment (app resources) and the pack.
 * The catalog and studio schema are derived from the pack volume path (/Volumes/<catalog>/<schema>/<volume>), so
 * app.yaml and the repo never name them.
 */
const env = (k: string) => (process.env[k] ?? '').trim();

function parseVolume(path: string): { catalog: string; schema: string; volume: string } {
  const m = /^\/Volumes\/([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)\/?$/.exec(path);
  if (!m) throw new Error(`DATABRICKS_VOLUME_PACK must look like /Volumes/<catalog>/<schema>/<volume>, got '${path}'`);
  return { catalog: m[1], schema: m[2], volume: m[3] };
}

/** Accept a volume as catalog.schema.volume (app resource value) or /Volumes/catalog/schema/volume. */
function toVolumePath(v: string): string {
  const t = v.replace(/\/$/, '');
  if (!t || t.startsWith('/Volumes/')) return t;
  const parts = t.split('.');
  return parts.length === 3 ? `/Volumes/${parts.join('/')}` : t;
}

export const cfg = {
  warehouseId: env('DATABRICKS_WAREHOUSE_ID'),
  packVolume: toVolumePath(env('DATABRICKS_VOLUME_PACK')),
  exportsVolume: toVolumePath(env('DATABRICKS_VOLUME_EXPORTS')),
  packFile: env('STUDIO_PACK_FILE') || 'pack.json',
  jobRecheck: Number(env('DATABRICKS_JOB_RECHECK') || env('DATABRICKS_JOB_ID') || 0),
  jobProve: Number(env('DATABRICKS_JOB_PROVE') || 0),
  jobScan: Number(env('DATABRICKS_JOB_SCAN') || 0),
  jobConvert: Number(env('DATABRICKS_JOB_CONVERT') || 0),
  servingEndpoint: env('DATABRICKS_SERVING_ENDPOINT_NAME'),
  genieSpaces: {
    results: env('DATABRICKS_GENIE_SPACE_ID'),
    estate: env('DATABRICKS_GENIE_SPACE_ESTATE'),
    data: env('DATABRICKS_GENIE_SPACE_DATA'),
  },
  devUser: env('DEV_USER_EMAIL'),
  isDev: process.env.NODE_ENV === 'development',
  buildVersion: env('STUDIO_BUILD') || new Date().toISOString().slice(0, 16),
};

export function studio(): { catalog: string; schema: string } {
  const v = parseVolume(cfg.packVolume);
  return { catalog: v.catalog, schema: v.schema };
}

/** Fully qualified studio object name, e.g. fq('entries'). Names are code constants, never client input. */
export function fq(object: string): string {
  if (!/^[a-z_]+$/.test(object)) throw new Error(`bad studio object name ${object}`);
  const s = studio();
  return `${s.catalog}.${s.schema}.${object}`;
}

export function assertConfigured(): void {
  const missing = [
    ['DATABRICKS_WAREHOUSE_ID', cfg.warehouseId],
    ['DATABRICKS_VOLUME_PACK', cfg.packVolume],
    ['DATABRICKS_JOB_RECHECK or DATABRICKS_JOB_ID', cfg.jobRecheck ? 'ok' : ''],
  ].filter(([, v]) => !v);
  if (missing.length) throw new Error(`Missing configuration: ${missing.map(([k]) => k).join(', ')}`);
  parseVolume(cfg.packVolume);
}

/** Workspace client for the current context (the app service principal inside our routes). */
export const ws = () => getExecutionContext().client;

/** Full SDK client (for services the AppKit facade does not expose, e.g. the Workspace API). */
export const wsFull = () => ws().toLegacyWorkspaceClient();
