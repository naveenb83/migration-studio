/** Shared UI pieces: states, chips, badges, task header with the done-when checklist, notices. */
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle, Badge, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Skeleton } from '@databricks/appkit-ui/react';
import { AlertTriangle, CheckCircle2, Circle, Copy, Info, Sparkles } from 'lucide-react';
import type { TaskDef } from '@/lib/types';

export function Loading({ label = 'Loading…', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-6 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
      <div className="font-medium text-foreground">{title}</div>
      {children && <div className="mt-1">{children}</div>}
    </div>
  );
}

export function ErrorState({ error, retry, fallback }: { error: string; retry?: () => void; fallback?: ReactNode }) {
  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>
        <div className="break-words">{error}</div>
        {fallback && <div className="mt-2 text-foreground">{fallback}</div>}
        {retry && (
          <Button size="sm" variant="outline" className="mt-2" onClick={retry}>
            Try again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

const STATUS_STYLE: Record<string, string> = {
  PASS: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200',
  FAIL: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-950 dark:text-red-200',
  WARN: 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-200',
  INFO: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-200',
  ERROR: 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950 dark:text-purple-200',
};

export function StatusChip({ status, simulated }: { status: string | null | undefined; simulated?: boolean }) {
  const s = (status ?? '').toUpperCase();
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[s] ?? 'border-muted text-muted-foreground'} ${simulated ? 'border-dashed' : ''}`}
      title={simulated ? 'Classroom approval: SIMULATED, not a real sign-off' : undefined}
    >
      {s || '—'}
      {simulated && <span className="font-normal">· simulated</span>}
    </span>
  );
}

export const STATUS_COLORS = { PASS: '#059669', FAIL: '#dc2626', WARN: '#d97706', INFO: '#64748b', ERROR: '#7c3aed' };

export function AiBadge({ text = 'AI draft, check against the code' }: { text?: string }) {
  return (
    <Badge variant="outline" className="gap-1 border-violet-300 text-violet-700 dark:text-violet-300">
      <Sparkles className="h-3 w-3" /> {text}
    </Badge>
  );
}

const PROV: Record<string, string> = {
  seed: 'As-built seed',
  team_edit: 'Team edit',
  genie_migrate: 'Genie Migrate',
  genie_code: 'Genie Code',
  pasted: 'Pasted in',
  assistant_draft: 'AI draft',
  prepared_example: 'Prepared example',
};

export function ProvenanceChip({ source }: { source?: string | null }) {
  const s = source ?? 'seed';
  return (
    <Badge variant="secondary" className={s === 'assistant_draft' || s === 'prepared_example' ? 'border border-violet-300' : ''}>
      {PROV[s] ?? s}
    </Badge>
  );
}

export function Section({ title, description, actions, children }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
        </div>
        {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function PageHeader({ title, kicker, children }: { title: string; kicker?: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        {kicker && <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{kicker}</div>}
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      </div>
      {children}
    </div>
  );
}

/** Steps, done-when checklist and watch-for, all from the pack. `checks` maps done_when ids to true/false/null. */
export function TaskHeader({ task, checks, onMarkDone, done }: { task: TaskDef; checks: Record<string, boolean | null>; onMarkDone?: () => void; done?: boolean }) {
  const [manual, setManual] = useState<Record<string, boolean>>({});
  const seen = new Set<string>();
  const items = (task.done_when ?? []).filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
  const state = items.map((d) => checks[d.id] ?? (manual[d.id] ? true : null));
  const allTrue = items.length > 0 && state.every((s) => s === true);
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="md:col-span-2">
        <CardHeader className="pb-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{task.kicker}</div>
          <CardTitle className="text-xl">{task.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ol className="list-decimal space-y-1 pl-5">{(task.steps ?? []).map((s, i) => <li key={i}>{s}</li>)}</ol>
          {task.watch_for && (
            <div className="flex gap-2 rounded-md bg-amber-50 p-2 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <b>Watch for:</b> {task.watch_for}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Done when</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {items.map((d, i) => (
            <div key={d.id} className="flex items-start gap-2">
              {checks[d.id] === undefined || checks[d.id] === null ? (
                <Checkbox checked={Boolean(manual[d.id])} onCheckedChange={(v) => setManual((m) => ({ ...m, [d.id]: Boolean(v) }))} aria-label={d.label} />
              ) : state[i] ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className={state[i] ? 'text-foreground' : 'text-muted-foreground'}>{d.label}</span>
            </div>
          ))}
          {onMarkDone && (
            <Button size="sm" className="mt-2 w-full" disabled={!allTrue || done} onClick={onMarkDone}>
              {done ? 'Task marked done' : 'Mark task done'}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        });
      }}
    >
      <Copy className="mr-1 h-3 w-3" />
      {ok ? 'Copied' : label}
    </Button>
  );
}

/** Minimal notices (the UI library does not export a toast function). */
type Notice = { id: number; kind: 'ok' | 'error' | 'info'; text: string };
let push: ((n: Omit<Notice, 'id'>) => void) | null = null;
export const notify = {
  ok: (text: string) => push?.({ kind: 'ok', text }),
  error: (text: string) => push?.({ kind: 'error', text }),
  info: (text: string) => push?.({ kind: 'info', text }),
};

export function Notices() {
  const [items, setItems] = useState<Notice[]>([]);
  useEffect(() => {
    let n = 0;
    push = (x) => {
      const id = ++n;
      setItems((s) => [...s, { ...x, id }]);
      setTimeout(() => setItems((s) => s.filter((i) => i.id !== id)), x.kind === 'error' ? 9000 : 4000);
    };
    return () => {
      push = null;
    };
  }, []);
  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-96 flex-col gap-2" role="status" aria-live="polite">
      {items.map((i) => (
        <div
          key={i.id}
          className={`rounded-md border p-3 text-sm shadow-md ${i.kind === 'error' ? 'border-red-300 bg-red-50 text-red-900' : i.kind === 'ok' ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'bg-background'}`}
        >
          {i.text}
        </div>
      ))}
    </div>
  );
}

export function Kpi({ label, value, tone }: { label: string; value: ReactNode; tone?: keyof typeof STATUS_COLORS }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums" style={tone ? { color: STATUS_COLORS[tone] } : undefined}>
        {value}
      </div>
    </div>
  );
}

export const fmtTime = (ts: string | number | null | undefined) => {
  if (ts === null || ts === undefined || ts === '') return '—';
  const d = typeof ts === 'number' ? new Date(ts) : new Date(String(ts).replace(' ', 'T') + (/[zZ+]/.test(String(ts)) ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? String(ts) : d.toLocaleString([], { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
};
