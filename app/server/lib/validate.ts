/** Save-time validation of team files (the recheck job executes them as SQL / framework config). */
import { parse as parseYaml } from 'yaml';

/** Split SQL into statements, ignoring ';' inside quotes and comments. Returns non-empty statements. */
export function splitSql(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  let i = 0;
  let q: string | null = null;
  while (i < sql.length) {
    const c = sql[i];
    const n = sql[i + 1];
    if (q) {
      cur += c;
      if (c === q) {
        if (n === q) {
          cur += n;
          i += 2;
          continue;
        }
        q = null;
      }
      i++;
      continue;
    }
    if (c === '-' && n === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      continue;
    }
    if (c === '/' && n === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      cur += ' ';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      q = c;
      cur += c;
      i++;
      continue;
    }
    if (c === ';') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export interface ManifestItem {
  artifact: string;
  file: string;
  required: boolean;
  kind: string;
  allowed_mechanisms?: string[];
}

export function validateTeamFile(item: ManifestItem, content: string): string[] {
  const errors: string[] = [];
  if (content.length > 400_000) return ['File is too large (max 400 KB).'];
  if (!content.trim()) return ['File is empty.'];
  if (item.kind === 'view_sql') {
    const stmts = splitSql(content);
    if (stmts.length !== 1) errors.push(`A view file must contain exactly one statement; found ${stmts.length}.`);
    else if (!/^CREATE\s+(OR\s+REPLACE\s+)?VIEW\s+/i.test(stmts[0])) {
      errors.push('A view file must be a single CREATE [OR REPLACE] VIEW statement.');
    }
  } else if (item.kind === 'framework_yaml' || item.kind === 'recon_yaml') {
    let doc: unknown;
    try {
      doc = parseYaml(content);
    } catch (e) {
      return [`YAML does not parse: ${(e as Error).message.split('\n')[0]}`];
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return ['YAML must be a mapping (key: value) at the top level.'];
    if (item.allowed_mechanisms?.length) {
      const tables = (doc as { tables?: unknown }).tables;
      if (!Array.isArray(tables) || !tables.length) errors.push('Expected a non-empty `tables:` list.');
      else
        tables.forEach((t, i) => {
          const m = (t as { mechanism?: unknown })?.mechanism;
          if (typeof m !== 'string' || !item.allowed_mechanisms?.includes(m)) {
            errors.push(`tables[${i}].mechanism '${String(m)}' is not allowed (use one of: ${item.allowed_mechanisms?.join(', ')}).`);
          }
        });
    }
  }
  return errors;
}
