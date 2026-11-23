/**
 * Actions on the file open in the Code browser: add a lineage row that cites it (and the selected lines), note an
 * open question about it, or copy a Genie Code prompt about it. Writes the same entries as the Lineage worksheet and
 * Open questions tabs, so they show up there and count toward Done when.
 */
import { useState } from 'react';
import { Badge, Button, Checkbox, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label, Textarea } from '@databricks/appkit-ui/react';
import { ExternalLink, GitBranchPlus, MessageCircleQuestion, Sparkles } from 'lucide-react';
import { CopyButton, notify } from '@/components/common';
import type { LineSelection } from '@/components/common/CodeView';
import { useEntries } from '@/components/register/Register';
import { api, track } from '@/lib/api';
import { useSession } from '@/lib/me';
import { useApi } from '@/lib/poll';

const LAYERS = ['Source', 'Source view', 'Ingestion', 'Transformation', 'Target', 'Schedule', 'Report', 'New ingest', 'New stage', 'New EDH / CIF', 'New schedule'];

function guessType(path: string): string {
  const n = path.toLowerCase();
  if (n.endsWith('.dtsx')) return 'SSIS package';
  if (/proc/.test(n)) return 'stored procedure';
  if (/view/.test(n)) return 'view';
  if (/workflow|schedul/.test(n)) return 'schedule';
  if (n.endsWith('.yml') || n.endsWith('.yaml')) return 'framework config';
  if (/table/.test(n)) return 'table DDL';
  return 'SQL';
}

