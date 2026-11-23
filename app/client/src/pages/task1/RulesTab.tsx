/** Rules agreement: one locked row per rules_contract key; status, owner, sign-off and note are team-editable. */
import { useMemo } from 'react';
import { Register, type Column } from '@/components/register/Register';
import type { PublicPack } from '@/lib/types';

const COLUMNS: Column[] = [
  { key: 'label', label: 'Rule', type: 'text', readOnly: true, width: '170px' },
  { key: 'help', label: 'What to agree', type: 'longtext', readOnly: true, width: '260px' },
  { key: 'status', label: 'Status', type: 'select', options: ['proposed', 'agreed', 'open'], width: '130px' },
  { key: 'owner', label: 'Owner', type: 'text', width: '140px', placeholder: 'who decides' },
  { key: 'signoff', label: 'Business-owner sign-off', type: 'text', width: '170px', placeholder: 'name and date' },
  { key: 'note', label: 'Note', type: 'longtext', width: '220px' },
];

export function RulesTab({ contract, onChanged }: { contract: PublicPack['rules_contract']; onChanged: () => void }) {
  const seed = useMemo(
    () =>
      contract.map((r) => ({
        key: r.key,
        payload: { label: r.label, help: r.help ?? '', status: 'proposed', owner: '', signoff: '', note: '' },
      })),
    [contract],
  );
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        The sign-off is recorded by name for the team. It is not an approval workflow, and nothing here is a real business sign-off in the workshop.
      </p>
      <Register kind="rule_decision" columns={COLUMNS} seed={seed} allowAdd={false} allowDelete={false} onChanged={onChanged} />
    </div>
  );
}
