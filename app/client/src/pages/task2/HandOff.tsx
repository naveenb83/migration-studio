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
  input_url?: string | null;
  output_url?: string | null;
  input: Array<{ path: string; name: string; type: string }>;
  output: Array<{ path: string; name: string; type: string; label?: string; from?: string; part?: number; parts?: number; chars?: number }>;
  output_error: string | null;
  ssis?: Array<{ file: string; parts: number; converted: number }>;
}

export function HandOff({ onImported, onReview }: { onImported: () => void; onReview?: () => void }) {
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
  const importAll = async () => {
    setBusy('all');
    try {
      const r = await api.post<{ imported: Array<{ name: string }>; failed: Array<{ path: string; error: string }> }>('/api/genie-migrate/import-all');
      if (r.failed.length) notify.error(`Imported ${r.imported.length}; ${r.failed.length} failed: ${r.failed.map((f) => f.error).join('; ')}`);
      else notify.ok(`Imported ${r.imported.length} converted file(s) into your drafts (provenance: Genie Migrate). Review them next.`);
      onImported();
      if (!r.failed.length && r.imported.length) onReview?.();
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
  const copyPrepared = async (path: string) => {
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
  if (gm.error) return <ErrorState error={gm.error} retry={() => void gm.reload()} fallback="Use the paste-in or the prepared example below." />;
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
            {!g.ssis_preview && <li className="text-muted-foreground">SSIS package conversion is a preview feature that isn&rsquo;t enabled here: convert the SQL objects, and read the package in Task 1.</li>}
          </ol>
          <div className="space-y-2 text-xs">
            <div>
              <div className="font-medium">Input folder ({g.input.length} files)</div>
              <div className="flex items-center gap-2">
                <code className="break-all">{g.input_folder}</code> <CopyButton text={g.input_folder} />
                {g.input_url && (
                  <a className="whitespace-nowrap underline" href={g.input_url} target="_blank" rel="noreferrer">
                    Open
                  </a>
                )}
              </div>
            </div>
            <div>
              <div className="font-medium">Output folder</div>
              <div className="flex items-center gap-2">
                <code className="break-all">{g.output_folder}</code> <CopyButton text={g.output_folder} />
                {g.output_url && (
                  <a className="whitespace-nowrap underline" href={g.output_url} target="_blank" rel="noreferrer">
                    Open
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-medium">Converted files in your output folder</div>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy === 'all' || g.output.length === 0} onClick={() => void importAll()}>
                <Download className="mr-1 h-3.5 w-3.5" /> Import all ({g.output.length})
              </Button>
              <Button size="sm" variant="outline" onClick={() => void gm.reload()}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPaste(true)}>
                Paste in a conversion
              </Button>
            </div>
          </div>
          <div className="mb-2 text-xs text-muted-foreground">
            Genie Migrate saves each converted file as a SQL query (in the workspace it shows as Type <b>Query</b>). Import all copies the
            converted code into your drafts; then review it in Review &amp; save and run it with Run my files.
          </div>
          {(g.ssis ?? []).map((p) => (
            <div key={p.file} className={`mb-2 rounded-md border px-3 py-2 text-xs ${p.converted < p.parts ? 'border-amber-300 bg-amber-50 text-amber-900' : 'bg-muted/40'}`}>
              SSIS package <b>{p.file}</b>: Genie Migrate split it into {p.parts} parts; {p.converted} of {p.parts} converted so far.
              {p.converted < p.parts && ' The parts are fragments of one package: read them in order, and check them against the package diagram in Task 1.'}
            </div>
          ))}
          {g.output_error && <div className="text-xs text-red-700">Could not list the output folder: {g.output_error}</div>}
          {g.output.length === 0 ? (
            <EmptyState title="Nothing in your output folder yet">Run Genie Migrate, save to the output folder, then refresh. Or paste the converted SQL.</EmptyState>
          ) : (
            <div className="divide-y rounded-md border">
              {g.output.map((f) => (
                <div key={f.path} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate" title={f.path}>
                    {f.label ?? f.path.slice(g.output_folder.length + 1)}
                    {f.type === 'QUERY' && (
                      <span className="ml-2 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                        Genie Migrate query{f.from && !f.part ? ` · from ${f.from}` : ''}
                      </span>
                    )}
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
              <Button key={f.path} size="sm" variant="outline" disabled={busy === f.path} onClick={() => void copyPrepared(f.path)}>
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
