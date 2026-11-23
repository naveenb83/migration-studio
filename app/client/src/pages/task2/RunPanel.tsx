/** "Run my files": trigger the recheck job, poll its state, show counts for that exact run_label and the executed hashes. */
import { useState } from 'react';
import { Link } from 'react-router';
import { Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@databricks/appkit-ui/react';
import { Play } from 'lucide-react';
import { Kpi, Section, StatusChip, notify } from '@/components/common';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/me';
import { useApi, useJobPoll } from '@/lib/poll';
import type { JobStatus } from '@/lib/types';

const STATE_TEXT: Record<string, string> = {
  queued: 'Queued: waiting for compute',
  running: 'Running your files (about 4 minutes)',
  passed: 'Finished: no blocking checks',
  completed: 'Finished: results saved (some checks still fail; see Validate)',
  gate_rejected: 'The gate rejected this run (results saved)',
  artifact_error: 'Your files could not be run',
  infra_error: 'The run failed for a platform reason',
};

export function RunPanel({ onFinished }: { onFinished: () => void }) {
  const me = useSession();
  const [job, setJob] = useState<{ run_label: string; job_run_id: number; apply_accepted: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const { status, error } = useJobPoll(job?.job_run_id ?? null, () => onFinished());
  const artifacts = useApi<Array<{ artifact: string; path: string; sha256: string; executed_as: string }>>(
    status && ['passed', 'completed', 'gate_rejected'].includes(status.state) ? `/api/runs/${encodeURIComponent(status.run_label)}/artifacts` : null,
    [status?.state],
  );
  const expected = me.pack.recon.expected_scorecards?.[job?.apply_accepted ? 'after_fix' : 'recheck_as_built'];

  const run = async () => {
    setBusy(true);
    try {
      setJob(await api.post<{ run_label: string; job_run_id: number; apply_accepted: boolean }>('/api/recheck'));
    } catch (e) {
      notify.error(e instanceof ApiError && e.status === 409 ? e.message : `Could not start the run: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const s: JobStatus | null = status;
  return (
    <Section
      title="Run my files"
      description="Executes your saved team files after the latest ingest, records their SHA-256, then re-validates. The results are labelled with this run's own label."
      actions={
        <Button disabled={busy || Boolean(s && !['passed', 'completed', 'gate_rejected', 'artifact_error', 'infra_error'].includes(s.state))} onClick={() => void run()}>
          <Play className="mr-1 h-4 w-4" /> Run my files
        </Button>
      }
    >
      {!job && <div className="text-sm text-muted-foreground">One run at a time per team. It takes about 4 minutes.</div>}
      {job && (
        <div className="space-y-3 text-sm">
          <div>
            Run label <code>{job.run_label}</code>
            {job.apply_accepted && <span className="ml-2"><StatusChip status="INFO" simulated /> classroom approvals on</span>}
          </div>
          <div className={s?.state === 'artifact_error' || s?.state === 'infra_error' ? 'text-red-700' : ''}>{s ? STATE_TEXT[s.state] ?? s.state : 'Starting…'}</div>
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
          {s?.run_log && expected && (
            <div className="text-xs text-muted-foreground">
              Reference for these files: {expected.pass}/{expected.fail}/{expected.warn}/{expected.info}/{expected.error}. Different is fine: your edits change the result.
            </div>
          )}
          {(artifacts.data ?? []).length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File executed</TableHead>
                  <TableHead>How</TableHead>
                  <TableHead>SHA-256</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(artifacts.data ?? []).map((a) => (
                  <TableRow key={a.artifact}>
                    <TableCell>{a.artifact}</TableCell>
                    <TableCell className="text-muted-foreground">{a.executed_as}</TableCell>
                    <TableCell>
                      <code className="text-xs">{a.sha256.slice(0, 16)}</code>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
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
