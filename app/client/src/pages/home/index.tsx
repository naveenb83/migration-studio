import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@databricks/appkit-ui/react';
import { ArrowRight, Clock } from 'lucide-react';
import { ErrorState, Kpi, Loading, PageHeader, StatusChip, fmtTime } from '@/components/common';
import { useSession } from '@/lib/me';
import { useApi, useInterval } from '@/lib/poll';
import type { RunRow } from '@/lib/types';

interface HomeData {
  agenda: Array<{ entry_key: string; payload: { block?: number; message?: string; started_at?: string } }>;
  team: { last_run: (Partial<RunRow> & { run_label: string }) | null; active: { run_label: string; kind: string } | null; tasks_done: string[] } | null;
  measures: {
    time_per_step: Array<{ task_id: string; median_minutes: number; teams: number }>;
    assets_created: number;
    blocker_map: Array<Record<string, unknown>>;
    landing: Array<{ landing: string; n: number }>;
  };
}

const minutesOf = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

function Countdown({ startedAt, minutes }: { startedAt: string; minutes: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const end = new Date(startedAt).getTime() + minutes * 60_000;
  const left = Math.max(0, Math.round((end - now) / 1000));
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');
  return <span className={`tabular-nums ${left < 120 ? 'text-red-600' : ''}`}>{left ? `${mm}:${ss} left` : 'time is up'}</span>;
}

export default function HomePage() {
  const me = useSession();
  const { data, error, loading, reload } = useApi<HomeData>('/api/home');
  useInterval(() => void reload(), 20_000);
  const p = me.pack;
  if (loading && !data) return <Loading rows={6} />;
  if (error) return <ErrorState error={error} retry={reload} />;
  const cur = data?.agenda.find((a) => a.entry_key === 'current')?.payload;
  const block = cur?.block !== undefined ? p.agenda[cur.block] : undefined;
  const blockMinutes = block ? minutesOf(block.end) - minutesOf(block.start) : 0;
  const m = data?.measures;
  const measureText = (measure: string) => {
    if (!m) return '—';
    if (measure === 'time_per_step') return m.time_per_step.length ? m.time_per_step.map((t) => `${t.task_id}: ${Number(t.median_minutes).toFixed(0)} min`).join(' · ') : 'measured as teams finish tasks';
    if (measure === 'assets_created') return `${m.assets_created} files, imports and rule runs saved so far`;
    if (measure === 'blocker_coverage') {
      const b = m.blocker_map[0];
      return b ? `${String(b.job_name ?? b.package ?? 'shared job')}: ${String(b.datasets_migrated ?? 0)} of ${String(b.datasets_total ?? '?')} datasets migrated` : 'estate not loaded';
    }
    if (measure === 'destinations_assigned') {
      const total = m.landing.reduce((s, r) => s + Number(r.n), 0);
      const decided = m.landing.filter((r) => r.landing !== 'review').reduce((s, r) => s + Number(r.n), 0);
      return total ? `${decided} of ${total} objects have a destination` : 'estate not loaded';
    }
    return '—';
  };
  const next = p.tasks.find((t) => !(data?.team?.tasks_done ?? []).includes(t.id));
  return (
    <div className="space-y-6">
      <PageHeader title={p.engagement.title} kicker={p.dataset.title}>
        {me.team && next && (
          <Button asChild>
            <Link to={`/${next.id}`}>
              Next: {next.title.split(':')[0]} <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        )}
      </PageHeader>
      {p.engagement.disclaimer && <p className="text-sm text-muted-foreground">{p.engagement.disclaimer}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4" /> Now
            </CardTitle>
          </CardHeader>
          <CardContent>
            {block ? (
              <div className="space-y-1">
                <div className="text-lg font-semibold">{block.title}</div>
                <div className="text-sm text-muted-foreground">
                  {block.start}–{block.end} · {cur?.started_at ? <Countdown startedAt={cur.started_at} minutes={blockMinutes} /> : 'not started'}
                  {block.outputs ? ` · You leave with: ${block.outputs}` : ''}
                </div>
                {cur?.message && <div className="mt-2 rounded-md bg-indigo-50 p-2 text-sm text-indigo-900 dark:bg-indigo-950 dark:text-indigo-100">📣 {cur.message}</div>}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">The facilitator hasn't started the session clock yet.</div>
            )}
            <div className="mt-4 grid grid-cols-2 gap-1 text-xs text-muted-foreground sm:grid-cols-4">
              {p.agenda.map((a, i) => (
                <div key={i} className={`rounded border px-2 py-1 ${cur?.block === i ? 'border-primary bg-primary/5 text-foreground' : ''}`}>
                  <div className="tabular-nums">{a.start}</div>
                  <div className="truncate">{a.title}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{me.team ? me.team.name : 'Your team'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {!me.team ? (
              <Button asChild size="sm">
                <Link to="/setup">Pick your team</Link>
              </Button>
            ) : (
              <>
                {data?.team?.active && (
                  <div className="rounded-md bg-amber-50 p-2 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                    A {data.team.active.kind} run is in progress ({data.team.active.run_label}).
                  </div>
                )}
                {data?.team?.last_run ? (
                  <>
                    <div className="text-xs text-muted-foreground">
                      Last labelled run · {data.team.last_run.run_label} · {fmtTime(data.team.last_run.run_ts)}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <StatusChip status="PASS" /> {data.team.last_run.n_pass} <StatusChip status="FAIL" /> {data.team.last_run.n_fail} <StatusChip status="WARN" /> {data.team.last_run.n_warn}{' '}
                      <StatusChip status="INFO" /> {data.team.last_run.n_info} <StatusChip status="ERROR" /> {data.team.last_run.n_error}
                    </div>
                  </>
                ) : (
                  <div className="text-muted-foreground">No runs yet.</div>
                )}
                <div className="flex flex-wrap gap-1 pt-1">
                  {p.tasks.map((t) => (
                    <Badge key={t.id} variant={(data?.team?.tasks_done ?? []).includes(t.id) ? 'default' : 'outline'}>
                      {t.title.split(':')[0]}
                    </Badge>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">What today tests, and how we measure it</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {p.outcomes.map((o) => (
            <Card key={o.id}>
              <CardContent className="space-y-1 pt-4 text-sm">
                <div className="font-semibold">{o.challenge}</div>
                <div className="text-muted-foreground">{o.today}</div>
                <div className="rounded-md bg-muted px-2 py-1 text-xs">Live: {measureText(o.measure)}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
      {m && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Assets saved" value={m.assets_created} />
          <Kpi label="Tasks timed" value={m.time_per_step.reduce((s, t) => s + Number(t.teams), 0)} />
          <Kpi label="Blocker rows" value={m.blocker_map.length} />
          <Kpi label="Objects mapped" value={m.landing.reduce((s, r) => s + Number(r.n), 0)} />
        </div>
      )}
    </div>
  );
}
