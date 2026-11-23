/** Shared-package panel: rows of estate_blocker_map (what a job loads, and what blocks retiring it). */
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@databricks/appkit-ui/react';
import { EmptyState, ErrorState, Loading } from '@/components/common';
import { useApi } from '@/lib/poll';

interface BlockerRow {
  job_name: string;
  schedule_text: string | null;
  packages: string | null;
  datasets_loaded: string | null;
  datasets_total: number | string | null;
  datasets_migrated: number | string | null;
  datasets_remaining: number | string | null;
  remaining_datasets: string | null;
  procedures_called: string | null;
  blocks_retirement: boolean | string | null;
  status_text: string | null;
}

const isTrue = (v: BlockerRow['blocks_retirement']) => v === true || String(v).toLowerCase() === 'true';

export function SharedPackageTab() {
  const rows = useApi<BlockerRow[]>('/api/estate/estate_blocker_map');
  if (rows.loading && !rows.data) return <Loading label="Loading blockers" rows={2} />;
  if (rows.error) return <ErrorState error={rows.error} retry={() => void rows.reload()} />;
  if (!rows.data || rows.data.length === 0) return <EmptyState title="No blocker rows yet">The estate scan has not mapped any jobs.</EmptyState>;
  return (
    <div className="space-y-3">
      {rows.data.map((r) => (
        <Card key={r.job_name}>
          <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="break-all text-sm">{r.job_name}</CardTitle>
            {isTrue(r.blocks_retirement) ? <Badge variant="destructive">Blocks retirement</Badge> : <Badge variant="secondary">Does not block</Badge>}
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="text-muted-foreground">{r.schedule_text ?? 'Schedule not recorded'}</div>
            <div>
              <span className="font-medium">Loads: </span>
              {r.datasets_loaded ?? 'nothing recorded'}
            </div>
            <div>
              <span className="font-medium">Procedures it calls: </span>
              {r.procedures_called ?? 'none recorded'}
            </div>
            <div className="text-xs text-muted-foreground">
              {r.status_text ?? ''} (migrated status comes from the team&apos;s dataset status in the pack, not from checking the data)
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
