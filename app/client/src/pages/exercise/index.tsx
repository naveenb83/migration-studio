/** The exercise: the two lanes, the three comparison layers with live counts, and what goes where. */
import { Card, CardContent, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@databricks/appkit-ui/react';
import { EmptyState, PageHeader, Section } from '@/components/common';
import { useSession } from '@/lib/me';
import { LaneFlow } from './LaneFlow';
import { LayerCards } from './LayerCards';

export default function Page() {
  const { pack } = useSession();
  const lanes = pack.dataset.lanes;
  return (
    <div className="space-y-4">
      <PageHeader title={pack.dataset.title} kicker="The exercise">
        <span className="max-w-xl text-sm text-muted-foreground">{pack.dataset.summary}</span>
      </PageHeader>

      <Section title="Two lanes" description="Left: what runs today. Right: what the team builds. Open a step to read its code.">
        {lanes ? (
          <LaneFlow lanes={lanes} grainLegacy={pack.dataset.grain_legacy} grainNew={pack.dataset.grain_new} />
        ) : (
          <EmptyState title="No lanes in this pack" />
        )}
      </Section>

      <Section title="Three comparison layers" description="Each layer answers a different question. Counts are for the run you pick, from its saved checks.">
        <LayerCards layers={pack.recon.layers} />
      </Section>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">What goes where</CardTitle>
        </CardHeader>
        <CardContent>
          {pack.pipelines_landing.length === 0 ? (
            <EmptyState title="No landing guidance in this pack" />
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
        </CardContent>
      </Card>
    </div>
  );
}
