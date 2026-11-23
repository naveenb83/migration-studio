import { useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@databricks/appkit-ui/react';
import { TaskHeader, notify } from '@/components/common';
import { useEntries } from '@/components/register/Register';
import { api, track } from '@/lib/api';
import type { ConvertedFile } from '@/lib/conversion';
import { evaluate } from '@/lib/doneWhen';
import { useSession, useTask } from '@/lib/me';
import { useApi } from '@/lib/poll';
import type { RunRow } from '@/lib/types';
import { AiDraft } from './AiDraft';
import { ConvertedFiles } from './ConvertedFiles';
import { ConvertRun } from './ConvertRun';
import { GenieCode } from './GenieCode';
import { HandOff } from './HandOff';

export default function Task2Page() {
  const me = useSession();
  const task = useTask('task2');
  const [refreshKey, setRefreshKey] = useState(0);
  const [tab, setTab] = useState('convert');
  const runs = useApi<RunRow[]>('/api/runs', [refreshKey]);
  const files = useApi<ConvertedFile[]>('/api/converted', [refreshKey]);
  const progress = useEntries<{ status?: string }>('task_progress');
  useEffect(() => track('task_view', 'task2'), []);
  if (!task) return null;
  const converts = (runs.data ?? []).filter((r) => r.kind === 'convert').length;
  const imported = (files.data ?? []).filter((f) => f.source === 'genie_migrate' || f.from).length;
  const facts = { converted: { imported }, convert: { runs: converts, compared_all: null } };
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
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="convert">Convert</TabsTrigger>
          <TabsTrigger value="files">Review &amp; save</TabsTrigger>
          <TabsTrigger value="run">Run my files</TabsTrigger>
          <TabsTrigger value="geniecode">Genie Code</TabsTrigger>
        </TabsList>
        <TabsContent value="convert" className="space-y-4">
          <HandOff onImported={bump} onReview={() => setTab('files')} />
          {(me.features.draft ?? true) && me.draft_enabled && <AiDraft onSaved={bump} />}
        </TabsContent>
        <TabsContent value="files">
          <ConvertedFiles refreshKey={refreshKey} onChanged={bump} />
        </TabsContent>
        <TabsContent value="run">
          <ConvertRun onFinished={() => void runs.reload()} />
        </TabsContent>
        <TabsContent value="geniecode">
          <GenieCode onSaved={bump} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
