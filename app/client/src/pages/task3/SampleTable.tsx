import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@databricks/appkit-ui/react';
import { EmptyState } from '@/components/common';
import { cellText, isRecord } from './model';

/** Sample rows for one check in one exact run (the server caps them at 100). */
export function SampleTable({ rows }: { rows: unknown[] }) {
  if (rows.length === 0) return <EmptyState title="No sample rows for this check in this run." />;
  const objs = rows.filter(isRecord);
  const cols = [...new Set(objs.flatMap((o) => Object.keys(o)))].slice(0, 12);
  if (cols.length === 0) {
    return <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(rows, null, 2)}</pre>;
  }
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{rows.length} sample row{rows.length === 1 ? '' : 's'} (max 100)</div>
      <div className="max-h-80 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {cols.map((c) => (
                <TableHead key={c} className="whitespace-nowrap text-xs">
                  {c}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {objs.map((o, i) => (
              // Static, read-only list: row position is a stable key here.
              // eslint-disable-next-line react/no-array-index-key
              <TableRow key={i}>
                {cols.map((c) => (
                  <TableCell key={c} className="whitespace-nowrap font-mono text-xs">
                    {cellText(o[c])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
