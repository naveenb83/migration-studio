import { useState } from 'react';
import { Badge, Switch } from '@databricks/appkit-ui/react';
import { api } from '@/lib/api';
import { notify, EmptyState, ErrorState, Loading, Section } from '@/components/common';
import { RecheckNow } from './RecheckNow';
import type { ClassroomStatus } from './model';

interface Props {
  status: ClassroomStatus | null;
  error: string | null;
  reload: () => void;
  onRechecked: (runLabel: string) => void;
}

/** Classroom mode: unlocks once every redesign check is classified as agreed redesign. */
export function Classroom({ status, error, reload, onRechecked }: Props) {
  const [busy, setBusy] = useState(false);

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      await api.post<ClassroomStatus>('/api/classroom', { on });
      notify.ok(on ? 'Classroom mode is on for the next recheck.' : 'Classroom mode is off.');
      reload();
    } catch (e) {
      notify.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Classroom mode"
      description="Accepted redesigns are applied by the next recheck, and results are labelled SIMULATED. Raw results stay visible. No YAML is patched."
    >
      {error ? (
        <ErrorState error={error} retry={reload} />
      ) : !status ? (
        <Loading rows={2} />
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">{status.on ? 'On' : 'Off'}</div>
              <div className="text-xs text-muted-foreground">
                {status.unlocked
                  ? 'Unlocked: every redesign check is classified as agreed redesign.'
                  : 'Locked until every redesign check is classified as agreed redesign.'}
              </div>
            </div>
            <Switch
              checked={status.on}
              disabled={busy || (!status.unlocked && !status.on)}
              onCheckedChange={(v) => void toggle(Boolean(v))}
              aria-label="Classroom mode"
            />
          </div>
          {status.needed.length === 0 ? (
            <EmptyState title="This pack lists no redesign checks." />
          ) : (
            <ul className="space-y-1">
              {status.needed.map((name) => {
                const missing = status.missing.includes(name);
                return (
                  <li key={name} className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">{name}</span>
                    <Badge variant="outline" className={missing ? 'text-amber-700' : 'text-emerald-700'}>
                      {missing ? 'not yet redesign' : 'agreed redesign'}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
          <RecheckNow onFinished={onRechecked} />
        </div>
      )}
    </Section>
  );
}
