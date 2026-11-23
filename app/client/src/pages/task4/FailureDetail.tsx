import { Badge } from '@databricks/appkit-ui/react';
import { useApi } from '@/lib/poll';
import { EmptyState, ErrorState, Loading, StatusChip } from '@/components/common';
import { SampleTable } from '@/pages/task3/SampleTable';
import { enc, type ChecksResponse } from '@/pages/task3/model';
import type { CheckRow } from '@/lib/types';

/** Failing rules of one exact run, each with the affected rows from that run's samples. */
export function FailureDetail({ runLabel }: { runLabel: string }) {
  const checks = useApi<ChecksResponse>(`/api/runs/${enc(runLabel)}/checks`);
  if (checks.error) return <ErrorState error={checks.error} retry={() => void checks.reload()} />;
  if (!checks.data) return <Loading rows={2} />;
  if (checks.data.run_label !== runLabel) return <Loading rows={2} />;
  const fails = checks.data.checks.filter((c) => c.status === 'FAIL' || c.status === 'ERROR');
  if (fails.length === 0) return <EmptyState title="No failing rule in this run." />;
  return (
    <div className="space-y-3">
      {fails.map((c) => (
        <FailedRule key={c.check_name} runLabel={runLabel} check={c} />
      ))}
    </div>
  );
}

function FailedRule({ runLabel, check }: { runLabel: string; check: CheckRow }) {
  const samples = useApi<unknown[]>(`/api/runs/${enc(runLabel)}/samples/${enc(check.check_name)}`);
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={check.status} />
        <span className="font-mono text-xs">{check.check_name}</span>
        <Badge variant="outline">{check.level}</Badge>
      </div>
      <div className="text-sm">{check.description}</div>
      <div className="text-xs text-muted-foreground">{check.detail}</div>
      <div className="text-xs font-medium">Affected rows in this run</div>
      {samples.error ? (
        <ErrorState error={samples.error} retry={() => void samples.reload()} />
      ) : !samples.data ? (
        <Loading rows={1} />
      ) : (
        <SampleTable rows={samples.data.slice(0, 10)} />
      )}
    </div>
  );
}

/** Whether each selected rule's check appears in one exact run. */
export function RulePresence({ runLabel, templates }: { runLabel: string; templates: Array<{ id: string; label: string }> }) {
  const checks = useApi<ChecksResponse>(`/api/runs/${enc(runLabel)}/checks`);
  if (checks.error) return <ErrorState error={checks.error} retry={() => void checks.reload()} />;
  if (!checks.data || checks.data.run_label !== runLabel) return <Loading rows={1} />;
  const names = new Set(checks.data.checks.map((c) => c.check_name));
  return (
    <ul className="space-y-1 text-sm">
      {templates.map((t) => {
        const present = names.has(`rule_${t.id}`);
        return (
          <li key={t.id} className="flex items-center justify-between gap-2">
            <span>
              {t.label} <span className="font-mono text-xs text-muted-foreground">rule_{t.id}</span>
            </span>
            <Badge variant="outline" className={present ? 'text-emerald-700' : 'text-red-700'}>
              {present ? 'present in this run' : 'missing from this run'}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}
