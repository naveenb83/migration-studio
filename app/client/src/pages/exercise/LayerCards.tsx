/** Three comparison layers, each with live pass counts for the selected labelled run (checks mapped by layer). */
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@databricks/appkit-ui/react';
import { EmptyState, ErrorState, Loading, StatusChip } from '@/components/common';
import { useApi, useInterval } from '@/lib/poll';
import type { CheckRow, PublicPack, RunRow } from '@/lib/types';

export function LayerCards({ layers }: { layers: PublicPack['recon']['layers'] }) {
  const runs = useApi<RunRow[]>('/api/runs');
  const [pick, setPick] = useState<string | null>(null);
  const label = pick ?? runs.data?.[0]?.run_label ?? null;
  const checks = useApi<{ run_label: string; run_id: string; checks: CheckRow[] }>(label ? `/api/runs/${encodeURIComponent(label)}/checks` : null, [label]);
  useInterval(() => {
    if (document.visibilityState === 'visible' && label) void checks.reload();
  }, 15000);

  if (runs.loading && !runs.data) return <Loading label="Loading runs" rows={2} />;
  if (runs.error) return <ErrorState error={runs.error} retry={() => void runs.reload()} />;
  if (!runs.data || runs.data.length === 0) return <EmptyState title="No labelled runs yet">Counts appear here once your team has a run.</EmptyState>;

  const keys = Object.keys(layers).sort();
  const run = runs.data.find((r) => r.run_label === label);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Run</span>
        <Select value={label ?? undefined} onValueChange={setPick}>
          <SelectTrigger className="h-8 w-96" aria-label="Labelled run">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {runs.data.map((r) => (
              <SelectItem key={r.run_label} value={r.run_label}>
                {r.run_label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {run && <span className="text-xs text-muted-foreground">run id {run.run_id}</span>}
      </div>
      {checks.error && <ErrorState error={checks.error} retry={() => void checks.reload()} />}
      <div className="grid gap-3 md:grid-cols-3">
        {keys.map((k) => {
          const layer = layers[k];
          const rows = (checks.data?.checks ?? []).filter((c) => c.layer === k);
          const pass = rows.filter((c) => c.status.toUpperCase() === 'PASS').length;
          const other = rows.filter((c) => c.status.toUpperCase() !== 'PASS');
          return (
            <Card key={k}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {k} · {layer.title}
                </CardTitle>
                <CardDescription>{layer.question}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="text-xs text-muted-foreground">Compares: {layer.compares}</div>
                <div className="text-xs text-muted-foreground">How: {layer.how}</div>
                {checks.loading && !checks.data ? (
                  <Loading rows={1} />
                ) : (
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-semibold tabular-nums">
                      {pass} / {rows.length}
                    </span>
                    <span className="text-xs text-muted-foreground">checks pass</span>
                  </div>
                )}
                {other.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {[...new Set(other.map((c) => c.status.toUpperCase()))].map((s) => (
                      <span key={s} className="inline-flex items-center gap-1 text-xs">
                        <StatusChip status={s} /> {other.filter((c) => c.status.toUpperCase() === s).length}
                      </span>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
