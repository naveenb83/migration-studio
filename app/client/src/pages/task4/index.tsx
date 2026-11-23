import { useEffect, useMemo, useState } from 'react';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle } from '@databricks/appkit-ui/react';
import { api, ApiError, track } from '@/lib/api';
import { useSession, useTask } from '@/lib/me';
import { useApi, useInterval, useJobPoll } from '@/lib/poll';
import { evaluate, type Facts } from '@/lib/doneWhen';
import { TERMINAL, type EntryRow, type JobStatus, type RunRow } from '@/lib/types';
import { EmptyState, ErrorState, Loading, notify, Section, TaskHeader } from '@/components/common';
import { FailureDetail, RulePresence } from './FailureDetail';
import { History } from './History';
import { RuleBuilder } from './RuleBuilder';
import { StepCard } from './StepCard';
import { proveFacts, summarise, type RequestRow } from './facts';
import { payloadFor, type ParamValues } from './rules';

type StepId = 'clean' | 'break' | 'repair' | 'again';

interface StepRun {
  step: StepId;
  run_label: string;
  job_run_id: number;
  fault_id: string | null;
  template_ids: string[];
}

interface ProveStart {
  run_label: string;
  job_run_id: number;
  rules_yaml: string;
}

const isTerminal = (s: JobStatus | null | undefined) => Boolean(s && TERMINAL.includes(s.state));

