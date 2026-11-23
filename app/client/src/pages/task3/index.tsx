import { useEffect, useMemo, useState } from 'react';
import { api, track } from '@/lib/api';
import { useSession, useTask } from '@/lib/me';
import { useApi, useInterval } from '@/lib/poll';
import { evaluate, type Facts } from '@/lib/doneWhen';
import type { EntryRow, RunRow } from '@/lib/types';
import { EmptyState, ErrorState, Loading, notify, Section, TaskHeader } from '@/components/common';
import { Card, CardContent, CardHeader, CardTitle } from '@databricks/appkit-ui/react';
import { Compare } from './Compare';
import { ChecksTable } from './ChecksTable';
import { CheckDrawer } from './CheckDrawer';
import { Classroom } from './Classroom';
import { RunPicker } from './RunPicker';
import { Scorecard } from './Scorecard';
import { coversNonPass, defaultRunLabel, enc, type ChecksResponse, type ClassroomStatus } from './model';

export default function Page() {
  // Session context is needed for the pack; the task definition comes from it.
  useSession();
  const task = useTask('task3');
  const runs = useApi<RunRow[]>('/api/runs');
  const classroom = useApi<ClassroomStatus>('/api/classroom');
  const progress = useApi<EntryRow<{ status?: string }>[]>('/api/entries?kind=task_progress');
  const [picked, setPicked] = useState<string | null>(null);
  const [openCheck, setOpenCheck] = useState<string | null>(null);

  const runList = useMemo(() => runs.data ?? [], [runs.data]);
  const runLabel = picked ?? defaultRunLabel(runList);
  const run = runList.find((r) => r.run_label === runLabel) ?? null;
  const checks = useApi<ChecksResponse>(run ? `/api/runs/${enc(run.run_label)}/checks` : null);
  const baseline = runList.find((r) => r.kind === 'baseline') ?? null;

  // Partners' classifications and status changes show up within one refresh (cache is off on the server).
  useInterval(() => {
    if (document.visibilityState !== 'visible') return;
    void runs.reload();
    void checks.reload();
    void classroom.reload();
    void progress.reload();
  }, 5000);

  useEffect(() => {
    track('task_view', 'task3');
  }, []);

  if (!task) return <EmptyState title="Task 3 is not in this pack." />;

  // Only trust checks that belong to the selected label.
  const liveChecks = checks.data && run && checks.data.run_label === run.run_label ? checks.data.checks : null;
  const facts: Facts = liveChecks ? { classifications: { covers_non_pass: coversNonPass(liveChecks) } } : {};
  const doneChecks: Record<string, boolean | null> = Object.fromEntries((task.done_when ?? []).map((d) => [d.id, evaluate(d.rule, facts)]));
  const done = (progress.data ?? []).some((e) => e.entry_key === 'task3' && e.payload?.status === 'done');

  const markDone = async () => {
    try {
      await api.post('/api/entries', { kind: 'task_progress', entry_key: 'task3', payload: { status: 'done' } });
      notify.ok('Task 3 marked done.');
      await progress.reload();
    } catch (e) {
      notify.error((e as Error).message);
    }
  };

  const rechecked = (label: string) => {
    setPicked(label);
    void runs.reload();
    void classroom.reload();
  };

  return (
    <div className="space-y-6">
      <TaskHeader task={task} checks={doneChecks} onMarkDone={() => void markDone()} done={done} />

      <Section title="Which run are we looking at?" description="Every result belongs to one run label. Pass and fail claims always name that exact run, never 'the latest'.">
        {runs.error ? (
          <ErrorState error={runs.error} retry={() => void runs.reload()} />
        ) : !runs.data ? (
          <Loading rows={1} />
        ) : runList.length === 0 ? (
          <EmptyState title="No labelled runs yet">Run a recheck with the button in Classroom mode below, or from Task 2.</EmptyState>
        ) : run ? (
          <RunPicker runs={runList} value={run.run_label} onChange={setPicked} />
        ) : null}
      </Section>

      {run && (
        <Section title={`Scorecard: ${run.run_label}`} description="KPIs match this run's log. The chart shows where the differences sit, by layer level.">
          <Scorecard run={run} checks={liveChecks} error={checks.error} retry={() => void checks.reload()} />
        </Section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Classroom status={classroom.data} error={classroom.error} reload={() => void classroom.reload()} onRechecked={rechecked} />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Compare with the baseline</CardTitle>
          </CardHeader>
          <CardContent>
            {run ? <Compare key={`${baseline?.run_label ?? ''}:${run.run_label}`} baseline={baseline} selected={run} /> : <Loading rows={2} />}
          </CardContent>
        </Card>
      </div>

      {run && (
        <Section title="Checks" description="Open a check to see its sample rows, explanation and classification.">
          {checks.error && !liveChecks ? (
            <ErrorState error={checks.error} retry={() => void checks.reload()} />
          ) : !liveChecks ? (
            <Loading rows={4} />
          ) : (
            <ChecksTable checks={liveChecks} onOpen={setOpenCheck} />
          )}
        </Section>
      )}

      <CheckDrawer
        runLabel={run?.run_label ?? ''}
        check={run && liveChecks ? (liveChecks.find((c) => c.check_name === openCheck) ?? null) : null}
        onClose={() => setOpenCheck(null)}
        onSaved={() => void checks.reload()}
      />
    </div>
  );
}
