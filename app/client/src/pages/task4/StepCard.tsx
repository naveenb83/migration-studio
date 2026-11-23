import type { ReactNode } from 'react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@databricks/appkit-ui/react';
import { Loader2 } from 'lucide-react';
import { STATE_TEXT } from '@/pages/task3/model';
import { TERMINAL, type JobStatus } from '@/lib/types';

interface Props {
  title: string;
  expectation: string;
  runLabel: string | null;
  status: JobStatus | null;
  /** The state a correct run ends in: 'passed' for clean runs, 'gate_rejected' for fault runs. */
  expectState: 'passed' | 'gate_rejected';
  reference: { pass: number; fail: number } | null;
  actionLabel: string;
  onAction: () => void;
  actionDisabled: boolean;
  disabledReason?: string;
  /** Shown always (e.g. the fault picker). */
  controls?: ReactNode;
  /** Shown once the run is finished (e.g. failing rows, rule presence). */
  children?: ReactNode;
}

export function StepCard({ title, expectation, runLabel, status, expectState, reference, actionLabel, onAction, actionDisabled, disabledReason, controls, children }: Props) {
  const terminal = Boolean(status && TERMINAL.includes(status.state));
  const log = status?.run_log ?? null;
  const blocking = log ? Number(log.n_blocking) : 0;
  const outcome =
    terminal && status
      ? status.state === expectState && (expectState === 'passed' ? blocking === 0 : blocking > 0)
        ? 'as_expected'
        : 'unexpected'
      : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {title}
          <Badge variant="outline">expect {expectation}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {controls}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={actionDisabled} onClick={onAction}>
            {actionLabel}
          </Button>
          {disabledReason && actionDisabled && <span className="text-xs text-muted-foreground">{disabledReason}</span>}
        </div>

        {!runLabel && <div className="text-muted-foreground">Not run yet.</div>}

        {runLabel && (
          <div className="space-y-2 rounded-md border p-3">
            <div className="font-mono text-xs break-all">{runLabel}</div>
            <div className="flex flex-wrap items-center gap-2">
              {!terminal && (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {status ? STATE_TEXT[status.state] : 'Starting'}
                </span>
              )}
              {terminal && status && (
                <Badge variant="outline">{STATE_TEXT[status.state]}</Badge>
              )}
              {outcome === 'as_expected' && <Badge className="border-emerald-300 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">as expected</Badge>}
              {outcome === 'unexpected' && <Badge className="border-red-300 bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200">not as expected</Badge>}
            </div>
            {outcome === 'unexpected' && <div className="text-xs text-red-700 dark:text-red-300">Not what this step expects. Check the rules and the run below.</div>}
            {log && (
              <div className="text-xs">
                Counts for this label: {Number(log.n_pass)} pass, {Number(log.n_fail)} fail, {blocking} blocking.
                {reference && (
                  <span className="text-muted-foreground">
                    {' '}
                    Reference from the pack (default rules): {reference.pass} pass, {reference.fail} fail.{' '}
                    {Number(log.n_pass) === reference.pass && Number(log.n_fail) === reference.fail ? 'Matches.' : 'Differs (your rule set may differ).'}
                  </span>
                )}
              </div>
            )}
            {status?.reason && <div className="break-words text-xs text-red-700 dark:text-red-300">{status.reason}</div>}
          </div>
        )}
        {terminal && children}
      </CardContent>
    </Card>
  );
}
