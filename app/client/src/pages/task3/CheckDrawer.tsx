import { Badge, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@databricks/appkit-ui/react';
import type { CheckRow } from '@/lib/types';
import { useApi } from '@/lib/poll';
import { AiBadge, CopyButton, EmptyState, ErrorState, Loading, StatusChip } from '@/components/common';
import { ClassifyForm } from './ClassifyForm';
import { SampleTable } from './SampleTable';
import { enc, isSimulated, type Explanation } from './model';

export function CheckDrawer({ runLabel, check, onClose, onSaved }: { runLabel: string; check: CheckRow | null; onClose: () => void; onSaved: () => void }) {
  return (
    <Sheet open={check !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        {check && <CheckBody key={`${runLabel}:${check.check_name}`} runLabel={runLabel} check={check} onSaved={onSaved} />}
      </SheetContent>
    </Sheet>
  );
}

/** Keyed per run and check, so samples and explanation load fresh for each one. */
function CheckBody({ runLabel, check, onSaved }: { runLabel: string; check: CheckRow; onSaved: () => void }) {
  const samples = useApi<unknown[]>(`/api/runs/${enc(runLabel)}/samples/${enc(check.check_name)}`);
  const expl = useApi<Explanation | null>(`/api/runs/${enc(runLabel)}/explanation/${enc(check.check_name)}`);
  const query = expl.data?.confirm_query ?? null;
  const rawDiffers = check.raw_status !== check.status || (check.raw_detail !== null && check.raw_detail !== check.detail);

  return (
    <>
      <SheetHeader>
        <SheetTitle className="break-all font-mono text-base">{check.check_name}</SheetTitle>
        <SheetDescription>{check.description}</SheetDescription>
      </SheetHeader>
      <div className="space-y-5 pb-8 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={check.status} simulated={isSimulated(check)} />
          <Badge variant="outline">{check.level}</Badge>
          {check.layer && <Badge variant="outline">{check.layer}</Badge>}
          <span className="text-xs text-muted-foreground">run {runLabel}</span>
        </div>

        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Metric</dt>
          <dd>{check.metric === null ? '—' : String(Number(check.metric))} (expect {check.expect})</dd>
          <dt className="text-muted-foreground">Detail</dt>
          <dd className="break-words">{check.detail}</dd>
          {rawDiffers && (
            <>
              <dt className="text-muted-foreground">Raw result</dt>
              <dd className="break-words">
                {check.raw_status}
                {check.raw_detail ? `: ${check.raw_detail}` : ''}
              </dd>
            </>
          )}
          <dt className="text-muted-foreground">Coverage</dt>
          <dd>{check.coverage === null ? '—' : String(Number(check.coverage))} rows checked</dd>
        </dl>

        <section className="space-y-2">
          <h4 className="font-semibold">Sample rows</h4>
          {samples.error ? (
            <ErrorState error={samples.error} retry={() => void samples.reload()} />
          ) : !samples.data ? (
            <Loading rows={2} />
          ) : (
            <SampleTable rows={samples.data} />
          )}
        </section>

        <section className="space-y-2">
          <h4 className="font-semibold">Explanation</h4>
          {expl.error ? (
            <ErrorState error={expl.error} retry={() => void expl.reload()} />
          ) : !expl.data && !expl.loading ? (
            <EmptyState title="No explanation for this check yet">Use the detail and sample rows above.</EmptyState>
          ) : !expl.data ? (
            <Loading rows={2} />
          ) : (
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap gap-2">
                <AiBadge />
                {expl.data.from_baseline && <Badge variant="secondary">explanation from the baseline run</Badge>}
              </div>
              {expl.data.category && <div><b>Category:</b> {expl.data.category}</div>}
              {expl.data.probable_cause && <div><b>Probable cause:</b> {expl.data.probable_cause}</div>}
              {expl.data.suggested_fix && <div><b>Suggested fix:</b> {expl.data.suggested_fix}</div>}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h4 className="font-semibold">Confirm query</h4>
          {query ? (
            <>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{query}</pre>
              <div className="flex items-center gap-2">
                <CopyButton text={query} label="Copy query" />
                <span className="text-xs text-muted-foreground">Running it from this app is not part of this build. Paste it into the SQL editor.</span>
              </div>
            </>
          ) : expl.loading || !expl.data ? (
            <Loading rows={1} />
          ) : (
            <EmptyState title="No confirm query for this check." />
          )}
        </section>

        <section className="space-y-2">
          <h4 className="font-semibold">Classification</h4>
          <p className="text-xs text-muted-foreground">
            Group, owner and evidence for this check. Saved for the team, so your partner sees it on their next refresh.
          </p>
          <ClassifyForm runLabel={runLabel} check={check} onSaved={onSaved} />
        </section>
      </div>
    </>
  );
}
