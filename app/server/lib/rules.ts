/**
 * Task 4: write the team's rules config (team_rules.recon.yml) from VETTED pack templates.
 * Same layout as scripts/gen_team_rules.py. The client sends template ids + numeric parameters only.
 */
import { pack } from './pack';
import { HttpError } from './identity';

const block = (text: string, indent: number) =>
  '|\n' +
  text
    .replace(/^\n+|\n+$/g, '')
    .split('\n')
    .map((l) => ' '.repeat(indent) + l.replace(/\s+$/, ''))
    .join('\n');

interface Template {
  id: string;
  label: string;
  sql: string;
  sample_sql?: string;
  level?: string;
  severity?: string;
  expect?: string;
  description?: string;
  min_coverage?: number;
  params?: Array<{ name: string; label: string; default?: number; options?: number[] }>;
}

export function renderRules(teamId: string, templateIds: string[], params: Record<string, Record<string, number>>): string {
  const p = pack();
  const ctx = p.rule_context;
  if (!ctx) throw new HttpError(500, 'This pack has no rule_context: Task 4 is not configured.');
  const byId = new Map((p.rule_templates as Template[]).map((t) => [t.id, t]));
  if (!templateIds.length || templateIds.length > 6) throw new HttpError(400, 'Pick between 1 and 6 rule templates.');
  const lines = [`entity: ${ctx.entity}`, `owner: ${JSON.stringify(teamId)}`, 'description: "Team rules written by Migration Studio from vetted templates (Task 4)."'];
  for (const [k, v] of Object.entries(ctx.tables)) lines.push(`${k}: ${v}`);
  lines.push('derived:');
  for (const [k, v] of Object.entries(ctx.derived)) lines.push(`  ${k}: ${block(v, 4)}`);
  lines.push('checks:');
  for (const id of templateIds) {
    const t = byId.get(id);
    if (!t) throw new HttpError(400, `Unknown rule template '${id}'.`);
    const values: Record<string, number> = {};
    for (const prm of t.params ?? []) {
      const raw = params[id]?.[prm.name] ?? prm.default;
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new HttpError(400, `Parameter ${prm.name} must be a number.`);
      if (prm.options?.length && !prm.options.some((o) => Math.abs(o - n) < 1e-12)) {
        throw new HttpError(400, `Parameter ${prm.name} must be one of ${prm.options.join(', ')}.`);
      }
      values[prm.name] = n;
    }
    const fill = (s: string) =>
      s.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => {
        if (!(name in values)) throw new HttpError(500, `Template ${id} uses an undeclared parameter ${name}.`);
        return String(values[name]);
      });
    lines.push(
      `  - name: rule_${id}`,
      `    level: ${t.level ?? 'L4'}`,
      `    severity: ${t.severity ?? 'FAIL'}`,
      `    expect: ${JSON.stringify(t.expect ?? '== 0')}`,
      `    description: ${JSON.stringify(t.description ?? t.label)}`,
    );
    if (t.min_coverage !== undefined && t.min_coverage !== null) lines.push(`    min_coverage: ${t.min_coverage}`);
    lines.push(`    sql: ${block(fill(t.sql), 6)}`);
    if (t.sample_sql) lines.push(`    sample_sql: ${block(fill(t.sample_sql), 6)}`);
  }
  return lines.join('\n') + '\n';
}