export default function Page() {
  const session = useSession();
  const task = useTask('task4');
  const { rule_templates: templates, faults, recon } = session.pack;
  const runs = useApi<RunRow[]>('/api/runs');
  const requests = useApi<RequestRow[]>('/api/requests');
  const progress = useApi<EntryRow<{ status?: string }>[]>('/api/entries?kind=task_progress');

  const [selected, setSelected] = useState<string[]>(() => (templates[0] ? [templates[0].id] : []));
  const [values, setValues] = useState<ParamValues>({});
  const [yaml, setYaml] = useState<string | null>(null);
  const [faultPick, setFaultPick] = useState<string>(() => faults[0]?.id ?? '');
  const [steps, setSteps] = useState<Partial<Record<StepId, StepRun>>>({});
  const [active, setActive] = useState<StepRun | null>(null);
  const [results, setResults] = useState<Record<number, JobStatus>>({});
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  // Finished runs are stored by job id, so each step keeps its own result after another step starts.
  const job = useJobPoll(active?.job_run_id ?? null, (s) => {
    setResults((r) => ({ ...r, [s.job_run_id]: s }));
    void runs.reload();
    void requests.reload();
  });

  useInterval(() => {
    if (document.visibilityState !== 'visible') return;
    void runs.reload();
    void requests.reload();
    void progress.reload();
  }, 5000);

  useEffect(() => {
    track('task_view', 'task4');
  }, []);

  const runList = useMemo(() => runs.data ?? [], [runs.data]);
  const faultIds = useMemo(() => faults.map((f) => f.id), [faults]);
  const summary = useMemo(() => summarise(runList, requests.data ?? [], faultIds), [runList, requests.data, faultIds]);

  if (!task) return <EmptyState title="Task 4 is not in this pack." />;

  const facts: Facts = runs.data ? proveFacts(runList, summary) : {};
  const doneChecks: Record<string, boolean | null> = Object.fromEntries((task.done_when ?? []).map((d) => [d.id, evaluate(d.rule, facts)]));
  const done = (progress.data ?? []).some((e) => e.entry_key === 'task4' && e.payload?.status === 'done');

  const markDone = async () => {
    try {
      await api.post('/api/entries', { kind: 'task_progress', entry_key: 'task4', payload: { status: 'done' } });
      notify.ok('Task 4 marked done.');
      await progress.reload();
    } catch (e) {
      notify.error((e as Error).message);
    }
  };

  const statusOf = (s: StepRun | undefined): JobStatus | null => {
    if (!s) return null;
    return results[s.job_run_id] ?? (active?.job_run_id === s.job_run_id ? job.status : null);
  };

  const locked = busy || (Boolean(active) && !isTerminal(job.status));
  const noRule = selected.length === 0;

  const start = async (step: StepId, fault: string | null) => {
    setBusy(true);
    setRefused(null);
    try {
      const r = await api.post<ProveStart>('/api/prove', {
        template_ids: selected,
        params: payloadFor(selected, templates, values),
        fault_id: fault,
      });
      const run: StepRun = { step, run_label: r.run_label, job_run_id: r.job_run_id, fault_id: fault, template_ids: selected };
      setYaml(r.rules_yaml);
      setSteps((s) => ({ ...s, [step]: run }));
      setActive(run);
      notify.info(`Prove run started: ${r.run_label}`);
    } catch (e) {
      const msg = (e as Error).message;
      if (e instanceof ApiError && e.status === 409) setRefused(msg);
      else notify.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < 3 ? [...cur, id] : cur));
  const setParam = (id: string, name: string, value: number) =>
    setValues((v) => ({ ...v, [id]: { ...(v[id] ?? {}), [name]: value } }));

  // Each step needs the one before it to have finished, and one run at a time for the team.
  const cleanS = steps.clean;
  const breakS = steps.break;
  const repairS = steps.repair;
  const cleanDone = isTerminal(statusOf(cleanS));
  const breakDone = isTerminal(statusOf(breakS));
  const repairDone = isTerminal(statusOf(repairS));
  const reasonFor = (prevDone: boolean, prevLabel: string) =>
    locked ? 'Another run is in progress. Wait for it to finish.' : !prevDone ? `Finish "${prevLabel}" first.` : undefined;

  const refFor = (key: string) => {
    const e = recon.expected_scorecards?.[key];
    return e ? { pass: e.pass ?? 0, fail: e.fail ?? 0 } : null;
  };
  const faultRef = breakS?.fault_id ? refFor(`prove_fault_${breakS.fault_id}`) : null;

  return (
    <div className="space-y-6">
      <TaskHeader task={task} checks={doneChecks} onMarkDone={() => void markDone()} done={done} />

      <Section title="Your rule" description="Pick vetted rules and set their parameters. Each run sends exactly what you see on the right.">
        <RuleBuilder templates={templates} selected={selected} values={values} yaml={yaml} onToggle={toggle} onParam={setParam} />
      </Section>

      {refused && (
        <Alert>
          <AlertDescription>{refused}</AlertDescription>
        </Alert>
      )}
      {runs.error && <ErrorState error={runs.error} retry={() => void runs.reload()} />}

      <Section title="Run the four steps" description="Each step names its own run label. A step counts only for its exact run, never 'the latest'.">
        <div className="grid gap-4 lg:grid-cols-2">
          <StepCard
            title="1. Run clean"
            expectation="PASS"
            runLabel={cleanS?.run_label ?? null}
            status={statusOf(cleanS)}
            expectState="passed"
            reference={refFor('prove_clean')}
            actionLabel="1. Run clean"
            onAction={() => void start('clean', null)}
            actionDisabled={locked || noRule}
            disabledReason={noRule ? 'Pick at least one rule.' : locked ? 'Another run is in progress.' : undefined}
          />

          <StepCard
            title="2. Break it"
            expectation="gate FAILED"
            runLabel={breakS?.run_label ?? null}
            status={statusOf(breakS)}
            expectState="gate_rejected"
            reference={faultRef}
            actionLabel="2. Break it"
            onAction={() => void start('break', faultPick)}
            actionDisabled={locked || noRule || !faultPick || !cleanDone}
            disabledReason={reasonFor(cleanDone, '1. Run clean') ?? (!faultPick ? 'No fault available.' : undefined)}
            controls={<FaultPicker faults={faults} value={faultPick} onChange={setFaultPick} />}
          >
            {breakS && breakDone && (
              <div className="space-y-2">
                <div className="text-xs font-medium">Failing rule and affected rows (from the samples of this run)</div>
                <FailureDetail runLabel={breakS.run_label} />
              </div>
            )}
          </StepCard>

          <StepCard
            title="3. Repair: run clean again"
            expectation="PASS"
            runLabel={repairS?.run_label ?? null}
            status={statusOf(repairS)}
            expectState="passed"
            reference={refFor('prove_clean')}
            actionLabel="3. Run clean again"
            onAction={() => void start('repair', null)}
            actionDisabled={locked || noRule || !breakDone}
            disabledReason={reasonFor(breakDone, '2. Break it')}
          />

          <StepCard
            title="4. Run again: the rule is still there"
            expectation="PASS, rule present"
            runLabel={steps.again?.run_label ?? null}
            status={statusOf(steps.again)}
            expectState="passed"
            reference={refFor('prove_clean')}
            actionLabel="4. Run again"
            onAction={() => void start('again', null)}
            actionDisabled={locked || noRule || !repairDone}
            disabledReason={reasonFor(repairDone, '3. Repair')}
          >
            {steps.again && (
              <RulePresence runLabel={steps.again.run_label} templates={templates.filter((t) => steps.again?.template_ids.includes(t.id))} />
            )}
          </StepCard>
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Swap drivers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>Person B repeats the break with a different fault, then runs clean to repair it.</p>
            <p className="text-muted-foreground">
              Faults this team has not tried yet:{' '}
              {faults.filter((f) => !summary.faultsTried.has(f.id)).map((f) => f.label).join(', ') || 'none, every fault has been tried'}.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Prove history</CardTitle>
          </CardHeader>
          <CardContent>
            {runs.error ? (
              <ErrorState error={runs.error} retry={() => void runs.reload()} />
            ) : !runs.data ? (
              <Loading rows={3} />
            ) : (
              <History rows={summary.rows} faults={faults} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FaultPicker({ faults, value, onChange }: { faults: Array<{ id: string; label: string; description: string }>; value: string; onChange: (id: string) => void }) {
  const f = faults.find((x) => x.id === value);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {faults.map((x) => (
          <Button key={x.id} size="sm" variant={x.id === value ? 'default' : 'outline'} onClick={() => onChange(x.id)} aria-pressed={x.id === value}>
            {x.label}
          </Button>
        ))}
      </div>
      {f && <div className="text-xs text-muted-foreground">{f.description}</div>}
    </div>
  );
}
