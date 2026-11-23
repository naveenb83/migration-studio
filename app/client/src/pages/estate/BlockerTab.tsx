/** Retirement blocker map: a legacy job cannot be retired while any dataset it loads is not migrated. */
import { Badge, Card, CardContent, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@databricks/appkit-ui/react';
import { EmptyState, ErrorState, Kpi, Loading } from '@/components/common';
import { useApi } from '@/lib/poll';
import { isTrue, num } from './shared';

export interface BlockerRow {
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

export function BlockerTab() {
  const rows = useApi<BlockerRow[]>('/api/estate/estate_blocker_map');
  if (rows.loading && !rows.data) return <Loading label="Loading blocker map" rows={3} />;
  if (rows.error) return <ErrorState error={rows.error} retry={() => void rows.reload()} />;
  if (!rows.data || rows.data.length === 0) return <EmptyState title="No jobs mapped yet">The blocker map fills in after the estate scan.</EmptyState>;

  const blocking = rows.data.filter((r) => isTrue(r.blocks_retirement)).length;
  const total = rows.data.reduce((a, r) => a + num(r.datasets_total), 0);
  const migrated = rows.data.reduce((a, r) => a + num(r.datasets_migrated), 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label="Jobs blocking retirement" value={blocking} tone={blocking > 0 ? 'WARN' : 'PASS'} />
        <Kpi label="Datasets migrated" value={`${migrated} of ${total}`} />
        <Kpi label="Jobs mapped" value={rows.data.length} />
      </div>
      {rows.data.map((r) => (
        <Card key={r.job_name}>
          <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="break-all text-sm">{r.job_name}</CardTitle>
            {isTrue(r.blocks_retirement) ? <Badge variant="destructive">Blocks retirement</Badge> : <Badge variant="secondary">Does not block</Badge>}
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="text-muted-foreground">{r.schedule_text ?? 'Schedule not recorded'}</div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dataset loaded</TableHead>
                    <TableHead>Migrated?</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(r.datasets_loaded ?? '')
                    .split(',')
                    .map((d) => d.trim())
                    .filter(Boolean)
                    .map((d) => {
                      const remaining = (r.remaining_datasets ?? '').split(',').map((x) => x.trim());
                      const open = remaining.includes(d);
                      return (
                        <TableRow key={d}>
                          <TableCell className="font-mono text-xs">{d}</TableCell>
                          <TableCell className="text-xs">{open ? 'Not yet' : 'Yes'}</TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            </div>
            <div>
              <span className="font-medium">Procedures it calls: </span>
              <span className="break-all">{r.procedures_called ?? 'none recorded'}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {r.status_text ?? ''}. The migrated flags are the team&apos;s dataset status from the pack, not a check against the data.
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
