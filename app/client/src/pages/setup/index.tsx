import { useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@databricks/appkit-ui/react';
import { CheckCircle2, RefreshCw, Repeat, XCircle } from 'lucide-react';
import { ErrorState, Loading, PageHeader, notify } from '@/components/common';
import { api, track } from '@/lib/api';
import { useMe, useSession } from '@/lib/me';
import { useApi } from '@/lib/poll';

const ROLES = [
  { id: 'driver', label: 'Driver (hands on keyboard)' },
  { id: 'navigator', label: 'Navigator (reads the code, checks answers)' },
  { id: 'business_owner', label: 'Business owner (agrees what "correct" means)' },
  { id: 'observer', label: 'Observer' },
];

type Probe = { ok: boolean; detail: string };
const PROBES: Record<string, string> = {
  read_team_data: 'Read your team data',
  write_team_files: 'Save to your team folder',
  genie_migrate_input: 'See your Genie Migrate input folder',
  skill_present: 'Framework skill available',
};

export default function SetupPage() {
  const me = useSession();
  const { refresh } = useMe();
  const [team, setTeam] = useState(me.team?.id ?? '');
  const [role, setRole] = useState(me.role ?? 'driver');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<Record<string, Probe> | null>(null);
  const [checking, setChecking] = useState(false);
  const roster = useApi<Array<{ email: string; role: string; display_name: string | null; since: string }>>(me.team ? '/api/roster' : null, [me.team?.id]);

  const join = async (teamId = team, r = role) => {
    setBusy(true);
    try {
      await api.post('/api/roster', { team_id: teamId, role: r, display_name: name || undefined });
      await refresh();
      await roster.reload();
      notify.ok('Saved. You are on ' + (me.teams.find((t) => t.id === teamId)?.name ?? teamId) + '.');
    } catch (e) {
      notify.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const swap = async () => {
    const next = role === 'driver' ? 'navigator' : 'driver';
    setRole(next);
    await join(me.team?.id ?? team, next);
    track('swap_drivers', null, { now: next });
  };
  const runChecks = async () => {
    setChecking(true);
    try {
      setChecks(await api.post<Record<string, Probe>>('/api/setup/check'));
    } catch (e) {
      notify.error((e as Error).message);
    } finally {
      setChecking(false);
    }
  };
  const failed = checks ? Object.values(checks).some((c) => !c.ok) : false;

  return (
    <div className="space-y-4">
      <PageHeader title="Setup: your team and access" kicker="Start here" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">1 · Your team and role</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              <Select value={team || undefined} onValueChange={setTeam}>
                <SelectTrigger aria-label="Team">
                  <SelectValue placeholder="Pick your team" />
                </SelectTrigger>
                <SelectContent>
                  {me.teams.filter((t) => t.id !== me.pack.demo_team.id || me.is_facilitator).map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger aria-label="Role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...ROLES, ...(me.is_facilitator ? [{ id: 'facilitator', label: 'Facilitator' }] : [])].map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input placeholder="Your first name (optional)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Your name" />
            <div className="flex gap-2">
              <Button disabled={!team || busy} onClick={() => void join()}>
                {me.team ? 'Update' : 'Join team'}
              </Button>
              {me.team && (
                <Button variant="outline" disabled={busy} onClick={() => void swap()}>
                  <Repeat className="mr-1 h-4 w-4" /> Swap drivers
                </Button>
              )}
            </div>
            {me.team && (
              <div className="rounded-md bg-muted p-2 text-xs">
                Notebook fallback: if a page fails, open your team notebook with schema prefix <code className="font-semibold">{me.team.prefix}</code>. It uses the same files and results as this app.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">2 · Access check</CardTitle>
            <Button size="sm" disabled={!me.team || checking} onClick={() => void runChecks()}>
              <RefreshCw className={`mr-1 h-4 w-4 ${checking ? 'animate-spin' : ''}`} /> {checks ? 'Run again' : 'Run access check'}
            </Button>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {!me.team && <div className="text-muted-foreground">Join a team first.</div>}
            {checking && <Loading rows={4} />}
            {checks &&
              !checking &&
              Object.entries(PROBES).map(([k, label]) => {
                const c = checks[k];
                return (
                  <div key={k} className="flex items-start gap-2">
                    {c?.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />}
                    <div>
                      <div className="font-medium">{label}</div>
                      <div className="text-xs text-muted-foreground">{c?.detail}</div>
                    </div>
                  </div>
                );
              })}
            {failed && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                Something isn't reachable yet. Tell the facilitator, and carry on with the parts that work. Every task has a fallback (prepared example, notebook).
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {me.team && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Who's on {me.team.name}</CardTitle>
          </CardHeader>
          <CardContent>
            {roster.loading && !roster.data ? (
              <Loading />
            ) : roster.error ? (
              <ErrorState error={roster.error} retry={roster.reload} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Since</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(roster.data ?? []).map((r) => (
                    <TableRow key={r.email}>
                      <TableCell>{r.display_name || r.email}</TableCell>
                      <TableCell>{r.role?.replace('_', ' ')}</TableCell>
                      <TableCell className="text-muted-foreground">{r.since?.slice(11, 16)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
