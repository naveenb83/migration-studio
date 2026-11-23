/**
 * Genie Analyse: run Genie Migrate "Analyze" in the workspace (UI only), import its analysis.json, review the
 * dependencies with line-level evidence, confirm / reject / add, then feed confirmed findings into the lineage
 * worksheet, open questions and the rules agreement. Native findings and manual additions are labelled apart.
 * Trace (Task 1) stays the manual fallback. Nothing imported is executed; no team file is changed.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Alert, AlertDescription, Badge, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from '@databricks/appkit-ui/react';
import { ArrowRight, Download, ExternalLink, FileUp, ListPlus, MessageCircleQuestion, RefreshCw } from 'lucide-react';
import { CopyButton, EmptyState, ErrorState, Kpi, Loading, PageHeader, Section, fmtTime, notify } from '@/components/common';
import { useEntries } from '@/components/register/Register';
import { api, track } from '@/lib/api';
import { useApi } from '@/lib/poll';
import { DependencyGraph } from './DependencyGraph';
import { linesText, shortName, type AEdge, type AnalysisModel, type Decision, type ManualDep, type SnapMeta } from './types';

interface Overview {
  candidates: Array<{ path: string; modified: number | null; size: number | null }>;
  imports: SnapMeta[];
  input_folder: string;
  input_url: string | null;
  output_folder: string;
  output_url: string | null;
}
interface Evidence {
  file: string;
  source: string;
  from: number;
  to: number;
  lines: Array<{ n: number; text: string }>;
  stale: boolean;
}

const DECISIONS = [
  { v: 'confirmed', l: 'Confirmed' },
  { v: 'follow_up', l: 'Follow up' },
  { v: 'rejected', l: 'Rejected' },
] as const;

function Native() {
  return <Badge className="bg-sky-600">Genie Migrate · native</Badge>;
}
function Manual() {
  return <Badge className="bg-violet-600">Manual</Badge>;
}

export default function GenieAnalysePage() {
  const ov = useApi<Overview>('/api/genie-analyse');
  const [snapId, setSnapId] = useState<string | null>(null);
  const model = useApi<{ meta: SnapMeta; model: AnalysisModel } | null>(`/api/genie-analyse/model${snapId ? `?id=${snapId}` : ''}`, [snapId]);
  const decisionsE = useEntries<Decision>('analysis_decision');
  const manualE = useEntries<ManualDep>('analysis_manual');
  const lineageE = useEntries<Record<string, unknown>>('lineage_row');
  const [busy, setBusy] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [ev, setEv] = useState<Evidence | null>(null);
  const [evErr, setEvErr] = useState<string | null>(null);
  const [man, setMan] = useState<ManualDep>({});
  const upload = useRef<HTMLInputElement>(null);
  useEffect(() => track('task_view', 'task1', { view: 'genie_analyse' }), []);

  const m = model.data?.model ?? null;
  const meta = model.data?.meta ?? null;
  const objName = useMemo(() => new Map((m?.objects ?? []).map((o) => [o.id, o.name])), [m]);
  const fileName = useMemo(() => new Map((m?.files ?? []).map((f) => [f.id, f.path])), [m]);
  const [optimistic, setOptimistic] = useState<Map<string, Decision>>(new Map());
  const decisions = useMemo(() => {
    const saved = new Map((decisionsE.data ?? []).filter((d) => !meta || !d.payload.analysis_id || d.payload.analysis_id === meta.id).map((d) => [d.entry_key, d.payload]));
    for (const [k, v] of optimistic) saved.set(k, v); // show a decision at once; the saved value takes over on the next refresh
    return saved;
  }, [decisionsE.data, meta, optimistic]);
  const manual = useMemo(() => (manualE.data ?? []).map((x) => ({ key: x.entry_key, from: String(x.payload.from ?? ''), to: String(x.payload.to ?? ''), op: String(x.payload.op ?? ''), file: String(x.payload.file ?? ''), lines: String(x.payload.lines ?? ''), note: String(x.payload.note ?? ''), by: x.user_email })), [manualE.data]);
  const edgeFrom = (e: AEdge) => (e.kind === 'reads' ? (objName.get(e.to) ?? '?') : (objName.get(e.fromObject ?? -1) ?? '?'));
  const edgeTo = (e: AEdge) => (e.kind === 'reads' ? (fileName.get(e.fromFile ?? -1) ?? '?') : (objName.get(e.to) ?? '?'));

  const importPath = async (path: string) => {
    setBusy(path);
    try {
      const r = await api.post<SnapMeta>('/api/genie-analyse/import', { path });
      notify.ok(`Imported the analysis: ${r.files} file(s), ${r.objects} objects, ${r.missing} missing dependencies.`);
      setSnapId(r.id);
      await ov.reload();
    } catch (e) {
      notify.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const uploadFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy('upload');
    try {
      const r = await api.post<SnapMeta>('/api/genie-analyse/upload', { name: f.name, content: await f.text() });
      notify.ok('Uploaded analysis imported (labelled as uploaded).');
      setSnapId(r.id);
      await ov.reload();
    } catch (e) {
      notify.error((e as Error).message);
    } finally {
      setBusy(null);
      if (upload.current) upload.current.value = '';
    }
  };
  const decide = async (key: string, decision: string, note?: string) => {
    const payload: Decision = { decision: decision as Decision['decision'], note: note ?? decisions.get(key)?.note ?? '', source: key.startsWith('m-') ? 'manual' : 'native', analysis_id: meta?.id ?? '' };
    setOptimistic((o) => new Map(o).set(key, payload));
    try {
      await api.post('/api/entries', { kind: 'analysis_decision', entry_key: key, payload });
      await decisionsE.reload();
    } catch (e) {
      setOptimistic((o) => {
        const n = new Map(o);
        n.delete(key);
        return n;
      });
      notify.error(`Not saved: ${(e as Error).message}`);
    }
  };
  const showEvidence = async (e: AEdge) => {
    setSel(e.key);
    setEv(null);
    setEvErr(null);
    const file = fileName.get(e.fileId ?? -1);
    if (!meta || !file || !e.lines) {
      setEvErr('Genie Migrate did not record a location for this dependency.');
      return;
    }
    try {
      setEv(await api.get<Evidence>(`/api/genie-analyse/evidence?id=${meta.id}&file=${encodeURIComponent(file)}&from=${e.lines[0]}&to=${e.lines[1]}`));
    } catch (err) {
      setEvErr((err as Error).message);
    }
  };
  const addManual = async () => {
    if (!man.from || !man.to) return notify.error('Say what depends on what (from and to).');
    try {
      await api.post('/api/entries', { kind: 'analysis_manual', entry_key: `m-${Date.now().toString(36)}`, payload: { ...man } });
      setMan({});
      await manualE.reload();
      notify.ok('Manual dependency added (labelled Manual).');
    } catch (e) {
      notify.error((e as Error).message);
    }
  };
  const raiseMissing = async () => {
    if (!m?.missing.length) return;
    const names = m.missing.map((x) => shortName(x.name)).join(', ');
    try {
      await api.post('/api/entries', { kind: 'question_answer', entry_key: `q-ga-${meta?.id ?? 'x'}`, payload: { question: `Genie Migrate Analyze found ${m.missing.length} dependencies that are not in the project (${names}). Where do they come from (source system, replica, another team), and who owns them?`, status: 'open', answer: '', file: 'Genie Analyse' } });
      notify.ok('Raised as an open question (Task 1 → Open questions).');
    } catch (e) {
      notify.error((e as Error).message);
    }
  };
  /** One lineage row per (file, created object) from confirmed native lineage, plus one per confirmed manual dependency. */
  const toLineage = async () => {
    if (!m || !meta) return;
    setBusy('lineage');
    try {
      const groups = new Map<string, AEdge[]>();
      for (const e of m.edges.filter((x) => x.kind === 'lineage' && decisions.get(x.key)?.decision === 'confirmed')) {
        const k = `${e.fileId}:${e.to}`;
        groups.set(k, [...(groups.get(k) ?? []), e]);
      }
      const readsOnly = m.edges.filter((x) => x.kind === 'reads' && decisions.get(x.key)?.decision === 'confirmed' && !m.objects.some((o) => o.createdBy.includes(x.fileId ?? -1)));
      for (const e of readsOnly) groups.set(`${e.fileId}:r`, [...(groups.get(`${e.fileId}:r`) ?? []), e]);
      let step = (lineageE.data ?? []).length + 1, n = 0;
      for (const [k, es] of groups) {
        const e0 = es[0];
        const file = fileName.get(e0.fileId ?? -1) ?? '';
        const lines = es.map((e) => e.lines).filter(Boolean) as Array<[number, number]>;
        const span: [number, number] | null = lines.length ? [Math.min(...lines.map((l) => l[0])), Math.max(...lines.map((l) => l[1]))] : null;
        const created = k.endsWith(':r') ? null : objName.get(e0.to) ?? '';
        await api.post('/api/entries', {
          kind: 'lineage_row', entry_key: `ga-${meta.id.slice(3, 17)}-${k.replace(/[^0-9a-z]/gi, '_')}`,
          payload: {
            step: String(step++), layer: created ? 'Source view' : 'Source', system: `SQL Server (${m.dialect ?? 'T-SQL'})`,
            object: created ?? file, object_type: created ? (e0.via?.toLowerCase().includes('view') ? 'view' : 'object') : 'script',
            reads_from: es.map((e) => shortName(edgeFrom(e))).join(', '), writes_to: created ?? '', mechanism: e0.via ?? e0.op, schedule: '',
            in_scope: 'yes', notes: `From Genie Migrate Analyze (native), confirmed in Genie Analyse; analysis ${meta.id}`,
            cited_file: `${file}${span ? `#${linesText(span).replace('–', '-')}` : ''}`, verified: true,
          },
        });
        n++;
      }
      for (const x of manual.filter((x) => decisions.get(x.key)?.decision === 'confirmed')) {
        await api.post('/api/entries', { kind: 'lineage_row', entry_key: `ga-${x.key}`, payload: { step: String(step++), layer: '', system: '', object: x.to, object_type: '', reads_from: x.from, writes_to: x.to, mechanism: x.op, schedule: '', in_scope: 'yes', notes: `Manual addition in Genie Analyse${x.note ? `: ${x.note}` : ''}`, cited_file: `${x.file}${x.lines ? `#${x.lines}` : ''}`, verified: false } });
        n++;
      }
      await lineageE.reload();
      track('genie_analyse_to_lineage', 'task1', { rows: n });
      notify.ok(n ? `${n} lineage row(s) written. Review them in Task 1 → Lineage worksheet.` : 'Confirm some dependencies first.');
    } catch (e) {
      notify.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const o = ov.data;
  const confirmed = m ? m.edges.filter((e) => decisions.get(e.key)?.decision === 'confirmed').length : 0;
  const reviewed = m ? m.edges.filter((e) => decisions.get(e.key)?.decision).length : 0;
  return (
    <div className="space-y-4">
      <PageHeader title="Genie Analyse: let Genie Migrate find the dependencies" kicker="Task 1 · native analysis (Trace stays as the manual fallback)">
        <Button asChild variant="outline" size="sm">
          <Link to="/task1">Open Trace</Link>
        </Button>
      </PageHeader>

      <Section title="1 · Run Analyze in the workspace" description="Genie Migrate's Analyze is Beta and runs in the workspace only (no API). It writes analysis.json into the project's output folder; the app imports it from there.">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>
            <b>+ New → Migration project</b> · source dialect <b>T-SQL</b> · target <b>DBSQL</b>.
          </li>
          <li>
            Add the files from your input folder <code className="break-all text-xs">{o?.input_folder}</code>
            {o?.input_url && (
              <a className="ml-2 underline" href={o.input_url} target="_blank" rel="noreferrer">
                Open <ExternalLink className="inline h-3 w-3" />
              </a>
            )}{' '}
            (add all of them, so cross-file dependencies resolve).
          </li>
          <li>
            Set the output to <code className="break-all text-xs">{o?.output_folder}</code> <CopyButton text={o?.output_folder ?? ''} />
          </li>
          <li>Run <b>Analyze</b>, then look at its Files (missing dependencies), Lineage and Report tabs.</li>
          <li>Come back here and press <b>Refresh</b>: the analysis appears below.</li>
        </ol>
        <div className="mt-2 text-xs text-muted-foreground">No Migration project option? An admin enables &ldquo;Migration Projects Experimental Features&rdquo; under Previews. Or use Trace.</div>
      </Section>

      <Section
        title="2 · Import an analysis"
        description="Imports are kept as read-only snapshots in your team folder. Nothing is executed."
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => void ov.reload()}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh
            </Button>
            <input ref={upload} type="file" accept=".json" className="hidden" onChange={(e) => void uploadFile(e.target.files?.[0])} aria-label="Upload analysis.json" />
            <Button size="sm" variant="outline" disabled={busy === 'upload'} onClick={() => upload.current?.click()}>
              <FileUp className="mr-1 h-3.5 w-3.5" /> Upload analysis.json
            </Button>
          </>
        }
      >
        {ov.loading && !o ? (
          <Loading rows={2} />
        ) : ov.error ? (
          <ErrorState error={ov.error} retry={() => void ov.reload()} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="mb-1 text-sm font-medium">Found in your Genie Migrate folders</div>
              {o?.candidates.length ? (
                <div className="divide-y rounded-md border text-sm">
                  {o.candidates.map((c) => (
                    <div key={c.path} className="flex items-center gap-2 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate" title={c.path}>
                        {c.path.split('/teams/')[1] ?? c.path}
                      </span>
                      <span className="text-xs text-muted-foreground">{fmtTime(c.modified)}</span>
                      <Button size="sm" variant="secondary" disabled={busy === c.path} onClick={() => void importPath(c.path)}>
                        <Download className="mr-1 h-3.5 w-3.5" /> Import
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="No analysis.json yet">Run Analyze (step 1), then Refresh.</EmptyState>
              )}
            </div>
            <div>
              <div className="mb-1 text-sm font-medium">Imported analyses</div>
              {o?.imports.length ? (
                <Select value={snapId ?? o.imports[0]?.id} onValueChange={setSnapId}>
                  <SelectTrigger aria-label="Imported analysis">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {o.imports.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {fmtTime(s.generated_at)} · {s.files} file(s) · {s.missing} missing · {s.source === 'uploaded' ? 'uploaded' : 'Genie Migrate'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="text-sm text-muted-foreground">Nothing imported yet.</div>
              )}
            </div>
          </div>
        )}
      </Section>

      {model.loading && !model.data ? (
        <Loading rows={3} />
      ) : model.error ? (
        <ErrorState error={model.error} retry={() => void model.reload()} />
      ) : !m || !meta ? null : (
        <>
          {m.warnings.map((w) => (
            <Alert key={w}>
              <AlertDescription>{w}</AlertDescription>
            </Alert>
          ))}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {meta.source === 'uploaded' ? <Badge variant="secondary">Uploaded analysis</Badge> : <Native />}
            <span>
              Generated {fmtTime(m.generatedAt)} · schema {m.schemaVersion} · {m.dialect} · analyzer {m.analyzer ?? '?'} · imported by {meta.imported_by.split('@')[0]}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <Kpi label="Files" value={m.files.length} />
            <Kpi label="Objects" value={m.objects.length} />
            <Kpi label="Defined here" value={m.objects.filter((x) => x.provenance === 'internal').length} tone="PASS" />
            <Kpi label="Missing" value={m.missing.length} tone={m.missing.length ? 'WARN' : undefined} />
            <Kpi label="Dependencies" value={m.edges.length} />
            <Kpi label="Reviewed" value={`${reviewed}/${m.edges.length}`} tone={reviewed === m.edges.length ? 'PASS' : undefined} />
          </div>

          <Tabs defaultValue="graph">
            <TabsList>
              <TabsTrigger value="graph">Graph</TabsTrigger>
              <TabsTrigger value="deps">Dependencies ({m.edges.length + manual.length})</TabsTrigger>
              <TabsTrigger value="missing">Missing ({m.missing.length})</TabsTrigger>
              <TabsTrigger value="files">Files ({m.files.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="graph">
              <div className="grid gap-3 lg:grid-cols-[1fr_380px]">
                <DependencyGraph model={m} decisions={decisions} manual={manual} selected={sel} onSelect={(k) => {
                  const e = m.edges.find((x) => x.key === k);
                  if (e) void showEvidence(e);
                }} />
                <EvidencePanel ev={ev} err={evErr} edge={m.edges.find((x) => x.key === sel) ?? null} from={(e) => edgeFrom(e)} to={(e) => edgeTo(e)} decision={sel ? decisions.get(sel) : undefined} onDecide={(d) => sel && void decide(sel, d)} />
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span><span className="mr-1 inline-block h-3 w-3 rounded border-2 border-indigo-500 bg-indigo-50 align-middle" />file</span>
                <span><span className="mr-1 inline-block h-3 w-3 rounded border-2 border-emerald-600 bg-emerald-50 align-middle" />defined in the project</span>
                <span><span className="mr-1 inline-block h-3 w-3 rounded border-2 border-dashed border-amber-600 bg-amber-50 align-middle" />missing: not in the project</span>
                <span><span className="mr-1 inline-block h-3 w-3 rounded border-2 border-dashed border-violet-600 bg-violet-50 align-middle" />manual addition</span>
                <span>Click an arrow to see its evidence. Green = confirmed, amber = follow up, red dashed = rejected.</span>
              </div>
            </TabsContent>

            <TabsContent value="deps" className="space-y-3">
              <div className="overflow-x-auto">
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[22%]">From</TableHead>
                      <TableHead className="w-[24%]">To</TableHead>
                      <TableHead className="w-[11%]">How</TableHead>
                      <TableHead className="w-[17%]">Evidence</TableHead>
                      <TableHead className="w-[12%]">Source</TableHead>
                      <TableHead className="w-[14%]">Your review</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {m.edges.map((e) => (
                      <TableRow key={e.key} className={sel === e.key ? 'bg-muted' : undefined}>
                        <TableCell className="truncate text-sm" title={edgeFrom(e)}>{shortName(edgeFrom(e))}</TableCell>
                        <TableCell className="truncate text-sm" title={edgeTo(e)}>{shortName(edgeTo(e))}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{e.kind === 'reads' ? 'read by' : (e.via ?? e.op)}</TableCell>
                        <TableCell className="truncate">
                          <Button size="sm" variant="link" className="h-auto max-w-full justify-start truncate p-0 text-xs" title={`Show the code: ${fileName.get(e.fileId ?? -1) ?? ""}`} onClick={() => void showEvidence(e)}>
                            {linesText(e.lines) || "show"} · {fileName.get(e.fileId ?? -1)}
                          </Button>
                        </TableCell>
                        <TableCell><Native /></TableCell>
                        <TableCell>
                          <ReviewSelect value={decisions.get(e.key)?.decision} onChange={(d) => void decide(e.key, d)} />
                        </TableCell>
                      </TableRow>
                    ))}
                    {manual.map((x) => (
                      <TableRow key={x.key}>
                        <TableCell className="truncate text-sm" title={x.from}>{x.from}</TableCell>
                        <TableCell className="truncate text-sm" title={x.to}>{x.to}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{x.op}</TableCell>
                        <TableCell className="truncate text-xs" title={x.file}>{x.lines} {x.file}</TableCell>
                        <TableCell><Manual /></TableCell>
                        <TableCell>
                          <ReviewSelect value={decisions.get(x.key)?.decision} onChange={(d) => void decide(x.key, d)} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {sel && (ev || evErr) && (
                <EvidencePanel ev={ev} err={evErr} edge={m.edges.find((x) => x.key === sel) ?? null} from={(e) => edgeFrom(e)} to={(e) => edgeTo(e)} decision={decisions.get(sel)} onDecide={(d) => void decide(sel, d)} />
              )}
              <Section title="Add a dependency Genie Migrate didn't find" description="Labelled Manual everywhere, so native findings and your additions never mix.">
                <div className="grid gap-2 md:grid-cols-3">
                  <Input placeholder="From (object or file)" value={man.from ?? ''} onChange={(e) => setMan({ ...man, from: e.target.value })} aria-label="From" />
                  <Input placeholder="To (object or file)" value={man.to ?? ''} onChange={(e) => setMan({ ...man, to: e.target.value })} aria-label="To" />
                  <Input placeholder="How (e.g. MERGE, SSIS data flow, schedule)" value={man.op ?? ''} onChange={(e) => setMan({ ...man, op: e.target.value })} aria-label="How" />
                  <Input placeholder="Evidence file" value={man.file ?? ''} onChange={(e) => setMan({ ...man, file: e.target.value })} aria-label="Evidence file" />
                  <Input placeholder="Lines (e.g. L10-L25)" value={man.lines ?? ''} onChange={(e) => setMan({ ...man, lines: e.target.value })} aria-label="Lines" />
                  <Textarea placeholder="Note" className="min-h-9" value={man.note ?? ''} onChange={(e) => setMan({ ...man, note: e.target.value })} aria-label="Note" />
                </div>
                <Button size="sm" className="mt-2" onClick={() => void addManual()}>
                  <ListPlus className="mr-1 h-4 w-4" /> Add manual dependency
                </Button>
              </Section>
            </TabsContent>

            <TabsContent value="missing">
              {m.missing.length === 0 ? (
                <EmptyState title="No missing dependencies">Every object the code uses is defined in the project.</EmptyState>
              ) : (
                <div className="space-y-2">
                  <Alert>
                    <AlertDescription>
                      These objects are used by your code but aren&rsquo;t defined in the project (Genie Migrate marks them &ldquo;undetermined&rdquo;). Usually they&rsquo;re source tables from another system or a replica. Either add their DDL to the migration project and analyse again, or record where they come from as an open question.
                    </AlertDescription>
                  </Alert>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Object</TableHead>
                        <TableHead>Used by</TableHead>
                        <TableHead>Source</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {m.missing.map((x) => (
                        <TableRow key={x.id}>
                          <TableCell className="font-mono text-xs">{x.name}</TableCell>
                          <TableCell className="text-sm">{x.readBy.join(', ')}</TableCell>
                          <TableCell><Native /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <Button size="sm" variant="outline" onClick={() => void raiseMissing()}>
                    <MessageCircleQuestion className="mr-1 h-4 w-4" /> Raise as an open question
                  </Button>
                </div>
              )}
            </TabsContent>

            <TabsContent value="files">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Lines</TableHead>
                    <TableHead>Statements analysed</TableHead>
                    <TableHead>Failed</TableHead>
                    <TableHead>Unresolved</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {m.files.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell className="text-sm">{f.path}</TableCell>
                      <TableCell>{f.loc}</TableCell>
                      <TableCell>{f.statementsAnalyzed}</TableCell>
                      <TableCell className={f.statementsFailed ? 'text-red-700' : ''}>{f.statementsFailed}</TableCell>
                      <TableCell className="text-xs">{f.unresolved.join(', ') || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {m.executionOrder.length > 0 && <div className="mt-2 text-xs text-muted-foreground">Execution order: {m.executionOrder.map((id) => fileName.get(id)).join(' → ')}{m.cycles.length ? ` · ${m.cycles.length} cycle(s)` : ''}</div>}
            </TabsContent>
          </Tabs>

          <Section title="3 · Use what you confirmed" description={`${confirmed} of ${m.edges.length} native dependencies confirmed · ${manual.length} manual addition(s).`}>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy === 'lineage' || confirmed + manual.length === 0} onClick={() => void toLineage()}>
                <ListPlus className="mr-1 h-4 w-4" /> Write confirmed dependencies to the lineage worksheet
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/task1">
                  Next: agree the rules (Task 1) <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/task2">
                  Then convert and run (Task 2) <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">Lineage rows written from here say &ldquo;From Genie Migrate Analyze (native)&rdquo; or &ldquo;Manual addition&rdquo; in their notes, cite the file and lines, and can be edited in the worksheet. Writing again updates the same rows instead of adding duplicates.</div>
          </Section>
        </>
      )}
    </div>
  );
}

function ReviewSelect({ value, onChange }: { value?: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8" aria-label="Review">
        <SelectValue placeholder="Not reviewed" />
      </SelectTrigger>
      <SelectContent>
        {DECISIONS.map((d) => (
          <SelectItem key={d.v} value={d.v}>
            {d.l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function EvidencePanel({ ev, err, edge, from, to, decision, onDecide }: { ev: Evidence | null; err: string | null; edge: AEdge | null; from: (e: AEdge) => string; to: (e: AEdge) => string; decision?: Decision; onDecide: (d: string) => void }) {
  if (!edge) return <div className="rounded-md border p-3 text-sm text-muted-foreground">Click a dependency to see the code that proves it.</div>;
  return (
    <div className="space-y-2 rounded-md border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold">
          {shortName(from(edge))} → {shortName(to(edge))}
        </div>
        <Native />
      </div>
      <div className="text-xs text-muted-foreground">{edge.kind === 'reads' ? 'read by this file' : (edge.via ?? edge.op)} · {linesText(edge.lines)}</div>
      {err && <div className="text-xs text-amber-800">{err}</div>}
      {!ev && !err && <Loading rows={3} />}
      {ev && (
        <>
          {ev.stale && <div className="rounded bg-amber-50 p-2 text-xs text-amber-900">This file changed after the analysis ran: line numbers may have moved. Analyse again to refresh.</div>}
          <pre className="max-h-80 overflow-auto rounded bg-slate-950 p-2 text-[11px] leading-snug text-slate-100">
            {ev.lines.map((l) => (
              <div key={l.n} className={l.n >= ev.from && l.n <= ev.to ? 'bg-amber-500/25' : 'opacity-60'}>
                <span className="mr-2 inline-block w-8 select-none text-right text-slate-500">{l.n}</span>
                {l.text}
              </div>
            ))}
          </pre>
          <div className="text-[11px] text-muted-foreground">{ev.file} · shown from the {ev.source}</div>
        </>
      )}
      <ReviewSelect value={decision?.decision} onChange={onDecide} />
    </div>
  );
}
