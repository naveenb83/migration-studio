import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@databricks/appkit-ui/react';
import type { RunRow } from '@/lib/types';
import { EmptyState, ErrorState, Loading, StatusChip } from '@/components/common';
import { useApi } from '@/lib/poll';
import { enc, type CompareRow } from './model';

/** Remount with a key per run pair so a previous comparison is never shown under new labels. */
export function Compare({ baseline, selected }: { baseline: RunRow | null; selected: RunRow }) {
  const same = !baseline || baseline.run_label === selected.run_label;
  const cmp = useApi<CompareRow[]>(
    same || !baseline ? null : `/api/compare?a=${enc(baseline.run_label)}&b=${enc(selected.run_label)}`,
  );
  if (!baseline) return <EmptyState title="No baseline run yet">The baseline is the first labelled run of the build.</EmptyState>;
  if (same) return <EmptyState title="This is the baseline">Pick another run above to compare it with the baseline.</EmptyState>;
  if (cmp.error) return <ErrorState error={cmp.error} retry={() => void cmp.reload()} />;
  if (!cmp.data) return <Loading />;

  const rows = cmp.data;
  const changed = rows.filter((r) => r.status_a !== r.status_b);
  const failA = rows.filter((r) => r.status_a === 'FAIL').length;
  const failB = rows.filter((r) => r.status_b === 'FAIL').length;

  return (
    <div className="space-y-3 text-sm">
      <p>
        Compared with the baseline <span className="font-mono text-xs">{baseline.run_label}</span>. FAIL: {failA} to {failB}.{' '}
        {changed.length} check{changed.length === 1 ? '' : 's'} changed status.
      </p>
      {changed.length === 0 ? (
        <EmptyState title="No status changes" />
      ) : (
        <div className="max-h-80 overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Check</TableHead>
                <TableHead>Level</TableHead>
                <TableHead>Baseline</TableHead>
                <TableHead>This run</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {changed.map((r) => (
                <TableRow key={r.check_name} className="bg-amber-50/60 dark:bg-amber-950/30">
                  <TableCell className="font-mono text-xs">{r.check_name}</TableCell>
                  <TableCell>{r.level ?? '—'}</TableCell>
                  <TableCell>{r.status_a ? <StatusChip status={r.status_a} /> : '—'}</TableCell>
                  <TableCell>{r.status_b ? <StatusChip status={r.status_b} /> : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
