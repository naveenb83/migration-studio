/** Task 4 · Prove it with data: run clean (gate), break it (a planted fault must be rejected), edge cases (tricky rows,
 * legacy logic and converted code both run on them). Every claim names its exact run label. */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@databricks/appkit-ui/react';
import { CheckCircle2, FlaskConical, Hammer, Play, XCircle } from 'lucide-react';
import { EmptyState, Kpi, Loading, Section, TaskHeader, fmtTime, notify } from '@/components/common';
import { api, ApiError, track } from '@/lib/api';
import type { ConversionInfo, RunReport } from '@/lib/conversion';
import { evaluate } from '@/lib/doneWhen';
import { useSession, useTask } from '@/lib/me';
import { useApi, useJobPoll } from '@/lib/poll';
import type { EntryRow, JobStatus, RunRow } from '@/lib/types';
import { RunReportView } from '../task2/RunReportView';

type Mode = 'clean' | 'fault' | 'edge';
const FAULTS = [
  { id: 'wrong_value', label: 'Wrong value', help: 'one value changed on one row' },
  { id: 'missing_row', label: 'Missing row', help: 'one key removed' },
  { id: 'extra_row', label: 'Extra row', help: 'one row duplicated' },
];
const kindOf = (label: string): Mode | null => (/_cprove_clean_/.test(label) ? 'clean' : /_cprove_fault_/.test(label) ? 'fault' : /_cprove_edge_/.test(label) ? 'edge' : null);

