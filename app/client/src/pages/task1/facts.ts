/** Turns saved entries into the facts the pack's done-when rules read (see lib/doneWhen.ts). */
import type { Facts } from '@/lib/doneWhen';
import type { EntryRow } from '@/lib/types';

export type Payload = Record<string, string | number | boolean | null>;

export function computeFacts(lineage: EntryRow<Payload>[], rules: EntryRow<Payload>[], questions: EntryRow<Payload>[], contractKeys: string[]): Facts {
  const verified = lineage.filter((r) => r.payload.verified === true).length;
  const agreed = contractKeys.filter((k) => rules.some((r) => r.entry_key === k && r.payload.status === 'agreed')).length;
  const open = questions.filter((r) => r.payload.status === 'open').length;
  return {
    lineage_rows: { verified, total: lineage.length },
    rule_decisions: { agreed, total: contractKeys.length },
    questions_open: open,
  };
}

/** Pack seed values can be non-scalar; the register stores scalars only. */
export function toPayload(r: Record<string, unknown>): Payload {
  const out: Payload = {};
  for (const [k, v] of Object.entries(r)) {
    if (v === undefined) out[k] = null;
    else if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else out[k] = JSON.stringify(v);
  }
  return out;
}
