/** Task 3 · Validate: legacy vs converted. Same inputs, same answers? Per output: matching, checks, sample rows. */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, track } from '@/lib/api';
import { comparedAll, type RunReport } from '@/lib/conversion';
import { evaluate, type Facts } from '@/lib/doneWhen';
import { useSession, useTask } from '@/lib/me';
import { useApi, useInterval } from '@/lib/poll';
import type { EntryRow, RunRow } from '@/lib/types';
import { EmptyState, ErrorState, Loading, notify, Section, TaskHeader } from '@/components/common';
import { ChecksTable } from '../task3/ChecksTable';
import { CheckDrawer } from '../task3/CheckDrawer';
import { RunPicker } from '../task3/RunPicker';
import { Scorecard } from '../task3/Scorecard';
import { coversNonPass, enc, type ChecksResponse } from '../task3/model';
import { ConvertRun } from '../task2/ConvertRun';
import { RunReportView } from '../task2/RunReportView';
import { Mapping } from './Mapping';

export default function ValidatePage() {
  useSession();
  const task = useTask('task3');
  const [params] = useSearchParams();
  const runs = useApi<RunRow[]>('/api/runs');
  const progress = useApi<EntryRow<{ status?: string }>[]>('/api/entries?kind=task_progress');
  const [picked, setPicked] = useState<string | null>(params.get('run'));
  const [openCheck, setOpenCheck] = useState<string | null>(null);

  const runList = useMemo(() => (runs.data ?? []).filter((r) => r.kind === 'convert' || r.kind === 'cprove'), [runs.data]);
  const runLabel = picked && runList.some((r) => r.run_label === picked) ? picked : (runList.find((r) => r.kind === 'convert')?.run_label ?? runList[0]?.run_label ?? null);
  const run = runList.find((r) => r.run_label === runLabel) ?? null;
  const checks = useApi<ChecksResponse>(run ? `/api/runs/${enc(run.run_label)}/checks` : null);
  const report = useApi<RunReport | null>(run ? `/api/conversion/report/${enc(run.run_label)}` : null);

  useInterval(() => {
    if (document.visibilityState !== 'visible') return;
    void runs.reload();
    void checks.reload();
    void progress.reload();
  }, 8000);
  useEffect(() => track('task_view', 'task3'), []);
  if (!task) return <EmptyState title="Task 3 is not in this pack." />;

  const liveChecks = checks.data && run && checks.data.run_label === run.run_label ? checks.data.checks : null;
  const facts: Facts = {
    ...(liveChecks ? { classifications: { covers_non_pass: coversNonPass(liveChecks) } } : {}),
    convert: { runs: runList.filter((r) => r.kind === 'convert').length, compared_all: comparedAll(report.data) },
  };
  const doneChecks = Object.fromEntries((task.done_when ?? []).map((d) => [d.id, evaluate(d.rule, facts)]));
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

  return (
    <div className="space-y-6">
      <TaskHeader task={task} checks={doneChecks} onMarkDone={() => void markDone()} done={done} />

      <Section title="Which run are we looking at?" description="Every result belongs to one run label. A pass or fail claim always names that exact run, never 'the latest'.">
        {runs.error ? (
          <ErrorState error={runs.error} retry={() => void runs.reload()} />
        ) : !runs.data ? (
          <Loading rows={1} />
        ) : runList.length === 0 ? (
          <EmptyState title="No runs of your converted SQL yet">Go to 2 · Convert &amp; run → Run my files.</EmptyState>
        ) : run ? (
          <RunPicker runs={runList} value={run.run_label} onChange={setPicked} />
        ) : null}
      </Section>

      {run && (
        <Section title={`Scorecard: ${run.run_label}`} description="Pass = the converted output gives the same answer as legacy on that check. KPIs match this run's log.">
          <Scorecard run={run} checks={liveChecks} error={checks.error} retry={() => void checks.reload()} />
        </Section>
      )}

      {run && (
        <Section
          title="Legacy vs converted, output by output"
          description="Each converted output was fed the same inputs as the legacy object it replaces. Columns are matched by name, then by their values (Genie Migrate often renames columns). Columns that change on every run (audit columns, current time or user) aren't compared."
        >
          {report.error ? (
            <ErrorState error={report.error} retry={() => void report.reload()} />
          ) : report.loading && report.data?.run_label !== run.run_label ? (
            <Loading rows={3} />
          ) : !report.data || report.data.run_label !== run.run_label ? (
            <EmptyState title="No report for this run">It may still be running, or it ran before reports existed.</EmptyState>
          ) : (
            <RunReportView report={report.data} showMatching />
          )}
        </Section>
      )}

      {run && (
        <Section title="Checks" description="Open a check to see the sample rows (the key, the legacy value and the converted value) and sort the difference.">
          {checks.error && !liveChecks ? (
            <ErrorState error={checks.error} retry={() => void checks.reload()} />
          ) : !liveChecks ? (
            <Loading rows={4} />
          ) : (
            <ChecksTable checks={liveChecks} onOpen={setOpenCheck} />
          )}
        </Section>
      )}

      {report.data && run && report.data.run_label === run.run_label && <Mapping report={report.data} />}

      <ConvertRun onFinished={() => void runs.reload()} />

      <CheckDrawer
        runLabel={run?.run_label ?? ''}
        check={run && liveChecks ? (liveChecks.find((c) => c.check_name === openCheck) ?? null) : null}
        onClose={() => setOpenCheck(null)}
        onSaved={() => void checks.reload()}
      />
    </div>
  );
}
