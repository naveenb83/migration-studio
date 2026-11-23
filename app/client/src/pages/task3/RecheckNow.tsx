import { useState } from 'react';
import { Alert, AlertDescription, Button } from '@databricks/appkit-ui/react';
import { api, ApiError } from '@/lib/api';
import { useJobPoll } from '@/lib/poll';
import { TERMINAL, type JobStatus } from '@/lib/types';
import { notify } from '@/components/common';
import { STATE_TEXT, type RecheckStart } from './model';

/** Starts one recheck for the team and polls its job until terminal. Reports the finished run label up. */
export function RecheckNow({ onFinished }: { onFinished: (runLabel: string) => void }) {
  const [active, setActive] = useState<RecheckStart | null>(null);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const { status, error } = useJobPoll(active?.job_run_id ?? null, (s: JobStatus) => onFinished(s.run_label));

  const running = busy || (Boolean(active) && !(status && TERMINAL.includes(status.state)));

  const start = async () => {
    setBusy(true);
    setRefused(null);
    try {
      const r = await api.post<RecheckStart>('/api/recheck');
      setActive(r);
      notify.info(`Recheck started: ${r.run_label}`);
    } catch (e) {
      const msg = (e as Error).message;
      if (e instanceof ApiError && e.status === 409) setRefused(msg);
      else notify.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button size="sm" variant="outline" disabled={running} onClick={() => void start()}>
        {running ? 'Recheck running…' : 'Run recheck now'}
      </Button>
      {refused && (
        <Alert>
          <AlertDescription>{refused}</AlertDescription>
        </Alert>
      )}
      {active && (
        <div className="rounded-md border p-3 text-sm">
          <div>
            Run <span className="font-mono text-xs">{active.run_label}</span>:{' '}
            <b>{status ? STATE_TEXT[status.state] : 'Starting'}</b>
          </div>
          <div className="text-xs text-muted-foreground">
            {active.apply_accepted ? 'Classroom mode applied: results will be labelled SIMULATED.' : 'Raw recheck (classroom mode off).'}
          </div>
          {status?.reason && <div className="mt-1 break-words text-red-700 dark:text-red-300">{status.reason}</div>}
          {status?.run_log && (
            <div className="mt-1 text-xs">
              Counts for this label: {Number(status.run_log.n_pass)} pass, {Number(status.run_log.n_fail)} fail, {Number(status.run_log.n_blocking)} blocking.
            </div>
          )}
          {error && <div className="mt-1 text-xs text-muted-foreground">Status check failed: {error}</div>}
        </div>
      )}
    </div>
  );
}
