/**
 * SQL Statement Execution as the app service principal. Values are always bound as named parameters; identifiers
 * come only from server-side expansion (config + pack), never from the client.
 */
import { cfg, ws } from './config';

export type SqlValue = string | number | boolean | null | undefined;
export type Row = Record<string, unknown>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function paramType(v: SqlValue): string {
  if (typeof v === 'number') return Number.isInteger(v) ? 'BIGINT' : 'DOUBLE';
  if (typeof v === 'boolean') return 'BOOLEAN';
  return 'STRING';
}

export async function query<T extends Row = Row>(statement: string, params: Record<string, SqlValue> = {}): Promise<T[]> {
  const client = ws();
  const parameters = Object.entries(params).map(([name, v]) =>
    v === null || v === undefined ? { name, type: paramType(v) } : { name, value: String(v), type: paramType(v) },
  );
  let r = await client.statementExecution.executeStatement({
    warehouse_id: cfg.warehouseId,
    statement,
    parameters,
    wait_timeout: '30s',
    on_wait_timeout: 'CONTINUE',
    disposition: 'INLINE',
    format: 'JSON_ARRAY',
  });
  const started = Date.now();
  while ((r.status?.state === 'PENDING' || r.status?.state === 'RUNNING') && r.statement_id) {
    if (Date.now() - started > 90_000) throw new Error('SQL statement timed out after 90 s');
    await sleep(800);
    r = await client.statementExecution.getStatement({ statement_id: r.statement_id });
  }
  if (r.status?.state !== 'SUCCEEDED') {
    throw new Error(`SQL failed: ${r.status?.error?.message ?? r.status?.state ?? 'unknown'}`.slice(0, 900));
  }
  const cols = (r.manifest?.schema?.columns ?? []).map((c) => ({ name: c.name ?? '', type: (c.type_name ?? '').toUpperCase() }));
  const rows = (r.result?.data_array ?? []) as Array<Array<string | null>>;
  return rows.map((row) => {
    const o: Row = {};
    cols.forEach((c, i) => {
      const v = row[i];
      if (v === null || v === undefined) o[c.name] = null;
      else if (['INT', 'LONG', 'SHORT', 'BYTE', 'DOUBLE', 'FLOAT', 'DECIMAL'].includes(c.type)) o[c.name] = Number(v);
      else if (c.type === 'BOOLEAN') o[c.name] = v === 'true';
      else o[c.name] = v;
    });
    return o as T;
  });
}

/** Run a statement that returns nothing useful (INSERT, DDL). */
export async function exec(statement: string, params: Record<string, SqlValue> = {}): Promise<void> {
  await query(statement, params);
}
