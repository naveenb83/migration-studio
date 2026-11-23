import { BarChart } from '@databricks/appkit-ui/react';
import type { CheckRow, RunRow } from '@/lib/types';
import { ErrorState, Kpi, Loading, STATUS_COLORS } from '@/components/common';
import { STATUSES, levelRows, runCount } from './model';

/** KPIs come from the run's own log (exact run_label). The level chart comes from that run's checks. */
export function Scorecard({ run, checks, error, retry }: { run: RunRow; checks: CheckRow[] | null; error: string | null; retry: () => void }) {
  const rows = checks ? levelRows(checks) : [];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {STATUSES.map((s) => (
          <Kpi key={s} label={s} value={runCount(run, s)} tone={s} />
        ))}
      </div>
      <div className="text-xs text-muted-foreground">Counts from the run log for {run.run_label}. Blocking: {Number(run.n_blocking)}.</div>
      {error && <ErrorState error={error} retry={retry} />}
      {!error && !checks && <Loading rows={2} />}
      {checks && (
        <BarChart
          data={rows}
          xKey="level"
          yKey={[...STATUSES]}
          stacked
          colors={STATUSES.map((s) => STATUS_COLORS[s])}
          height={240}
        />
      )}
    </div>
  );
}
