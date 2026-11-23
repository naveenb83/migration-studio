/** Task 4 rule helpers: template parameters and the request payload. No React here. */
import type { RuleTemplate } from '@/lib/types';

export type ParamValues = Record<string, Record<string, number>>;

/** The value the user chose, else the template default, else the first option, else 0. */
export function paramValue(tpl: RuleTemplate, name: string, values: ParamValues): number {
  const chosen = values[tpl.id]?.[name];
  if (chosen !== undefined) return chosen;
  const p = (tpl.params ?? []).find((x) => x.name === name);
  return p?.default ?? p?.options?.[0] ?? 0;
}

/** Only numbers for the selected templates, matching what the server validates. */
export function payloadFor(ids: string[], templates: RuleTemplate[], values: ParamValues): ParamValues {
  const out: ParamValues = {};
  for (const id of ids) {
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) continue;
    out[id] = Object.fromEntries((tpl.params ?? []).map((p) => [p.name, paramValue(tpl, p.name, values)]));
  }
  return out;
}

/** Read-only stand-in for the YAML before the first prove call: the selected templates' SQL, labelled. */
export function sqlPreview(ids: string[], templates: RuleTemplate[]): string {
  return ids
    .map((id) => templates.find((t) => t.id === id))
    .filter((t): t is RuleTemplate => t !== undefined)
    .map((t) => `-- rule_${t.id}: ${t.label}\n${t.sql}`)
    .join('\n\n');
}