export default function ProvePage() {
  useSession();
  const task = useTask('task4');
  const info = useApi<ConversionInfo>('/api/conversion');
  const runs = useApi<RunRow[]>('/api/runs');
  const progress = useApi<EntryRow<{ status?: string }>[]>('/api/entries?kind=task_progress');
  const [job, setJob] = useState<{ run_label: string; job_run_id: number; mode: Mode } | null>(null);
  const [fault, setFault] = useState('wrong_value');
  const [output, setOutput] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const { status } = useJobPoll(job?.job_run_id ?? null, () => void runs.reload());
  const s: JobStatus | null = status;
  const finished = s && ['passed', 'completed', 'gate_rejected', 'artifact_error', 'infra_error'].includes(s.state);
  const report = useApi<RunReport | null>(finished && job ? `/api/conversion/report/${encodeURIComponent(job.run_label)}` : null, [s?.state]);
  useEffect(() => track('task_view', 'task4'), []);

  const history = useMemo(() => (runs.data ?? []).filter((r) => r.kind === 'cprove'), [runs.data]);
  if (!task) return <EmptyState title="Task 4 is not in this pack." />;
  const facts = {
    cprove: {
      clean_passed: history.filter((r) => kindOf(r.run_label) === 'clean' && Number(r.n_blocking) === 0).length,
      fault_rejected: history.filter((r) => kindOf(r.run_label) === 'fault' && Number(r.n_blocking) > 0).length,
      edge: history.filter((r) => kindOf(r.run_label) === 'edge').length,
    },
  };
  const checks = Object.fromEntries((task.done_when ?? []).map((d) => [d.id, evaluate(d.rule, facts)]));
  const done = (progress.data ?? []).some((e) => e.entry_key === 'task4' && e.payload?.status === 'done');
  const markDone = async () => {
    await api.post('/api/entries', { kind: 'task_progress', entry_key: 'task4', payload: { status: 'done' } });
    await progress.reload();
    notify.ok('Task 4 marked done.');
  };
  const start = async (mode: Mode) => {
    setBusy(true);
    try {
      const r = await api.post<{ run_label: string; job_run_id: number }>('/api/conversion/prove', {
        mode,
        ...(mode === 'fault' ? { fault, ...(output ? { output_id: output } : {}) } : {}),
      });
      setJob({ ...r, mode });
    } catch (e) {
      notify.error(e instanceof ApiError && (e.status === 409 || e.status === 400 || e.status === 503) ? e.message : `Could not start: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const running = Boolean(job && !finished);
  const verdict = (mode: Mode, state: string) => {
    if (state === 'artifact_error' || state === 'infra_error') return { ok: false, text: 'The run didn’t get as far as the checks (see the reason).' };
    const rejected = state === 'gate_rejected';
    if (mode === 'fault') return rejected ? { ok: true, text: 'Good: the gate caught the planted fault and rejected the run.' } : { ok: false, text: 'Not caught: the gate passed a broken result. The checks need to cover this.' };
    return rejected ? { ok: false, text: 'The gate rejected it: the converted output differs from legacy (see Validate).' } : { ok: true, text: 'Passed: the converted output equals legacy on every blocking check.' };
  };

  return (
    <div className="space-y-6">
      <TaskHeader task={task} checks={checks} onMarkDone={() => void markDone()} done={done} />
      <Section
        title="What the proof covers"
        description="The gate passes a run only if every blocking check passes: same rows, same keys, the same value in every compared column, and every converted statement ran."
      >
        {!info.data ? (
          <Loading rows={2} />
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {info.data.outputs.map((o) => (
              <div key={o.id} className="rounded-md border p-2 text-xs">
                <div className="font-medium">{o.label}</div>
                <div className="text-muted-foreground">{o.explain}</div>
              </div>
            ))}
            {info.data.stand_ins.concat(info.data.feeds.map((f) => ({ label: f.label, name: f.from.split('.').pop() ?? '', why: f.why }))).map((x) => (
              <div key={x.label + x.name} className="rounded-md border border-dashed p-2 text-xs">
                <Badge variant="outline" className="mr-1">{x.label}</Badge> not your code: {x.why}
              </div>
            ))}
          </div>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Play className="h-4 w-4" /> 1 · Run clean</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">Runs your converted SQL fresh and gates on the comparison. Passes only if it gives the same result as legacy.</p>
            <Button disabled={busy || running} onClick={() => void start('clean')}>Run clean</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Hammer className="h-4 w-4" /> 2 · Break it</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">Plants one fault in a copy of a converted output. A useful test must reject it and name the row.</p>
            <Select value={fault} onValueChange={setFault}>
              <SelectTrigger aria-label="Fault to plant"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FAULTS.map((f) => (
                  <SelectItem key={f.id} value={f.id}>{f.label}: {f.help}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={output || '__first__'} onValueChange={(v) => setOutput(v === '__first__' ? '' : v)}>
              <SelectTrigger aria-label="Output to break"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__first__">First compared output</SelectItem>
                {(info.data?.outputs ?? []).map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="secondary" disabled={busy || running} onClick={() => void start('fault')}>Break it and run</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><FlaskConical className="h-4 w-4" /> 3 · Edge cases</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">{info.data?.edge?.explain ?? 'This pack has no edge cases.'}</p>
            <Button variant="outline" disabled={busy || running || !info.data?.edge} onClick={() => void start('edge')}>Run edge cases</Button>
          </CardContent>
        </Card>
      </div>

      {job && (
        <Section title={`This run: ${job.run_label}`} description="About 3 minutes (edge cases about 5). One run at a time per team.">
          <div className="space-y-3 text-sm">
            {!finished ? (
              <div>{s ? (s.state === 'queued' ? 'Queued: waiting for compute' : 'Running…') : 'Starting…'}</div>
            ) : (
              (() => {
                const v = verdict(job.mode, s!.state);
                return (
                  <div className={`flex items-center gap-2 rounded-md border p-2 ${v.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-red-300 bg-red-50 text-red-900'}`}>
                    {v.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />} {v.text}
                  </div>
                );
              })()
            )}
            {s?.reason && <div className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-900">{s.reason}</div>}
            {s?.run_log && (
              <div className="grid grid-cols-5 gap-2">
                <Kpi label="Pass" value={s.run_log.n_pass} tone="PASS" />
                <Kpi label="Fail" value={s.run_log.n_fail} tone="FAIL" />
                <Kpi label="Warn" value={s.run_log.n_warn} tone="WARN" />
                <Kpi label="Info" value={s.run_log.n_info} tone="INFO" />
                <Kpi label="Error" value={s.run_log.n_error} tone="ERROR" />
              </div>
            )}
            {report.data && report.data.run_label === job.run_label && <RunReportView report={report.data} />}
            {s?.run_log && (
              <Button asChild variant="outline" size="sm">
                <Link to={`/task3?run=${encodeURIComponent(job.run_label)}`}>Open the checks and sample rows in Validate</Link>
              </Button>
            )}
          </div>
        </Section>
      )}

      <Section title="Proof history" description="Your team's prove runs. The gate result is the run's own: FAIL or ERROR blocks it.">
        {history.length === 0 ? (
          <EmptyState title="No prove runs yet" />
        ) : (
          <div className="divide-y rounded-md border text-sm">
            {history.map((r) => {
              const m = kindOf(r.run_label);
              const blocked = Number(r.n_blocking) > 0;
              const good = m === 'fault' ? blocked : !blocked;
              return (
                <div key={r.run_label} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div>
                    <Badge variant="outline" className="mr-2">{m === 'fault' ? 'break it' : m === 'edge' ? 'edge cases' : 'run clean'}</Badge>
                    <code className="text-xs">{r.run_label}</code> <span className="text-xs text-muted-foreground">{fmtTime(r.run_ts)}</span>
                  </div>
                  <div className={`text-xs ${good ? 'text-emerald-700' : 'text-red-700'}`}>
                    {blocked ? `gate rejected (${r.n_fail} fail, ${r.n_error} error)` : 'gate passed'}
                    {m === 'fault' && (blocked ? ' · fault caught' : ' · fault NOT caught')}
                  </div>
                  <Link className="text-xs underline" to={`/task3?run=${encodeURIComponent(r.run_label)}`}>Open in Validate</Link>
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}
