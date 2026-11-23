/** Genie Migrate hand-off (the app never runs Genie Migrate: it prepares inputs and imports outputs) + paste-in + prepared examples. */
import { useState } from 'react';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Textarea } from '@databricks/appkit-ui/react';
import { Download, ExternalLink, RefreshCw } from 'lucide-react';
import { CopyButton, EmptyState, ErrorState, Loading, Section, notify } from '@/components/common';
import { api } from '@/lib/api';
import { useApi } from '@/lib/poll';

interface GM {
  url: string | null;
  steps: string[];
  ssis_preview: boolean;
  input_folder: string;
  output_folder: string;
  input: Array<{ path: string; name: string; type: string }>;
  output: Array<{ path: string; name: string; type: string }>;
  output_error: string | null;
}

export function HandOff({ onImported }: { onImported: () => void }) {
  const gm = useApi<GM>('/api/genie-migrate');
  const prepared = useApi<Array<{ path: string; size: number }>>('/api/pack/tree?dir=prepared_examples');
  const [paste, setPaste] = useState(false);
  const [name, setName] = useState('converted_view.sql');
  const [sql, setSql] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const importFile = async (path: string) => {
    setBusy(path);
    try {
      const r = await api.post<{ name: string }>('/api/genie-migrate/import', { path });
      notify.ok(`Imported ${r.name} into your drafts (provenance: Genie Migrate).`);
      onImported();
    } catch (e) {
      notify.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const savePaste = async () => {
    setBusy('paste');
    try {
      await api.post('/api/genie-migrate/import', { name, pasted_sql: sql });
      notify.ok(`Saved ${name} into your drafts (provenance: pasted).`);
      setPaste(false);
      setSql('');
      onImported();
    } catch (e) {
      notify.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const usePrepared = async (path: string) => {
    setBusy(path);
    try {
      const r = await api.post<{ name: string }>('/api/prepared', { name: path.split('/').pop() });
      notify.ok(`Copied ${r.name} into your drafts. It is a prepared example, not a live conversion.`);
      onImported();
    } catch (e) {
      notify.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (gm.loading && !gm.data) return <Loading />;
  if (gm.error) return <ErrorState error={gm.error} retry={gm.reload} fallback="Use the paste-in or the prepared example below." />;
  const g = gm.data as GM;
  return (
    <div className="space-y-4">
      <Section
        title="Convert with Genie Migrate"
        description="Genie Migrate runs in the workspace (it has no API). Your team's input files are already in the input folder; save its output to your output folder, then import it here."
        actions={
          g.url && (
            <Button asChild size="sm">
              <a href={g.url} target="_blank" rel="noreferrer">
                Open the workspace <ExternalLink className="ml-1 h-3.5 w-3.5" />
              </a>
            </Button>
          )
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {g.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
            {!g.ssis_preview && <li className="text-muted-foreground">SSIS package conversion is a preview feature that isn't enabled here: convert the SQL objects, and read the package in Task 1.</li>}
          </ol>
          <div className="space-y-2 text-xs">
            <div>
              <div className="font-medium">Input folder ({g.input.length} files)</div>
              <div className="flex items-center gap-2">
                <code className="break-all">{g.input_folder}</code> <CopyButton text={g.input_folder} />
              </div>
            </div>
            <div>
              <div className="font-medium">Output folder</div>
              <div className="flex items-center gap-2">
                <code className="break-all">{g.output_folder}</code> <CopyButton text={g.output_folder} />
              </div>
            </div>
          </div>
        </div>
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-medium">Converted files in your output folder</div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void gm.reload()}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPaste(true)}>
                Paste in a conversion
              </Button>
            </div>
          </div>
          {g.output_error && <div className="text-xs text-red-700">Could not list the output folder: {g.output_error}</div>}
          {g.output.length === 0 ? (
            <EmptyState title="Nothing in your output folder yet">Run Genie Migrate, save to the output folder, then refresh. Or paste the converted SQL.</EmptyState>
          ) : (
            <div className="divide-y rounded-md border">
              {g.output.map((f) => (
                <div key={f.path} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="truncate" title={f.path}>
                    {f.path.slice(g.output_folder.length + 1)}
                  </span>
                  <Button size="sm" variant="secondary" disabled={busy === f.path} onClick={() => void importFile(f.path)}>
                    <Download className="mr-1 h-3.5 w-3.5" /> Import to drafts
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>

      <Section title="No conversion access? Use a prepared example" description="Prepared ahead of the session with AI assistance and labelled as such. It is not a live conversion and not reviewed: check it against the code.">
        {prepared.loading && !prepared.data ? (
          <Loading rows={2} />
        ) : (prepared.data ?? []).length === 0 ? (
          <EmptyState title="No prepared examples in this pack" />
        ) : (
          <div className="flex flex-wrap gap-2">
            {(prepared.data ?? []).map((f) => (
              <Button key={f.path} size="sm" variant="outline" disabled={busy === f.path} onClick={() => void usePrepared(f.path)}>
                Use {f.path.split('/').pop()}
              </Button>
            ))}
          </div>
        )}
      </Section>

      <Dialog open={paste} onOpenChange={setPaste}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Paste a converted file</DialogTitle>
          </DialogHeader>
          <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Draft file name" />
          <Textarea className="min-h-72 font-mono text-xs" value={sql} onChange={(e) => setSql(e.target.value)} placeholder="Paste the converted SQL or YAML here" aria-label="Pasted content" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaste(false)}>
              Cancel
            </Button>
            <Button disabled={!sql.trim() || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || busy === 'paste'} onClick={() => void savePaste()}>
              Save to drafts
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
