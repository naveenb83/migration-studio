/** Two lanes (legacy and new) from pack.dataset.lanes. Nodes with a code path open the file read-only. */
import { useState } from 'react';
import { ArrowRight, Code2 } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@databricks/appkit-ui/react';
import { CodeView } from '@/components/common/CodeView';
import { ErrorState, Loading } from '@/components/common';
import { useApi } from '@/lib/poll';
import type { PublicPack } from '@/lib/types';

type Lanes = NonNullable<PublicPack['dataset']['lanes']>;
type LaneNode = Lanes[string][number];

const LANE_TITLE: Record<string, string> = { legacy: 'Today: legacy', new: 'Target: Databricks' };

export function LaneFlow({ lanes, grainLegacy, grainNew }: { lanes: Lanes; grainLegacy?: string; grainNew?: string }) {
  const [openPath, setOpenPath] = useState<string | null>(null);
  const grains: Record<string, string | undefined> = { legacy: grainLegacy, new: grainNew };
  return (
    <div className="space-y-4">
      {Object.entries(lanes).map(([laneKey, nodes]) => (
        <div key={laneKey} className="rounded-lg border p-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-sm font-semibold">{LANE_TITLE[laneKey] ?? laneKey}</div>
            {grains[laneKey] && <div className="text-xs text-muted-foreground">Grain: {grains[laneKey]}</div>}
          </div>
          <div className="flex flex-wrap items-stretch gap-2">
            {nodes.map((n, i) => (
              <div key={n.id} className="flex items-center gap-2">
                <LaneCard node={n} onOpen={setOpenPath} />
                {i < nodes.length - 1 && <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
              </div>
            ))}
          </div>
        </div>
      ))}
      <Dialog open={openPath !== null} onOpenChange={(v) => !v && setOpenPath(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="break-all font-mono text-sm">{openPath}</DialogTitle>
            <DialogDescription>Read only. Shown as delivered in the pack.</DialogDescription>
          </DialogHeader>
          {openPath && <LaneCode path={openPath} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LaneCard({ node, onOpen }: { node: LaneNode; onOpen: (p: string) => void }) {
  return (
    <div className="flex min-w-44 max-w-64 flex-col gap-1 rounded-md border bg-white p-2.5 shadow-sm dark:bg-slate-900">
      <div className="text-sm font-medium">{node.label}</div>
      {node.table && <div className="break-all font-mono text-[11px] text-muted-foreground">{node.table}</div>}
      {node.code_path && (
        <Button size="sm" variant="outline" className="mt-auto h-7 justify-start" onClick={() => onOpen(node.code_path ?? '')}>
          <Code2 className="mr-1 h-3.5 w-3.5" /> Open code
        </Button>
      )}
    </div>
  );
}

function LaneCode({ path }: { path: string }) {
  const file = useApi<{ path: string; content: string; truncated: boolean }>(`/api/pack/file?path=${encodeURIComponent(path)}`, [path]);
  if (file.loading && !file.data) return <Loading label="Opening file" rows={6} />;
  if (file.error) return <ErrorState error={file.error} retry={() => void file.reload()} />;
  if (!file.data) return null;
  return <CodeView value={file.data.content} name={path} height="60vh" />;
}
