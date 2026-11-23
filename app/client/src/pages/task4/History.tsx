import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@databricks/appkit-ui/react';
import type { PublicPack } from '@/lib/types';
import { EmptyState, fmtTime } from '@/components/common';
import type { ProveRow } from './facts';

/** Prove runs for this team, newest first. Gate is derived from each run's own blocking count. */
export function History({ rows, faults }: { rows: ProveRow[]; faults: PublicPack['faults'] }) {
  if (rows.length === 0) return <EmptyState title="No prove runs yet">Your runs will appear here as you run the steps above.</EmptyState>;
  const faultLabel = (id: string) => faults.find((f) => f.id === id)?.label ?? id;
  return (
    <div className="space-y-2">
      <div className="max-h-96 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Run</TableHead>
              <TableHead>What it broke</TableHead>
              <TableHead>Pass / fail</TableHead>
              <TableHead>Gate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.run.run_label}>
                <TableCell className="whitespace-nowrap text-xs">{fmtTime(r.run.run_ts)}</TableCell>
                <TableCell className="font-mono text-xs">{r.run.run_label}</TableCell>
                <TableCell className="text-xs">
                  {r.tag.kind === 'clean' && 'Clean run'}
                  {r.tag.kind === 'fault' && faultLabel(r.tag.fault_id)}
                  {r.tag.kind === 'unknown' && <span className="text-muted-foreground">Unknown (no request record)</span>}
                </TableCell>
                <TableCell className="text-xs">
                  {Number(r.run.n_pass)} / {Number(r.run.n_fail)}
                </TableCell>
                <TableCell>
                  {r.blocking ? (
                    <Badge variant="outline" className="border-red-300 text-red-700 dark:text-red-300">
                      blocked
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:text-emerald-300">
                      passed
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="text-xs text-muted-foreground">
        Gate is read from the blocking count of each run. What it broke comes from the request log, or from the run label when the log has no record.
      </div>
    </div>
  );
}
