/** Lineage worksheet: the generic register, columns from the pack's template plus a verified tick. */
import { useMemo } from 'react';
import { Register, type Column } from '@/components/register/Register';
import type { PublicPack } from '@/lib/types';
import { toPayload } from './facts';

function label(key: string): string {
  const s = key.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildColumns(names: string[]): Column[] {
  const cols: Column[] = names
    .filter((c) => c !== 'verified')
    .map((c): Column => {
      if (c === 'notes') return { key: c, label: label(c), type: 'longtext', width: '220px' };
      if (c === 'cited_file') return { key: c, label: 'Cited file', type: 'text', width: '200px', placeholder: 'file path from the code browser' };
      if (c === 'step') return { key: c, label: label(c), type: 'text', width: '64px' };
      return { key: c, label: label(c), type: 'text', width: '140px' };
    });
  if (!names.includes('cited_file')) cols.push({ key: 'cited_file', label: 'Cited file', type: 'text', width: '200px', placeholder: 'file path from the code browser' });
  cols.push({ key: 'verified', label: 'Verified against the code', type: 'check', width: '110px' });
  return cols;
}

export function LineageTab({ template, onChanged }: { template: PublicPack['lineage_template']; onChanged: () => void }) {
  const columns = useMemo(() => buildColumns(template.columns), [template.columns]);
  const seed = useMemo(
    () =>
      (template.seed_rows ?? []).map((r, i) => {
        const payload = toPayload(r);
        return { key: `seed-${i + 1}`, payload: { verified: false, ...payload } };
      }),
    [template.seed_rows],
  );
  return (
    <Register
      kind="lineage_row"
      columns={columns}
      seed={seed}
      allowAdd
      newKey={() => `row-${Date.now().toString(36)}`}
      onChanged={onChanged}
      emptyText="No lineage rows yet. Add one for each step you trace."
    />
  );
}
