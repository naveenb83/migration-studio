/** Landing: the pack's "what goes where" table, plus how many legacy objects the scanner put in each destination. */
import { useMemo } from 'react';
import { Kpi, EmptyState, ErrorState, Loading, Section } from '@/components/common';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@databricks/appkit-ui/react';
import { useSession } from '@/lib/me';
import { useApi } from '@/lib/poll';
import { LANDING_LABEL, landingTone, type LandingRow } from './shared';

export function LandingTab() {
  const { pack } = useSession();
  const land = useApi<LandingRow[]>('/api/estate/estate_landing');
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of land.data ?? []) m.set(r.landing, (m.get(r.landing) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [land.data]);

  return (
    <div className="space-y-5">
      <Section title="What goes where" description="The pack's landing table. It is the team's starting rule, and each row needs checking against the code.">
        {pack.pipelines_landing.length === 0 ? (
          <EmptyState title="No landing table in this pack" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Today</TableHead>
                  <TableHead>Goes to</TableHead>
                  <TableHead>Check</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pack.pipelines_landing.map((r) => (
                  <TableRow key={r.today}>
                    <TableCell className="align-top font-medium">{r.today}</TableCell>
                    <TableCell className="align-top">{r.goes_to}</TableCell>
                    <TableCell className="align-top text-muted-foreground">{r.check ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>
      <Section title="Scanner's count by destination" description="How many scanned objects the scanner put in each destination.">
        {land.loading && !land.data ? (
          <Loading rows={2} />
        ) : land.error ? (
          <ErrorState error={land.error} retry={() => void land.reload()} />
        ) : counts.length === 0 ? (
          <EmptyState title="No landing rows yet" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {counts.map(([dest, n]) => (
              <div key={dest} className={`rounded-lg border p-3 ${landingTone(dest)}`}>
                <Kpi label={LANDING_LABEL[dest] ?? dest} value={n} />
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
