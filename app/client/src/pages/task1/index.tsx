/** Task 1 · Trace: read the legacy code, agree what "correct" means, and record it. Done-when is evaluated from saved data. */
import { useEffect, useMemo, useRef } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@databricks/appkit-ui/react';
import { api, track } from '@/lib/api';
import { useSession, useTask } from '@/lib/me';
import { evaluate } from '@/lib/doneWhen';
import { EmptyState, ErrorState, Loading, Section, TaskHeader, notify } from '@/components/common';
import { useEntries } from '@/components/register/Register';
import { SsisViewer } from '@/components/flow/SsisViewer';
import { computeFacts, type Payload } from './facts';
import { CodeBrowser } from './CodeBrowser';
import { LineageTab } from './LineageTab';
import { RulesTab } from './RulesTab';
import { QuestionsTab } from './QuestionsTab';
import { PromptsTab } from './PromptsTab';
import { SharedPackageTab } from './SharedPackageTab';

export default function Page() {
  const me = useSession();
  const task = useTask('task1');
  const lineage = useEntries<Payload>('lineage_row');
  const rules = useEntries<Payload>('rule_decision');
  const questions = useEntries<Payload>('question_answer');
  const progress = useEntries<{ status?: string }>('task_progress');
  const tracked = useRef(false);

  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;
    track('task_view', 'task1');
  }, []);

  const contractKeys = useMemo(() => me.pack.rules_contract.map((r) => r.key), [me.pack.rules_contract]);
  const facts = useMemo(
    () => computeFacts(lineage.data ?? [], rules.data ?? [], questions.data ?? [], contractKeys),
    [lineage.data, rules.data, questions.data, contractKeys],
  );
  const checks = useMemo(() => Object.fromEntries((task?.done_when ?? []).map((d) => [d.id, evaluate(d.rule, facts)])), [task, facts]);
  const done = (progress.data ?? []).some((r) => r.entry_key === 'task1' && r.payload.status === 'done');

  if (!task) return <EmptyState title="Task 1 is not in this pack" />;

  const markDone = async () => {
    try {
      await api.post('/api/entries', { kind: 'task_progress', entry_key: 'task1', payload: { status: 'done' } });
      notify.ok('Task 1 marked done.');
      await progress.reload();
    } catch (e) {
      notify.error((e as Error).message);
    }
  };

  const loadError = lineage.error ?? rules.error ?? questions.error;
  const loadingFacts = (lineage.loading && !lineage.data) || (rules.loading && !rules.data) || (questions.loading && !questions.data);

  return (
    <div className="space-y-4">
      {loadingFacts ? (
        <Loading label="Loading your saved work" rows={4} />
      ) : (
        <TaskHeader task={task} checks={checks} onMarkDone={() => void markDone()} done={done} />
      )}
      {loadError && <ErrorState error={loadError} retry={() => void Promise.all([lineage.reload(), rules.reload(), questions.reload()])} />}

      <Tabs defaultValue="code">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="code">Code browser</TabsTrigger>
          <TabsTrigger value="ssis">SSIS viewer</TabsTrigger>
          <TabsTrigger value="lineage">Lineage worksheet</TabsTrigger>
          <TabsTrigger value="rules">Rules agreement</TabsTrigger>
          <TabsTrigger value="questions">Open questions</TabsTrigger>
          <TabsTrigger value="prompts">Ask Genie Code</TabsTrigger>
          <TabsTrigger value="shared">Shared package</TabsTrigger>
        </TabsList>

        <TabsContent value="code">
          <Section title="Legacy code" description="Read only. These are the files from the pack's legacy folder, shown as they were delivered.">
            <CodeBrowser />
          </Section>
        </TabsContent>

        <TabsContent value="ssis">
          <Section title="SSIS viewer" description="Drawn from the scanner's graph of each package. Control flow first; pick a Data Flow task for its data flow. Not an AI reading.">
            <SsisViewer />
          </Section>
        </TabsContent>

        <TabsContent value="lineage">
          <Section
            title="Lineage worksheet"
            description="One line per step of the flow. Cite the file, and tick Verified once you have checked the line against the code. Seeded rows are the as-built starting point; rows you save are team edits."
          >
            <LineageTab template={me.pack.lineage_template} onChanged={() => void lineage.reload()} />
          </Section>
        </TabsContent>

        <TabsContent value="rules">
          <Section title="Rules agreement" description="Agree each rule and record who signed it off. Every rule needs status agreed for Task 1 to tick.">
            <RulesTab contract={me.pack.rules_contract} onChanged={() => void rules.reload()} />
          </Section>
        </TabsContent>

        <TabsContent value="questions">
          <Section title="Open questions" description="Add what you need answered. A question counts as open while its status is open.">
            <QuestionsTab onChanged={() => void questions.reload()} />
          </Section>
        </TabsContent>

        <TabsContent value="prompts">
          <Section title="Ask Genie Code to trace the flow" description="Genie Code is the workspace's coding agent. It runs in the workspace, next to your team's copy of the legacy code. Check every answer against the file.">
            <PromptsTab prompts={me.pack.prompts} />
          </Section>
        </TabsContent>

        <TabsContent value="shared">
          <Section title="Shared package" description="What else this package loads, and what blocks retiring it.">
            <SharedPackageTab />
          </Section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
