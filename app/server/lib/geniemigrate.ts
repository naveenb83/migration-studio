/**
 * Genie Migrate (Convert) outputs.
 *
 * Verified in the build workspace (Nov 2026): Genie Migrate saves each converted file as a SQL *query* object in the
 * output folder, stored as `<source name without extension>.dbquery.ipynb`. An SSIS package is first split into
 * `.lakebridge/chunks/<package object id>/chunk_NN.sql`, and each converted part is saved next to it as
 * `chunk_NN.sql.converted.dbquery.ipynb`.
 *
 * The Workspace list API does not return query objects, so the app works out the expected names from the input
 * folder and reads each through Workspace export (Jupyter JSON; the converted code is in the cells).
 * The SQL Queries API's `query_text` is NOT used: for these objects it still holds the original source.
 */

export const QUERY_SUFFIX = '.dbquery.ipynb';
const CHUNK_RE = /^chunk_(\d+)\.sql$/i;

export interface InputItem {
  path: string;
  name: string;
  type: string;
  id?: string;
}

export interface OutputCandidate {
  path: string;
  name: string;
  type: 'QUERY';
  /** what the user sees */
  label: string;
  /** the input file it was converted from */
  from: string;
  /** SSIS part (1-based) and the number of parts Genie Migrate split the package into */
  part?: number;
  parts?: number;
}

/** Expected query paths for plain input files (one query per file). SSIS packages are handled with `chunkCandidates`. */
export function fileCandidates(outRoot: string, inputs: InputItem[]): OutputCandidate[] {
  return inputs
    .filter((f) => f.type !== 'DIRECTORY' && !/\.dtsx$/i.test(f.name))
    .map((f) => {
      const base = f.name.replace(/\.[^.]+$/, '');
      return { path: `${outRoot}/${base}${QUERY_SUFFIX}`, name: `${base}${QUERY_SUFFIX}`, type: 'QUERY', label: base, from: f.name };
    });
}

/** Expected query paths for the converted parts of one SSIS package, given the names in its chunk folder. */
export function chunkCandidates(chunkDir: string, pkgName: string, chunkFileNames: string[]): OutputCandidate[] {
  const chunks = chunkFileNames.filter((n) => CHUNK_RE.test(n)).sort();
  return chunks.map((n) => {
    const part = Number(CHUNK_RE.exec(n)?.[1] ?? 0) + 1;
    return {
      path: `${chunkDir}/${n}.converted${QUERY_SUFFIX}`,
      name: `${n}.converted${QUERY_SUFFIX}`,
      type: 'QUERY',
      label: `${pkgName} · part ${part} of ${chunks.length}`,
      from: pkgName,
      part,
      parts: chunks.length,
    };
  });
}

/** The code inside an exported query/notebook (Jupyter JSON): the cell sources, in order. */
export function notebookSource(raw: string): string {
  let nb: { cells?: Array<{ source?: string | string[] }> };
  try {
    nb = JSON.parse(raw) as typeof nb;
  } catch {
    return raw; // not JSON: already plain source
  }
  if (!Array.isArray(nb.cells)) return raw;
  const cells = nb.cells.map((c) => (Array.isArray(c.source) ? c.source.join('') : (c.source ?? '')));
  // cells are separate statements: end each code cell with ';' so two statements never run together
  return cells.map((c, i) => (i < cells.length - 1 && needsTerminator(c) ? `${c.replace(/\s+$/, '')}\n;` : c)).join('\n\n');
}

/** True when the cell has code that doesn't already end with ';' (comments ignored). */
export function needsTerminator(cell: string): boolean {
  const code = cell.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').trim();
  return code.length > 0 && !code.endsWith(';');
}

/** Quick, approximate summary of a SQL file for the review list (the job does the real, parsed check). */
export function sqlSummary(text: string): { statements: number; creates: string[]; writes: string[]; commentOnly: boolean; warnings: string[] } {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').replace(/'(?:[^']|'')*'/g, "''");
  const statements = code.split(';').map((x) => x.trim()).filter(Boolean);
  const creates = [...code.matchAll(/\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?(VIEW|TABLE|FUNCTION|PROCEDURE)\s+(?:IF\s+NOT\s+EXISTS\s+)?([`\w.]+)/gi)].map(
    (m) => `${m[1].toUpperCase()} ${m[2].replace(/`/g, '')}`,
  );
  const writes = [...code.matchAll(/\b(?:INSERT\s+(?:INTO|OVERWRITE)(?:\s+TABLE)?|MERGE\s+INTO|UPDATE(?!\s+SET\b)|DELETE\s+FROM|TRUNCATE\s+TABLE)\s+([`\w.]+)/gi)].map((m) => m[1].replace(/`/g, ''));
  const warnings = [...new Set([...code.matchAll(/\b(DROP|GRANT|REVOKE|COPY\s+INTO|ALTER)\b/gi)].map((m) => m[1].toUpperCase().replace(/\s+/g, ' ')))].map(
    (w) => `contains ${w}: the app checks every statement before it runs, and blocks what isn't allowed`,
  );
  return { statements: statements.length, creates, writes: [...new Set(writes)], commentOnly: statements.length === 0, warnings };
}

/** Draft file name for an imported Genie Migrate output path. */
export function draftNameFor(path: string): string {
  const leaf = path.split('/').pop() ?? 'converted';
  const chunk = /^chunk_(\d+)\.sql\.converted\.dbquery\.ipynb$/i.exec(leaf);
  let name = chunk ? `genie_migrate_ssis_part${Number(chunk[1]) + 1}.sql` : leaf.endsWith(QUERY_SUFFIX) ? leaf.slice(0, -QUERY_SUFFIX.length) : leaf;
  name = name.replace(/[^A-Za-z0-9._-]/g, '_');
  return /\.(sql|ya?ml|py)$/i.test(name) ? name : `${name}.sql`;
}
