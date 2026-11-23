/** Optional (facilitator) fallback: the framework track's 8 team files and the framework recheck, as before. */
import { useState } from 'react';
import { PageHeader } from '@/components/common';
import { RunPanel } from '../task2/RunPanel';
import { TeamFiles } from '../task2/TeamFiles';

export default function FrameworkPage() {
  const [k, setK] = useState(0);
  return (
    <div className="space-y-4">
      <PageHeader title="Framework files & recheck (optional)" kicker="Fallback track" />
      <p className="text-sm text-muted-foreground">
        The earlier track: the team&rsquo;s 8 framework files (stage view, EDH/CIF configuration, workflow) and the 34-check framework recheck. The workshop flow runs the converted SQL instead (Task 2).
      </p>
      <TeamFiles refreshKey={k} />
      <RunPanel onFinished={() => setK((x) => x + 1)} />
    </div>
  );
}
