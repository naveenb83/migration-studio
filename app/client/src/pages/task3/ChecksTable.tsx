import { useState } from 'react';
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@databricks/appkit-ui/react';
import type { CheckRow } from '@/lib/types';
import { EmptyState, StatusChip } from '@/components/common';
import { CLASS_OPTIONS, isClassified, isSimulated } from './model';

type Filter = 'nonpass' | 'unclassified' | 'all';
const FILTER_LABEL: Record<Filter, string> = {
  nonpass: 'Not passing',
  unclassified: 'Not passing and not classified',
  all: 'All checks',
};

export function ChecksTable({ checks, onOpen }: { checks: CheckRow[]; onOpen: (checkName: string) => void }) {
  const [filter, setFilter] = useState<Filter>('nonpass');
  const shown = checks.filter((c) => {
    if (filter === 'all') return true;
    if (c.status === 'PASS') return false;
    return filter === 'nonpass' || !isClassified(c);
  });

  return (
    <div className="space-y-3">
      <div className="w-full max-w-sm">
        <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <SelectTrigger aria-label="Filter checks">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
              <SelectItem key={f} value={f}>
                {FILTER_LABEL[f]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {shown.length === 0 ? (
        <EmptyState title="Nothing to show for this filter" />
      ) : (
        <div className="max-h-[32rem] overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">Level</TableHead>
                <TableHead>Check</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Metric vs expect</TableHead>
                <TableHead>Classification</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((c) => {
                const cls = CLASS_OPTIONS.find((o) => o.value === c.classification);
                return (
                  <TableRow key={c.check_name}>
                    <TableCell className="align-top text-xs">
                      {c.level}
                      {c.layer && <div className="text-muted-foreground">{c.layer}</div>}
                    </TableCell>
                    <TableCell className="align-top">
                      <Button variant="link" className="h-auto whitespace-normal p-0 text-left font-mono text-xs" onClick={() => onOpen(c.check_name)}>
                        {c.check_name}
                      </Button>
                      <div className="mt-0.5 text-xs text-muted-foreground">{c.description}</div>
                    </TableCell>
                    <TableCell className="align-top">
                      <StatusChip status={c.status} simulated={isSimulated(c)} />
                      {c.raw_status !== c.status && <div className="mt-1 text-xs text-muted-foreground">raw {c.raw_status}</div>}
                    </TableCell>
                    <TableCell className="align-top text-xs">
                      {c.metric === null ? '—' : String(Number(c.metric))} <span className="text-muted-foreground">vs {c.expect}</span>
                    </TableCell>
                    <TableCell className="align-top text-xs">
                      {c.status === 'PASS' ? (
                        <span className="text-muted-foreground">not needed</span>
                      ) : cls ? (
                        <>
                          <div>{cls.label.split(':')[0]}</div>
                          <div className="text-muted-foreground">owner: {c.class_owner ?? '—'}</div>
                        </>
                      ) : (
                        <span className="font-medium text-amber-700 dark:text-amber-300">needs classification</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
