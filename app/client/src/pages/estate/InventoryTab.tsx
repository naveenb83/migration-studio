/** Inventory: every scanned artifact, with its landing destination and rationale (joined from estate_landing by artifact). */
import { useMemo } from 'react';
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@databricks/appkit-ui/react';
import { EmptyState, ErrorState, Loading } from '@/components/common';
import { useApi } from '@/lib/poll';
import { LANDING_LABEL, landingTone, num, type InventoryRow, type LandingRow } from './shared';

export function InventoryTab() {
  const inv = useApi<InventoryRow[]>('/api/estate/estate_inventory');
  const land = useApi<LandingRow[]>('/api/estate/estate_landing');
  const byArtifact = useMemo(() => {
    const m = new Map<string, LandingRow[]>();
    for (const r of land.data ?? []) if (r.artifact_id) m.set(r.artifact_id, [...(m.get(r.artifact_id) ?? []), r]);
    return m;
  }, [land.data]);

  if ((inv.loading && !inv.data) || (land.loading && !land.data)) return <Loading label="Loading inventory" rows={5} />;
  if (inv.error) return <ErrorState error={inv.error} retry={() => void inv.reload()} />;
  if (land.error) return <ErrorState error={land.error} retry={() => void land.reload()} />;
  if (!inv.data || inv.data.length === 0) return <EmptyState title="Nothing scanned yet">Run the estate scan to fill the inventory.</EmptyState>;

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>File</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead>Parse</TableHead>
            <TableHead className="text-right">Steps</TableHead>
            <TableHead className="text-right">Data flows</TableHead>
            <TableHead className="text-right">SQL</TableHead>
            <TableHead>Schedule</TableHead>
            <TableHead>Lands in</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {inv.data.map((r) => {
            const landings = byArtifact.get(r.artifact_id) ?? [];
            const dests = [...new Set(landings.map((l) => l.landing))];
            const reasons = [...new Set(landings.map((l) => l.reason).filter(Boolean))];
            return (
              <TableRow key={r.artifact_id}>
                <TableCell className="max-w-xs align-top">
                  <div className="break-all text-sm" title={r.artifact_id}>
                    {r.rel_path}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{r.side === 'legacy' ? 'Legacy' : 'Target'}</div>
                </TableCell>
                <TableCell className="align-top text-sm">{r.kind.replace(/_/g, ' ')}</TableCell>
                <TableCell className="align-top text-sm">{r.parse_status}</TableCell>
                <TableCell className="text-right align-top tabular-nums">{num(r.n_executables)}</TableCell>
                <TableCell className="text-right align-top tabular-nums">{num(r.n_data_flows)}</TableCell>
                <TableCell className="text-right align-top tabular-nums">{num(r.n_sql)}</TableCell>
                <TableCell className="align-top text-xs">{r.schedule_text ?? '—'}</TableCell>
                <TableCell className="max-w-xs align-top">
                  {dests.length === 0 ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {dests.map((d) => (
                        <span key={d} className={`w-fit rounded border px-1.5 py-0.5 text-xs ${landingTone(d)}`}>
                          {LANDING_LABEL[d] ?? d}
                        </span>
                      ))}
                      {reasons.length > 0 && <span className="text-[11px] text-muted-foreground">{reasons.join('; ')}</span>}
                    </div>
                  )}
                  {r.error && (
                    <Badge variant="destructive" className="mt-1">
                      parse error
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="mt-2 text-xs text-muted-foreground">Landing is the scanner&apos;s suggestion from the rules in the estate design. Check each one against the code before you rely on it.</p>
    </div>
  );
}
