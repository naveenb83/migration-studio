/** Run my files (converted SQL): start the convert job, poll it, then show what ran, the stand-ins and the first comparison. */
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@databricks/appkit-ui/react';
import { Play } from 'lucide-react';
import { Kpi, Section, notify } from '@/components/common';
import { api, ApiError } from '@/lib/api';
import type { RunReport } from '@/lib/conversion';
import { useApi, useJobPoll } from '@/lib/poll';
import type { JobStatus } from '@/lib/types';
import { RunReportView } from './RunReportView';

export const CONVERT_STATE_TEXT: Record<string, string> = {
  queued: 'Queued: waiting for compute',
  running: 'Running your converted SQL, then comparing it with legacy (about 3 minutes)',
  passed: 'Finished: the converted outputs match legacy on every check',
  completed: 'Finished: results saved (some checks differ; see Validate)',
  gate_rejected: 'The gate rejected this run (results saved)',
  artifact_error: 'Your files could not be run (see the reason)',
  infra_error: 'The run failed for a platform reason',
};
const DONE = ['passed', 'completed', 'gate_rejected', 'artifact_error', 'infra_error'];

export function ConvertRun({ onFinished }: { onFinished: () => void }) {
  const [job, setJob] = useState<{ run_label: string; job_run_id: number; files: Array<{ name: string; sha256: string }> } | null>(null);
  const [busy, setBusy] = useState(false);
  const { status, error } = useJobPoll(job?.job_run_id ?? null, () => onFinished());
  const s: JobStatus | null = status;
  const report = useApi<RunReport | null>(s && DONE.includes(s.state) ? `/api/conversion/report/${encodeURIComponent(s.run_label)}` : null, [s?.state]);

  const run = async () => {
    setBusy(true);
    try {
      setJob(await api.post('/api/convert-run'));
    } catch (e) {
      notify.error(e instanceof ApiError && (e.status === 409 || e.status === 503) ? e.message : `Could not start the run: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      title="Run my files"
      description="Runs the converted SQL you ticked, in your own sandbox, on the same source data the legacy system used. Each file's fingerprint (SHA-256) is recorded. Then every converted output is compared with the legacy table it replaces."
      actions={
        <Button disabled={busy || Boolean(s && !DONE.includes(s.state))} onClick={() => void run()}>
          <Play className="mr-1 h-4 w-4" /> Run my files
        </Button>
      }
    >
      {!job && (
        <div className="text-sm text-muted-foreground">
          One run at a time per team, about 3 minutes. Nothing writes to the legacy tables: the converted code runs in your sandbox schema, which is recreated on every run.
        </div>
      )}
      {job && (
        <div className="space-y-3 text-sm">
          <div>
            Run label <code>{job.run_label}</code> · {job.files.length} file(s)
          </div>
          <div className={s?.state === 'artifact_error' || s?.state === 'infra_error' ? 'text-red-700' : ''}>{s ? (CONVERT_STATE_TEXT[s.state] ?? s.state) : 'Starting…'}</div>
          {error && <div className="text-red-700">{error}</div>}
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
          {report.data && <RunReportView report={report.data} />}
          {s?.run_log && (
            <Button asChild variant="outline" size="sm">
              <Link to={`/task3?run=${encodeURIComponent(s.run_label)}`}>Open this run in Validate</Link>
            </Button>
          )}
        </div>
      )}
    </Section>
  );
}
