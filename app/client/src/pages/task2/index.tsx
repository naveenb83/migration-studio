import { useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@databricks/appkit-ui/react';
import { TaskHeader, notify } from '@/components/common';
import { useEntries } from '@/components/register/Register';
import { api, track } from '@/lib/api';
import { evaluate } from '@/lib/doneWhen';
import { useSession, useTask } from '@/lib/me';
import { useApi } from '@/lib/poll';
import type { RunRow } from '@/lib/types';
import { AiDraft } from './AiDraft';
import { HandOff } from './HandOff';
import { RunPanel } from './RunPanel';
import { TeamFiles } from './TeamFiles';

export default function Task2Page() {
  const me = useSession();
  const task = useTask('task2');
  const [refreshKey, setRefreshKey] = useState(0);
  const runs = useApi<RunRow[]>('/api/runs', [refreshKey]);
  const progress = useEntries<{ status?: string }>('task_progress');
  useEffect(() => track('task_view', 'task2'), []);
  if (!task) return null;
  const rechecks = (runs.data ?? []).filter((r) => r.kind === 'recheck').length;
  const facts = { runs: { recheck: rechecks, fault_failed: 0, repair_passed: 0 }, teamwork: { saved: rechecks } };
  const checks = Object.fromEntries((task.done_when ?? []).map((d) => [d.id, evaluate(d.rule, facts)]));
  const done = (progress.data ?? []).some((p) => p.entry_key === 'task2' && p.payload.status === 'done');
  const markDone = async () => {
    await api.post('/api/entries', { kind: 'task_progress', entry_key: 'task2', payload: { status: 'done' } });
    await progress.reload();
    notify.ok('Task 2 marked done.');
  };
  const bump = () => setRefreshKey((k) => k + 1);
  return (
    <div className="space-y-4">
      <TaskHeader task={task} checks={checks} onMarkDone={() => void markDone()} done={done} />
      <Tabs defaultValue="convert">
        <TabsList>
          <TabsTrigger value="convert">Convert</TabsTrigger>
          <TabsTrigger value="files">Review & save</TabsTrigger>
          <TabsTrigger value="run">Run my files</TabsTrigger>
        </TabsList>
        <TabsContent value="convert" className="space-y-4">
          <HandOff onImported={bump} />
          {(me.features.draft ?? true) && me.draft_enabled && <AiDraft onSaved={bump} />}
        </TabsContent>
        <TabsContent value="files">
          <TeamFiles refreshKey={refreshKey} />
        </TabsContent>
        <TabsContent value="run">
          <RunPanel onFinished={() => void runs.reload()} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
