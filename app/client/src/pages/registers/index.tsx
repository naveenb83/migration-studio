import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from '@databricks/appkit-ui/react';
import { Download } from 'lucide-react';
import { PageHeader, Section } from '@/components/common';
import { Register, useEntries } from '@/components/register/Register';
import { useSession } from '@/lib/me';

function downloadCsv(name: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = name;
  a.click();
}

export default function RegistersPage() {
  const me = useSession();
  const qa = useEntries<Record<string, unknown>>('question_answer');
  const fd = useEntries<Record<string, unknown>>('finding_decision');
  const questions = me.pack.questions ?? [];
  const findings = me.pack.findings ?? [];
  return (
    <div className="space-y-4">
      <PageHeader title="Questions and findings" kicker="What we need your help with, and what we noticed" />
      <Tabs defaultValue="questions">
        <TabsList>
          <TabsTrigger value="questions">Questions ({questions.length})</TabsTrigger>
          <TabsTrigger value="findings">Findings ({findings.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="questions">
          <Section
            title="Questions we need your help with"
            description="Answer what you can now; mark the rest open with an owner. Your partner sees edits within seconds."
            actions={
              <Button size="sm" variant="outline" onClick={() => downloadCsv('questions.csv', questions.map((q) => ({ ...q, ...(qa.data?.find((e) => e.entry_key === q.id)?.payload ?? {}) })))}>
                <Download className="mr-1 h-4 w-4" /> CSV
              </Button>
            }
          >
            <Register
              kind="question_answer"
              allowAdd
              allowDelete={false}
              seed={questions.map((q) => ({ key: q.id, payload: {}, locked: { question: q.question, group: q.group ?? '', why: q.why ?? '' } }))}
              columns={[
                { key: 'group', label: 'Area', type: 'text', readOnly: true, width: '9rem' },
                { key: 'question', label: 'Question', type: 'text', readOnly: true },
                { key: 'status', label: 'Status', type: 'select', options: ['open', 'answered', 'parked'], width: '8rem' },
                { key: 'answer', label: 'Answer / notes', type: 'longtext' },
                { key: 'owner', label: 'Owner', type: 'text', width: '9rem' },
              ]}
              newKey={() => `team_q_${Date.now().toString(36)}`}
            />
          </Section>
        </TabsContent>
        <TabsContent value="findings">
          <Section
            title="What we noticed in the sample code"
            description="Decide what to do with each finding, who owns it and by when."
            actions={
              <Button size="sm" variant="outline" onClick={() => downloadCsv('findings.csv', findings.map((f) => ({ ...f, ...(fd.data?.find((e) => e.entry_key === f.id)?.payload ?? {}) })))}>
                <Download className="mr-1 h-4 w-4" /> CSV
              </Button>
            }
          >
            <Register
              kind="finding_decision"
              allowAdd
              allowDelete={false}
              seed={findings.map((f) => ({ key: f.id, payload: { decision: f.decision ?? '' }, locked: { noticed: f.noticed, why: f.why ?? '' } }))}
              columns={[
                { key: 'noticed', label: 'Noticed', type: 'text', readOnly: true },
                { key: 'why', label: 'Why it matters', type: 'text', readOnly: true },
                { key: 'decision', label: 'Decision', type: 'longtext' },
                { key: 'owner', label: 'Owner', type: 'text', width: '9rem' },
                { key: 'due', label: 'Due', type: 'text', width: '7rem', placeholder: 'e.g. 15 Dec' },
              ]}
              newKey={() => `team_f_${Date.now().toString(36)}`}
            />
          </Section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
