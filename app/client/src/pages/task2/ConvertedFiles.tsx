/** Review & save: the converted SQL in drafts. What each file creates and writes, whether it runs, and edits (kept labelled). */
import { useState } from 'react';
import { Badge, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Switch } from '@databricks/appkit-ui/react';
import { FileCode2, Pencil } from 'lucide-react';
import { EmptyState, ErrorState, Loading, ProvenanceChip, Section, notify } from '@/components/common';
import { CodeView } from '@/components/common/CodeView';
import { api } from '@/lib/api';
import type { ConvertedFile } from '@/lib/conversion';
import { useApi } from '@/lib/poll';

export function ConvertedFiles({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const files = useApi<ConvertedFile[]>('/api/converted', [refreshKey]);
  const [open, setOpen] = useState<{ name: string; content: string; original: string; source: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = async (f: ConvertedFile, include: boolean) => {
    try {
      await api.put(`/api/converted/${encodeURIComponent(f.name)}`, { include });
      await files.reload();
      onChanged();
    } catch (e) {
      notify.error((e as Error).message);
    }
  };
  const edit = async (f: ConvertedFile) => {
    try {
      const r = await api.get<{ content: string }>(`/api/converted/${encodeURIComponent(f.name)}`);
      setOpen({ name: f.name, content: r.content, original: r.content, source: f.source });
    } catch (e) {
      notify.error((e as Error).message);
    }
  };
  const save = async () => {
    if (!open) return;
    setBusy(true);
    try {
      await api.put(`/api/converted/${encodeURIComponent(open.name)}`, { content: open.content });
      notify.ok(`Saved ${open.name}. It's now labelled "team edit"; where it came from is kept.`);
      setOpen(null);
      await files.reload();
      onChanged();
    } catch (e) {
      notify.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const list = files.data ?? [];
  const running = list.filter((f) => f.include);
  return (
    <Section
      title="Review the converted SQL"
      description="These are the files you imported. Read what each one creates and writes. Tick Run for the files that Run my files should run. An edit is saved as a team edit and keeps where the file came from."
    >
      {files.error ? (
        <ErrorState error={files.error} retry={() => void files.reload()} />
      ) : !files.data ? (
        <Loading rows={3} />
      ) : list.length === 0 ? (
        <EmptyState title="No converted files yet">Go to Convert and press Import all after Genie Migrate has converted your files.</EmptyState>
      ) : (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            {running.length} of {list.length} file(s) will run. The app checks every statement before it runs: only views, tables, inserts, merges, updates and deletes run, and only inside your team&rsquo;s sandbox.
          </div>
          <div className="divide-y rounded-md border">
            {list.map((f) => (
              <div key={f.name} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <FileCode2 className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{f.name}</span>
                    <ProvenanceChip source={f.source} />
                    {f.summary.commentOnly && <Badge variant="outline">nothing to run: comments only</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {f.summary.statements} statement(s)
                    {f.summary.creates.length > 0 && <> · creates {f.summary.creates.join(', ')}</>}
                    {f.summary.writes.length > 0 && <> · writes {f.summary.writes.join(', ')}</>}
                  </div>
                  {f.summary.warnings.map((w) => (
                    <div key={w} className="text-xs text-amber-800">{w}</div>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs">
                    <Switch checked={f.include} onCheckedChange={(v) => void toggle(f, Boolean(v))} aria-label={`Run ${f.name}`} /> Run
                  </label>
                  <Button size="sm" variant="outline" onClick={() => void edit(f)}>
                    <Pencil className="mr-1 h-3.5 w-3.5" /> Review / edit
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <Dialog open={Boolean(open)} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{open?.name}</DialogTitle>
          </DialogHeader>
          {open && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                Provenance: <ProvenanceChip source={open.source} />. Edit only if you must; Validate compares exactly what runs.
              </div>
              <CodeView value={open.content} name={open.name} height="460px" onChange={(v) => setOpen({ ...open, content: v })} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)}>
              Close
            </Button>
            <Button disabled={busy || !open || open.content === open.original} onClick={() => void save()}>
              Save edit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