export function FileActions({ path, sel }: { path: string; sel: LineSelection | null }) {
  const me = useSession();
  const lineage = useEntries<{ cited_file?: string }>('lineage_row');
  const gm = useApi<{ input_url: string | null }>('/api/genie-migrate');
  const gc = useApi<{ skill: { name: string } }>('/api/genie-code');
  const [mode, setMode] = useState<'lineage' | 'question' | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const file = path.split('/').pop() ?? path;
  const lines = sel ? (sel.from === sel.to ? `#L${sel.from}` : `#L${sel.from}-L${sel.to}`) : '';
  const cites = (lineage.data ?? []).filter((r) => String(r.payload.cited_file ?? '').includes(file)).length;
  const skill = gc.data?.skill.name ? `@${gc.data.skill.name} ` : '';
  const snippet = sel ? sel.text.slice(0, 3000) : '';
  const prompt = `${skill}Explain ${file}${sel ? ` (lines ${sel.from}–${sel.to})` : ''}: what it reads, what it writes, when it runs, and any business rule it applies (keys, filters, type or status codes, dates). Cite line numbers, and say what you could not confirm from this file alone.${snippet ? `\n\n${snippet}` : ''}`;

  const open = (m: 'lineage' | 'question') => {
    const step = String((lineage.data ?? []).length + 1);
    setForm(
      m === 'lineage'
        ? { step, layer: '', object: '', object_type: guessType(path), reads_from: '', writes_to: '', schedule: '', mechanism: '', notes: snippet ? snippet.split('\n').slice(0, 3).join(' ').slice(0, 200) : '', cited_file: `${path}${lines}`, verified: false }
        : { question: `About ${file}${sel ? ` lines ${sel.from}–${sel.to}` : ''}: `, answer: '' },
    );
    setMode(m);
  };
  const save = async () => {
    setBusy(true);
    try {
      if (mode === 'lineage') {
        const payload = Object.fromEntries(Object.entries(form).filter(([k]) => k === 'verified' || me.pack.lineage_template.columns.includes(k)));
        await api.post('/api/entries', { kind: 'lineage_row', entry_key: `row-${Date.now().toString(36)}`, payload });
        track('lineage_from_code', 'task1', { file });
        notify.ok('Added to your lineage worksheet.');
      } else {
        await api.post('/api/entries', { kind: 'question_answer', entry_key: `q-${Date.now().toString(36)}`, payload: { question: String(form.question ?? ''), status: 'open', answer: String(form.answer ?? ''), file: `${path}${lines}` } });
        track('question_from_code', 'task1', { file });
        notify.ok('Added to your open questions.');
      }
      await lineage.reload();
      setMode(null);
    } catch (e) {
      notify.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  const text = (k: string, label: string, placeholder = '') => (
    <div className="space-y-1">
      <Label htmlFor={`fa-${k}`} className="text-xs">
        {label}
      </Label>
      <Input id={`fa-${k}`} value={String(form[k] ?? '')} placeholder={placeholder} onChange={(e) => set(k, e.target.value)} />
    </div>
  );

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2">
      <Button size="sm" onClick={() => open('lineage')}>
        <GitBranchPlus className="mr-1 h-4 w-4" /> Add lineage row from this file
      </Button>
      <Button size="sm" variant="outline" onClick={() => open('question')}>
        <MessageCircleQuestion className="mr-1 h-4 w-4" /> Note a question
      </Button>
      <CopyButton text={prompt} label="Copy Genie Code prompt" />
      {gm.data?.input_url && (
        <Button asChild size="sm" variant="ghost">
          <a href={gm.data.input_url} target="_blank" rel="noreferrer" title="Your team's copy of the legacy code, where Genie Code can read it">
            <Sparkles className="mr-1 h-4 w-4" /> Open in workspace <ExternalLink className="ml-1 h-3 w-3" />
          </a>
        </Button>
      )}
      <span className="ml-auto text-xs text-muted-foreground">
        {sel ? (
          <Badge variant="secondary">
            lines {sel.from}–{sel.to} selected
          </Badge>
        ) : (
          'Tip: select lines in the code to cite them'
        )}
        {cites > 0 && <span className="ml-2">{cites} lineage row{cites > 1 ? 's' : ''} cite this file</span>}
      </span>

      <Dialog open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{mode === 'lineage' ? `Lineage row from ${file}` : `Question about ${file}`}</DialogTitle>
          </DialogHeader>
          {mode === 'lineage' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {text('step', 'Step')}
              <div className="space-y-1">
                <Label htmlFor="fa-layer" className="text-xs">
                  Layer
                </Label>
                <Input id="fa-layer" list="fa-layers" value={String(form.layer ?? '')} placeholder="e.g. Ingestion" onChange={(e) => set('layer', e.target.value)} />
                <datalist id="fa-layers">
                  {LAYERS.map((l) => (
                    <option key={l} value={l} />
                  ))}
                </datalist>
              </div>
              {text('system', 'System', 'e.g. SQL Server EDH')}
              {text('object', 'Object', 'table, view, procedure or job name')}
              {text('object_type', 'Object type')}
              {text('mechanism', 'Mechanism', 'e.g. MERGE, SSIS data flow, upsert_delete')}
              {text('reads_from', 'Reads from')}
              {text('writes_to', 'Writes to')}
              {text('schedule', 'Schedule', 'e.g. Mon–Fri 08:12')}
              {text('in_scope', 'In scope?', 'yes / no / shared')}
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="fa-notes" className="text-xs">
                  Notes
                </Label>
                <Textarea id="fa-notes" className="min-h-16" value={String(form.notes ?? '')} onChange={(e) => set('notes', e.target.value)} />
              </div>
              <div className="sm:col-span-2">{text('cited_file', 'Cited file (and lines)')}</div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <Checkbox checked={Boolean(form.verified)} onCheckedChange={(v) => set('verified', Boolean(v))} /> I checked this against the code
              </label>
            </div>
          ) : (
            <div className="space-y-2">
              <Textarea className="min-h-24" value={String(form.question ?? '')} onChange={(e) => set('question', e.target.value)} aria-label="Question" />
              <Input value={String(form.answer ?? '')} placeholder="Who can answer it? (optional)" onChange={(e) => set('answer', e.target.value)} aria-label="Who can answer" />
              <div className="text-xs text-muted-foreground">Saved as an open question with a link to {file}{lines}.</div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMode(null)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void save()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
