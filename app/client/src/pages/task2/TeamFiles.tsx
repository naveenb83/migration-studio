/** The team's manifest files (what the recheck executes): view, edit, save with validation; drafts; promote with a diff. */
import { useEffect, useState } from 'react';
import { Badge, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@databricks/appkit-ui/react';
import { FileCheck2, FileX2, Save } from 'lucide-react';
import { EmptyState, ErrorState, Loading, ProvenanceChip, Section, fmtTime, notify } from '@/components/common';
import { CodeView, DiffView } from '@/components/common/CodeView';
import { api } from '@/lib/api';
import { useApi } from '@/lib/poll';
import type { ManifestItem } from '@/lib/types';

interface FileRow extends ManifestItem {
  exists: boolean;
  size: number;
  sha256: string | null;
  meta: { source?: string; saved_by?: string; ts?: string } | null;
}
interface Draft {
  name: string;
  size: number;
  modified: number | null;
  meta: { source?: string; saved_by?: string; ts?: string; from?: string } | null;
}

export function TeamFiles({ refreshKey }: { refreshKey: number }) {
  const files = useApi<FileRow[]>('/api/teamfiles', [refreshKey]);
  const drafts = useApi<Draft[]>('/api/drafts', [refreshKey]);
  const [sel, setSel] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [orig, setOrig] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string | null>(null);
  const [promote, setPromote] = useState<{ draft: Draft; content: string; target: string; current: string } | null>(null);

  useEffect(() => {
    if (!sel) return;
    setErrors(null);
    void api.get<{ content: string }>(`/api/teamfiles/${encodeURIComponent(sel)}`).then((r) => {
      setContent(r.content);
      setOrig(r.content);
    });
  }, [sel]);

  const save = async (name: string, text: string, source = 'team_edit', from?: string) => {
    setSaving(true);
    setErrors(null);
    try {
      await api.put(`/api/teamfiles/${encodeURIComponent(name)}`, { content: text, source, from });
      notify.ok(`${name} saved. The next "Run my files" executes it.`);
      await files.reload();
      if (sel === name) setOrig(text);
      return true;
    } catch (e) {
      setErrors((e as Error).message);
      notify.error((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  };
  const openPromote = async (d: Draft) => {
    const [dr, cur] = await Promise.all([api.get<{ content: string }>(`/api/drafts/${encodeURIComponent(d.name)}`), Promise.resolve(null)]);
    void cur;
    const guess = files.data?.find((f) => d.name.includes(f.artifact) || d.name.includes(f.file.replace(/\.[^.]+$/, '')))?.file ?? files.data?.[0]?.file ?? '';
    const current = guess ? (await api.get<{ content: string }>(`/api/teamfiles/${encodeURIComponent(guess)}`)).content : '';
    setPromote({ draft: d, content: dr.content, target: guess, current });
  };
  const changeTarget = async (t: string) => {
    if (!promote) return;
    const current = (await api.get<{ content: string }>(`/api/teamfiles/${encodeURIComponent(t)}`)).content;
    setPromote({ ...promote, target: t, current });
  };

  if (files.loading && !files.data) return <Loading rows={5} />;
  if (files.error) return <ErrorState error={files.error} retry={() => void files.reload()} />;
  const selRow = files.data?.find((f) => f.file === sel);
  return (
    <div className="space-y-4">
      <Section title="Your team files" description="These exact files are what “Run my files” executes. Nothing falls back to the originals: a missing required file is rejected.">
        <div className="divide-y rounded-md border text-sm">
          {(files.data ?? []).map((f) => (
            <button key={f.file} className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted ${sel === f.file ? 'bg-muted' : ''}`} onClick={() => setSel(f.file)}>
              {f.exists ? <FileCheck2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <FileX2 className={`h-4 w-4 shrink-0 ${f.required ? 'text-red-600' : 'text-muted-foreground'}`} />}
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{f.artifact}</span> <span className="text-muted-foreground">· {f.file}</span>
              </span>
              <Badge variant="outline">{f.kind}</Badge>
              {f.exists ? <ProvenanceChip source={f.meta?.source} /> : <span className="text-xs text-muted-foreground">{f.required ? 'required, missing' : 'optional'}</span>}
              {f.sha256 && <code className="hidden text-xs text-muted-foreground md:inline">{f.sha256.slice(0, 10)}</code>}
            </button>
          ))}
        </div>
      </Section>

      {sel && selRow && (
        <Section
          title={`Edit ${selRow.artifact}`}
          description={selRow.kind === 'view_sql' ? 'A view file must be exactly one CREATE [OR REPLACE] VIEW statement.' : selRow.kind === 'framework_yaml' ? 'Framework YAML must parse; mechanisms must be ones the framework supports.' : undefined}
          actions={
            <Button size="sm" disabled={saving || content === orig} onClick={() => void save(sel, content)}>
              <Save className="mr-1 h-4 w-4" /> Save
            </Button>
          }
        >
          {errors && <div className="mb-2 rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-900">{errors}</div>}
          <CodeView value={content} name={sel} onChange={setContent} height="420px" />
          {selRow.meta?.ts && (
            <div className="mt-1 text-xs text-muted-foreground">
              Last saved {fmtTime(selRow.meta.ts)} by {selRow.meta.saved_by} · SHA-256 {selRow.sha256?.slice(0, 16)}
            </div>
          )}
        </Section>
      )}

      <Section title="Drafts and imports" description="Drafts are never executed. Promote one to a team file when you have reviewed it.">
        {drafts.loading && !drafts.data ? (
          <Loading rows={2} />
        ) : (drafts.data ?? []).length === 0 ? (
          <EmptyState title="No drafts yet">Import from Genie Migrate, paste a conversion, use a prepared example or draft with AI.</EmptyState>
        ) : (
          <div className="divide-y rounded-md border text-sm">
            {(drafts.data ?? []).map((d) => (
              <div key={d.name} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-medium">{d.name}</span>
                <ProvenanceChip source={d.meta?.source} />
                <span className="hidden text-xs text-muted-foreground md:inline">{fmtTime(d.meta?.ts)}</span>
                <Button size="sm" variant="secondary" onClick={() => void openPromote(d)}>
                  Review & promote
                </Button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Dialog open={Boolean(promote)} onOpenChange={(o) => !o && setPromote(null)}>
        <DialogContent className="max-w-6xl">
          <DialogHeader>
            <DialogTitle>Promote {promote?.draft.name}</DialogTitle>
          </DialogHeader>
          {promote && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                Replace team file
                <Select value={promote.target} onValueChange={(t) => void changeTarget(t)}>
                  <SelectTrigger className="w-96" aria-label="Target team file">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(files.data ?? []).map((f) => (
                      <SelectItem key={f.file} value={f.file}>
                        {f.artifact} · {f.file}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ProvenanceChip source={promote.draft.meta?.source} />
              </div>
              <div className="text-xs text-muted-foreground">Left: current team file · Right: the draft</div>
              <DiffView left={promote.current} right={promote.content} name={promote.target} height={460} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPromote(null)}>
              Cancel
            </Button>
            <Button
              disabled={!promote?.target || saving}
              onClick={() => {
                if (!promote) return;
                void save(promote.target, promote.content, promote.draft.meta?.source ?? 'team_edit', `drafts/${promote.draft.name}`).then((ok) => ok && setPromote(null));
              }}
            >
              Save as team file
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
