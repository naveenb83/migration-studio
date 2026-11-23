import { useState } from 'react';
import { BarChart, Button, Card, CardContent, CardHeader, CardTitle } from '@databricks/appkit-ui/react';
import { Download, FileText } from 'lucide-react';
import { ErrorState, Loading, PageHeader, Section, notify } from '@/components/common';
import { CodeView } from '@/components/common/CodeView';
import { Register } from '@/components/register/Register';
import { api, track } from '@/lib/api';
import { useSession } from '@/lib/me';
import { useApi } from '@/lib/poll';

function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
}

export default function ClosePage() {
  const me = useSession();
  const home = useApi<{ measures: { time_per_step: Array<{ task_id: string; median_minutes: number; teams: number }> } }>('/api/home');
  const [exp, setExp] = useState<{ markdown: string; csv: string; saved: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const pilot = me.pack.pilot ?? {};
  const doExport = async () => {
    setBusy(true);
    try {
      const r = await api.get<{ markdown: string; csv: string; saved: string | null }>('/api/export');
      setExp(r);
      track('export_view', 'close');
      notify.ok(r.saved ? 'Evidence pack built and a copy saved for the facilitator.' : 'Evidence pack built.');
    } catch (e) {
      notify.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const tps = (home.data?.measures.time_per_step ?? []).map((t) => {
    const planned = me.pack.tasks.find((x) => x.id === t.task_id)?.minutes ?? null;
    return { task: t.task_id, 'median minutes (all teams)': Number(t.median_minutes), 'planned minutes': planned ?? 0 };
  });
  return (
    <div className="space-y-4">
      <PageHeader title="From workshop to pilot" kicker="Close-out" />
      <Section title="Five questions before you leave" description="One answer and one owner each. These go into your evidence pack.">
        <Register
          kind="closeout_answer"
          allowAdd={false}
          allowDelete={false}
          seed={me.pack.closeout_questions.map((q, i) => ({ key: `c${i + 1}`, payload: {}, locked: { question: q } }))}
          columns={[
            { key: 'question', label: 'Question', type: 'text', readOnly: true },
            { key: 'answer', label: 'Answer', type: 'longtext' },
            { key: 'owner', label: 'Owner', type: 'text', width: '10rem' },
          ]}
        />
      </Section>
      <div className="grid gap-4 lg:grid-cols-3">
        {Object.entries(pilot).map(([k, items]) => (
          <Card key={k}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base capitalize">{k.replace(/_/g, ' ')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {items.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
      <Section title="Pilot planner" description="Who, what, by when. Add a row per commitment.">
        <Register
          kind="pilot_plan"
          columns={[
            { key: 'item', label: 'What', type: 'text' },
            { key: 'owner', label: 'Owner', type: 'text', width: '10rem' },
            { key: 'when', label: 'By when', type: 'text', width: '8rem' },
            { key: 'notes', label: 'Notes', type: 'longtext' },
          ]}
          newKey={() => `p_${Date.now().toString(36)}`}
          emptyText="No pilot commitments yet."
        />
      </Section>
      <Section title="Where the time went" description="Median minutes per task across teams (from the moment a team first opened the task to Mark done), against the planned time.">
        {home.loading && !home.data ? <Loading rows={2} /> : home.error ? <ErrorState error={home.error} /> : tps.length ? <BarChart data={tps} xKey="task" yKey={['median minutes (all teams)', 'planned minutes']} height={240} /> : <div className="text-sm text-muted-foreground">Times appear as teams mark tasks done.</div>}
      </Section>
      <Section
        title="Your evidence pack"
        description="Lineage, agreed rules, the files that ran (with SHA-256), every labelled run with its counts, classifications, Prove runs and open questions."
        actions={
          <Button size="sm" disabled={busy} onClick={() => void doExport()}>
            <FileText className="mr-1 h-4 w-4" /> Build evidence pack
          </Button>
        }
      >
        {exp ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => download(`evidence_${me.team?.id ?? 'team'}.md`, exp.markdown, 'text/markdown')}>
                <Download className="mr-1 h-4 w-4" /> Markdown
              </Button>
              <Button size="sm" variant="outline" onClick={() => download(`runs_${me.team?.id ?? 'team'}.csv`, exp.csv, 'text/csv')}>
                <Download className="mr-1 h-4 w-4" /> Runs CSV
              </Button>
            </div>
            <CodeView value={exp.markdown} name="evidence.md" height="420px" />
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Build it at the end of the session; you can rebuild it any time.</div>
        )}
      </Section>
    </div>
  );
}
