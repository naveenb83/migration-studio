import { useState } from 'react';
import { Badge, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@databricks/appkit-ui/react';
import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { ErrorState, Loading, PageHeader, Section, StatusChip, fmtTime, notify } from '@/components/common';
import { api } from '@/lib/api';
import { useSession } from '@/lib/me';
import { useApi, useInterval } from '@/lib/poll';

interface BoardRow {
  team_id: string;
  name: string;
  prefix: string;
  last_run: { run_label: string; n_pass: number; n_fail: number; n_warn: number; n_info: number; n_error: number; n_blocking: number; run_ts: string } | null;
  activity: { last_activity: string; last_event: string; last_task: string | null } | null;
  tasks_done: string[];
  last_request: { run_label: string; kind: string; job_run_id: number; ts: string; life: string | null; result: string | null } | null;
}

export default function FacilitatorPage() {
  const me = useSession();
  const board = useApi<BoardRow[]>('/api/fac/board');
  const health = useApi<Array<{ name: string; ok: boolean; detail: string; ms: number }>>('/api/fac/health');
  const agenda = useApi<Array<{ entry_key: string; payload: string }>>('/api/entries?kind=agenda');
  useInterval(() => void board.reload(), 15_000);
  const cur = (() => {
    try {
      return JSON.parse(agenda.data?.find((a) => a.entry_key === 'current')?.payload ?? '{}') as { block?: number; message?: string };
    } catch {
      return {};
    }
  })();
  const [block, setBlock] = useState<string>('');
  const [message, setMessage] = useState('');
  const setAgenda = async () => {
    const i = Number(block === '' ? cur.block ?? 0 : block);
    try {
      await api.post('/api/entries', { kind: 'agenda', entry_key: 'current', payload: { block: i, title: me.pack.agenda[i]?.title ?? '', message: message || null, started_at: new Date().toISOString() } });
      await agenda.reload();
      notify.ok('Agenda updated for every team.');
    } catch (e) {
      notify.error((e as Error).message);
    }
  };
  const reloadPack = async () => {
    try {
      await api.post('/api/fac/reload-pack');
      notify.ok('Pack reloaded. Ask teams to refresh their browser.');
    } catch (e) {
      notify.error((e as Error).message);
    }
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Facilitator board" kicker="Read-only view of every team">
        <Button size="sm" variant="outline" onClick={() => void board.reload()}>
          <RefreshCw className="mr-1 h-4 w-4" /> Refresh
        </Button>
      </PageHeader>
      <Section title="Teams">
        {board.loading && !board.data ? (
          <Loading rows={4} />
        ) : board.error ? (
          <ErrorState error={board.error} retry={board.reload} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  <TableHead>Last activity</TableHead>
                  <TableHead>Tasks done</TableHead>
                  <TableHead>Last run (counts)</TableHead>
                  <TableHead>Latest trigger</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(board.data ?? []).map((t) => (
                  <TableRow key={t.team_id}>
                    <TableCell>
                      <div className="font-medium">{t.name}</div>
                      <div className="text-xs text-muted-foreground">{t.prefix}</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {t.activity ? (
                        <>
                          {fmtTime(t.activity.last_activity)}
                          <div className="text-xs text-muted-foreground">
                            {t.activity.last_event}
                            {t.activity.last_task ? ` · ${t.activity.last_task}` : ''}
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">none yet</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {me.pack.tasks.map((x) => (
                          <Badge key={x.id} variant={t.tasks_done.includes(x.id) ? 'default' : 'outline'}>
                            {x.id.replace('task', 'T')}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {t.last_run ? (
                        <>
                          <div className="flex flex-wrap items-center gap-1">
                            <StatusChip status="PASS" />
                            {t.last_run.n_pass} <StatusChip status="FAIL" />
                            {t.last_run.n_fail} <StatusChip status="WARN" />
                            {t.last_run.n_warn} <StatusChip status="INFO" />
                            {t.last_run.n_info}
                          </div>
                          <div className="max-w-64 truncate text-xs text-muted-foreground" title={t.last_run.run_label}>
                            {t.last_run.run_label} · {fmtTime(t.last_run.run_ts)}
                          </div>
                        </>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {t.last_request ? (
                        <>
                          <Badge variant={t.last_request.result === 'FAILED' ? 'destructive' : 'secondary'}>
                            {t.last_request.kind} · {t.last_request.result || t.last_request.life}
                          </Badge>
                          <div className="text-xs text-muted-foreground">{fmtTime(t.last_request.ts)}</div>
                        </>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Session clock and broadcast" description="Sets the current block and an optional message on every team's Home page.">
          <div className="space-y-2">
            <Select value={block || (cur.block !== undefined ? String(cur.block) : undefined)} onValueChange={setBlock}>
              <SelectTrigger aria-label="Agenda block">
                <SelectValue placeholder="Pick the current block" />
              </SelectTrigger>
              <SelectContent>
                {me.pack.agenda.map((a, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {a.start}–{a.end} · {a.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input placeholder="Broadcast message (optional)" value={message} onChange={(e) => setMessage(e.target.value)} aria-label="Broadcast message" />
            <Button size="sm" onClick={() => void setAgenda()}>
              Start this block now
            </Button>
          </div>
        </Section>
        <Section title="Health" actions={<Button size="sm" variant="outline" onClick={() => void health.reload()}>Check again</Button>}>
          {health.loading && !health.data ? (
            <Loading rows={4} />
          ) : health.error ? (
            <ErrorState error={health.error} retry={health.reload} />
          ) : (
            <div className="space-y-1 text-sm">
              {(health.data ?? []).map((h) => (
                <div key={h.name} className="flex items-start gap-2">
                  {h.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />}
                  <div className="min-w-0">
                    <span className="font-medium">{h.name}</span> <span className="text-xs text-muted-foreground">({h.ms} ms)</span>
                    <div className="truncate text-xs text-muted-foreground" title={h.detail}>
                      {h.detail}
                    </div>
                  </div>
                </div>
              ))}
              <Button size="sm" variant="outline" className="mt-2" onClick={() => void reloadPack()}>
                Reload pack
              </Button>
            </div>
          )}
        </Section>
      </div>
      <Section title="Provisioning, reset and the answer key" description="CLI only today (no buttons, by design).">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Provision or rebuild a team: run the team notebook in build mode for that prefix (see the private run sheet).</li>
          <li>The answer key runs on the demo team only, from the facilitator notebook. Never on attendee prefixes.</li>
          <li>The demo team ({me.pack.demo_team.prefix}) is yours to show the fixed version live.</li>
        </ul>
      </Section>
    </div>
  );
}
