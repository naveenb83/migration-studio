/** Genie Code hand-off: copy files to the team's Genie Code folder, open them in the workspace, bring edits back. */
import { useState } from 'react';
import { Badge, Button, Checkbox, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@databricks/appkit-ui/react';
import { Download, ExternalLink, FolderInput, RefreshCw } from 'lucide-react';
import { CopyButton, EmptyState, ErrorState, Loading, Section, fmtTime, notify } from '@/components/common';
import { DiffView } from '@/components/common/CodeView';
import { api } from '@/lib/api';
import { useApi } from '@/lib/poll';
import type { ManifestItem } from '@/lib/types';

interface GC {
  workspace_url: string;
  folder: string;
  folder_url: string | null;
  readme_url: string | null;
  skill: { name: string; path: string | null; installed: boolean };
  files: Array<{ path: string; name: string; url: string; modified: number | null }>;
}

export function GenieCode({ onSaved }: { onSaved: () => void }) {
  const gc = useApi<GC>('/api/genie-code');
  const teamFiles = useApi<Array<ManifestItem & { exists: boolean }>>('/api/teamfiles');
  const uploads = useApi<{ files: Array<{ name: string }> }>('/api/uploads');
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [cmp, setCmp] = useState<{ path: string; name: string; target: string; left: string; right: string } | null>(null);

  const chosen = (key: string, dflt: boolean) => pick[key] ?? dflt;
  const prepare = async () => {
    setBusy('prepare');
    try {
      const team_files = (teamFiles.data ?? []).filter((f) => f.exists && chosen(`t:${f.file}`, true)).map((f) => f.file);
      const ups = (uploads.data?.files ?? []).filter((f) => chosen(`u:${f.name}`, false)).map((f) => f.name);
      const r = await api.post<{ copied: string[]; folder_url: string | null }>('/api/genie-code/prepare', { team_files, uploads: ups });
      notify.ok(`Copied ${r.copied.length} file(s) to your Genie Code folder.`);
      await gc.reload();
    } catch (e) {
      notify.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const compare = async (path: string, name: string) => {
    const target = (teamFiles.data ?? []).find((t) => t.file === name.split('/').pop())?.file;
    try {
      const right = (await api.get<{ content: string }>(`/api/genie-code/file?path=${encodeURIComponent(path)}`)).content;
      const left = target ? (await api.get<{ content: string }>(`/api/teamfiles/${encodeURIComponent(target)}`)).content : '';
      setCmp({ path, name, target: target ?? '', left, right });
    } catch (e) {
      notify.error((e as Error).message);
    }
  };
  const bringBack = async (path: string, target: string | null) => {
    setBusy(path);
    try {
      const r = await api.post<{ saved_as: string }>('/api/genie-code/bring-back', { path, target_file: target });
      notify.ok(`Saved as ${r.saved_as} (provenance: Genie Code).${target ? ' The next “Run my files” executes it.' : ''}`);
      setCmp(null);
      onSaved();
    } catch (e) {
      notify.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (gc.loading && !gc.data) return <Loading rows={4} />;
  if (gc.error) return <ErrorState error={gc.error} retry={() => void gc.reload()} />;
  const g = gc.data as GC;
  const skillTag = g.skill.name ? `@${g.skill.name}` : '';
  const prompts = [
    `${skillTag} Review the stage view against the legacy source view and fix the assessment type and status code rules. Keep the same view name.`.trim(),
    `${skillTag} Check the 40_workflow YAML: the curation must run only after the ingest has finished. Fix the schedule or add a dependency.`.trim(),
    'Explain this file line by line and list every difference from the legacy procedure.',
  ];
  return (
    <div className="space-y-4">
      <Section
        title="Work on your files with Genie Code"
        description="Genie Code is the workspace's coding agent. It works in the workspace, so the app copies your files there, links you to them, and brings your edits back."
        actions={
          g.skill.name ? (
            g.skill.installed ? (
              <Badge className="bg-emerald-600">Skill {skillTag} installed</Badge>
            ) : (
              <Badge variant="destructive">Skill {skillTag} not installed: ask the facilitator</Badge>
            )
          ) : undefined
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1 text-sm font-medium">1 · Choose what to copy</div>
            <div className="max-h-64 space-y-1 overflow-auto rounded-md border p-2 text-sm">
              {(teamFiles.data ?? []).filter((f) => f.exists).map((f) => (
                <label key={f.file} className="flex items-center gap-2">
                  <Checkbox checked={chosen(`t:${f.file}`, true)} onCheckedChange={(v) => setPick((p) => ({ ...p, [`t:${f.file}`]: Boolean(v) }))} />
                  <span className="truncate">
                    {f.artifact} <span className="text-muted-foreground">· {f.file}</span>
                  </span>
                </label>
              ))}
              {(uploads.data?.files ?? []).map((f) => (
                <label key={f.name} className="flex items-center gap-2">
                  <Checkbox checked={chosen(`u:${f.name}`, false)} onCheckedChange={(v) => setPick((p) => ({ ...p, [`u:${f.name}`]: Boolean(v) }))} />
                  <span className="truncate">
                    Your upload: {f.name}
                  </span>
                </label>
              ))}
            </div>
            <Button size="sm" className="mt-2" disabled={busy === 'prepare'} onClick={() => void prepare()}>
              <FolderInput className="mr-1 h-4 w-4" /> Copy to my Genie Code folder
            </Button>
          </div>
          <div className="space-y-2 text-sm">
            <div className="font-medium">2 · Open them in the workspace</div>
            <div className="flex flex-wrap gap-2">
              {g.folder_url ? (
                <Button asChild size="sm" variant="secondary">
                  <a href={g.folder_url} target="_blank" rel="noreferrer">
                    Open my Genie Code folder <ExternalLink className="ml-1 h-3.5 w-3.5" />
                  </a>
                </Button>
              ) : (
                <span className="text-muted-foreground">Copy your files first.</span>
              )}
              {g.readme_url && (
                <Button asChild size="sm" variant="outline">
                  <a href={g.readme_url} target="_blank" rel="noreferrer">
                    Prompts README <ExternalLink className="ml-1 h-3.5 w-3.5" />
                  </a>
                </Button>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              Open a file, then the Genie Code pane (or the full-page Genie Code view). Folder: <code className="break-all">{g.folder}</code>
            </div>
            <div className="space-y-1 pt-1">
              {prompts.map((p) => (
                <div key={p} className="flex items-start gap-2 rounded-md border p-2 text-xs">
                  <span className="flex-1">{p}</span>
                  <CopyButton text={p} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="3 · Bring Genie Code’s edits back"
        description="Compare each file with your team file, then save it (same checks as any save) or keep it as a draft."
        actions={
          <Button size="sm" variant="outline" onClick={() => void gc.reload()}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh
          </Button>
        }
      >
        {g.files.length === 0 ? (
          <EmptyState title="Nothing in your Genie Code folder yet" />
        ) : (
          <div className="divide-y rounded-md border text-sm">
            {g.files.map((f) => (
              <div key={f.path} className="flex items-center gap-2 px-3 py-2">
                <a className="min-w-0 flex-1 truncate underline-offset-2 hover:underline" href={f.url} target="_blank" rel="noreferrer" title="Open in the workspace">
                  {f.name}
                </a>
                <span className="hidden text-xs text-muted-foreground md:inline">{fmtTime(f.modified)}</span>
                <Button size="sm" variant="secondary" onClick={() => void compare(f.path, f.name)}>
                  Compare & save
                </Button>
                <Button size="sm" variant="ghost" disabled={busy === f.path} onClick={() => void bringBack(f.path, null)} title="Save to drafts">
                  <Download className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Dialog open={Boolean(cmp)} onOpenChange={(o) => !o && setCmp(null)}>
        <DialogContent className="max-w-6xl">
          <DialogHeader>
            <DialogTitle>{cmp?.name}: your team file (left) vs Genie Code (right)</DialogTitle>
          </DialogHeader>
          {cmp && (cmp.target ? <DiffView left={cmp.left} right={cmp.right} name={cmp.target} height={480} /> : <div className="text-sm text-muted-foreground">This file doesn&rsquo;t match a team file name, so it can only be saved as a draft.</div>)}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCmp(null)}>
              Cancel
            </Button>
            <Button variant="secondary" disabled={!cmp || busy === cmp.path} onClick={() => cmp && void bringBack(cmp.path, null)}>
              Save as draft
            </Button>
            {cmp?.target && (
              <Button disabled={busy === cmp.path} onClick={() => void bringBack(cmp.path, cmp.target)}>
                Save as team file
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
