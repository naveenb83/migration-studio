import { useState } from 'react';
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from '@databricks/appkit-ui/react';
import type { CheckRow } from '@/lib/types';
import { api } from '@/lib/api';
import { notify } from '@/components/common';
import { CLASS_OPTIONS } from './model';

/** Form state starts from the saved values at mount. Partner saves show in the "Saved now" line as the checks list refreshes. */
export function ClassifyForm({ runLabel, check, onSaved }: { runLabel: string; check: CheckRow; onSaved: () => void }) {
  const [cls, setCls] = useState(check.classification ?? '');
  const [owner, setOwner] = useState(check.class_owner ?? '');
  const [evidence, setEvidence] = useState(check.class_evidence ?? '');
  const [saving, setSaving] = useState(false);
  const ok = cls !== '' && owner.trim() !== '' && evidence.trim() !== '';

  const save = async () => {
    setSaving(true);
    try {
      await api.post('/api/entries', {
        kind: 'classification',
        entry_key: check.check_name,
        payload: { class: cls, owner: owner.trim(), evidence: evidence.trim(), run_label: runLabel },
      });
      notify.ok('Classification saved. Your partner sees it within about 5 seconds.');
      onSaved();
    } catch (e) {
      notify.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md bg-muted p-2 text-xs">
        <b>Saved now:</b>{' '}
        {check.classification
          ? `${check.classification} · owner ${check.class_owner ?? '—'} · saved by ${check.class_saved_by ?? '—'}`
          : 'nothing saved yet'}
      </div>
      <div className="space-y-1">
        <div className="text-xs font-medium">Group</div>
        <Select value={cls || undefined} onValueChange={setCls}>
          <SelectTrigger aria-label="Classification">
            <SelectValue placeholder="Choose a group" />
          </SelectTrigger>
          <SelectContent>
            {CLASS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <div className="text-xs font-medium">Owner</div>
        <Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="A named person or role" aria-label="Owner" />
      </div>
      <div className="space-y-1">
        <div className="text-xs font-medium">Evidence</div>
        <Textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="What you looked at, and why this group" aria-label="Evidence" />
      </div>
      <Button size="sm" disabled={!ok || saving} onClick={() => void save()}>
        Save classification
      </Button>
      {!ok && <div className="text-xs text-muted-foreground">Group, owner and evidence are all needed.</div>}
    </div>
  );
}
