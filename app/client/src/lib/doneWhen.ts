/**
 * Evaluates pack `done_when[].rule` expressions against facts gathered from saved data.
 * Unknown rules return null: the UI renders them as manual checkboxes rather than failing.
 */
export interface Facts {
  lineage_rows?: { verified: number; total: number };
  rule_decisions?: { agreed: number; total: number };
  questions_open?: number;
  teamwork?: { saved: number };
  runs?: { recheck: number; fault_failed: number; repair_passed: number };
  classifications?: { covers_non_pass: boolean | null };
  rules?: { added: number };
  converted?: { imported: number };
  convert?: { runs: number; compared_all: boolean | null };
  cprove?: { clean_passed: number; fault_rejected: number; edge: number };
}

export function evaluate(rule: string | undefined, f: Facts): boolean | null {
  if (!rule) return null;
  const r = rule.replace(/\s+/g, '');
  let m: RegExpMatchArray | null;
  if ((m = r.match(/^lineage_rows\.verified>=(\d+)$/))) return f.lineage_rows ? f.lineage_rows.verified >= Number(m[1]) : null;
  if (r === 'rule_decisions.agreed==all') return f.rule_decisions ? f.rule_decisions.total > 0 && f.rule_decisions.agreed >= f.rule_decisions.total : null;
  if ((m = r.match(/^questions_open>=(\d+)$/))) return f.questions_open === undefined ? null : f.questions_open >= Number(m[1]);
  if ((m = r.match(/^teamwork\.saved>=(\d+)$/))) return f.teamwork ? f.teamwork.saved >= Number(m[1]) : null;
  if ((m = r.match(/^runs\.(recheck|fault_failed|repair_passed)>=(\d+)$/))) return f.runs ? f.runs[m[1] as 'recheck'] >= Number(m[2]) : null;
  if (r === 'classifications.covers_non_pass') return f.classifications ? f.classifications.covers_non_pass : null;
  if ((m = r.match(/^rules\.added>=(\d+)$/))) return f.rules ? f.rules.added >= Number(m[1]) : null;
  if ((m = r.match(/^converted\.imported>=(\d+)$/))) return f.converted ? f.converted.imported >= Number(m[1]) : null;
  if ((m = r.match(/^runs\.convert>=(\d+)$/))) return f.convert ? f.convert.runs >= Number(m[1]) : null;
  if (r === 'convert.compared==all') return f.convert ? f.convert.compared_all : null;
  if ((m = r.match(/^runs\.cprove_(clean_passed|fault_rejected|edge)>=(\d+)$/))) return f.cprove ? f.cprove[m[1] as 'edge'] >= Number(m[2]) : null;
  return null;
}
