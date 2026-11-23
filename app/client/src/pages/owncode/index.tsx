/**
 * "Your own code" (optional). A team can bring its own SSIS packages, T-SQL / DDL, Agent scripts or framework YAML,
 * keep them in its own team folder, view them, copy them to its Genie Migrate input folder, draft conversions with AI
 * (Task 2), and scan them to see SSIS diagrams and an inventory. Nothing is uploaded unless the team chooses to.
 */
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { Alert, AlertDescription, Button, Dialog, DialogContent, DialogHeader, DialogTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tabs, TabsContent, TabsList, TabsTrigger } from '@databricks/appkit-ui/react';
import { Eye, ScanSearch, Send, ShieldAlert, Trash2, Upload } from 'lucide-react';
import { EmptyState, ErrorState, Loading, PageHeader, Section, fmtTime, notify } from '@/components/common';
import { CodeView } from '@/components/common/CodeView';
import { SsisViewer } from '@/components/flow/SsisViewer';
import { api, ApiError } from '@/lib/api';
import { useApi, useJobPoll } from '@/lib/poll';

interface UploadRow {
  name: string;
  size: number;
  modified: number | null;
  meta: { uploaded_by?: string; ts?: string; sha256?: string; size?: number; sent_to_genie_migrate?: string } | null;
}
interface Uploads {
  folder: string;
  files: UploadRow[];
  scan: { scan_id?: string; artifacts?: number; packages: string[]; table_rows: Record<string, number>; errors: string[] } | null;
  scan_enabled: boolean;
}

const ACCEPT = '.sql,.dtsx,.yml,.yaml,.txt,.xml';
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const cell = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v as string | number | boolean));

function InventoryTable() {
  const inv = useApi<Array<Record<string, unknown>>>('/api/uploads/scan-table/estate_inventory');
  if (inv.loading && !inv.data) return <Loading rows={3} />;
  if (inv.error) return <ErrorState error={inv.error} retry={() => void inv.reload()} />;
  const rows = inv.data ?? [];
  if (!rows.length) return <EmptyState title="Nothing scanned yet" />;
  const cols = Object.keys(rows[0]).filter((k) => !/sha|scan_id|scanned_at|path$/i.test(k)).slice(0, 8);
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {cols.map((c) => (
              <TableHead key={c}>{c.replace(/_/g, ' ')}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              {cols.map((c) => (
                <TableCell key={c} className="max-w-72 truncate text-sm" title={cell(r[c])}>
                  {cell(r[c])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function OwnCodePage() {
  const up = useApi<Uploads>('/api/uploads');
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [view, setView] = useState<{ name: string; content: string } | null>(null);
  const [scanJob, setScanJob] = useState<number | null>(null);
  const [scanKey, setScanKey] = useState(0);
  const { status: scanStatus } = useJobPoll(scanJob, () => {
    void up.reload();
    setScanKey((k) => k + 1);
  });

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    let ok = 0;
    for (const [i, f] of Array.from(files).entries()) {
      setProgress(`Uploading ${i + 1} of ${files.length}: ${f.name}`);
      try {
        if (f.size > 8 * 1024 * 1024) throw new Error('larger than 8 MB');
        await api.post('/api/uploads', { name: f.name, content_base64: toBase64(await f.arrayBuffer()) });
        ok++;
      } catch (e) {
        notify.error(`${f.name}: ${(e as Error).message}`);
      }
    }
    setProgress(null);
    if (input.current) input.current.value = '';
    if (ok) notify.ok(`${ok} file(s) uploaded to your team folder.`);
    await up.reload();
  };
  const open = async (name: string) => {
    try {
      const r = await api.get<{ name: string; content: string }>(`/api/uploads/file/${encodeURIComponent(name)}`);
      setView(r);
    } catch (e) {
      notify.error((e as Error).message);
    }
  };
  const toGenie = async (name: string) => {
    setBusy(name);
    try {
      const r = await api.post<{ path: string }>(`/api/uploads/file/${encodeURIComponent(name)}/to-genie-migrate`);
      notify.ok(`Copied to your Genie Migrate input: ${r.path}`);
      await up.reload();
    } catch (e) {
      notify.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const del = async (name: string) => {
    if (!window.confirm(`Delete ${name} from your team folder?`)) return;
    setBusy(name);
    try {
      const r = await fetch(`/api/uploads/file/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`);
      await up.reload();
    } catch (e) {
      notify.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const scan = async () => {
    try {
      const r = await api.post<{ job_run_id: number; run_label: string }>('/api/uploads/scan');
      setScanJob(r.job_run_id);
      notify.info('Scanning your code (about a minute). Parsing only: nothing is executed.');
    } catch (e) {
      notify.error(e instanceof ApiError ? e.message : `Could not start the scan: ${(e as Error).message}`);
    }
  };

  const scanning = Boolean(scanStatus && ['queued', 'running'].includes(scanStatus.state)) || (scanJob !== null && !scanStatus);
  const d = up.data;
  return (
    <div className="space-y-4">
      <PageHeader title="Your own code" kicker="Optional: bring your own SSIS packages, SQL and DDL" />
      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertDescription>
          <p>
            Only if your team wants to. Files go to <b>your team&rsquo;s folder</b> in this workspace (your team and the facilitators can see them) and are never run. Remove passwords or keys before
            uploading: diagrams mask connection secrets, but the files themselves are stored as you upload them. Delete them any time.
          </p>
        </AlertDescription>
      </Alert>

      <Section
        title="Upload"
        description=".sql (procedures, views, DDL), .dtsx (SSIS packages), .yml/.yaml (framework config), .txt/.xml. Up to 8 MB each."
        actions={
          <>
            <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => void uploadFiles(e.target.files)} aria-label="Choose files to upload" />
            <Button size="sm" disabled={Boolean(progress)} onClick={() => input.current?.click()}>
              <Upload className="mr-1 h-4 w-4" /> Choose files
            </Button>
          </>
        }
      >
        {progress && <div className="mb-2 text-sm text-muted-foreground">{progress}</div>}
        {up.loading && !d ? (
          <Loading rows={3} />
        ) : up.error ? (
          <ErrorState error={up.error} retry={() => void up.reload()} />
        ) : !d?.files.length ? (
          <EmptyState title="No files uploaded">Nothing is needed here unless your team wants to work on its own code.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead>Genie Migrate input</TableHead>
                  <TableHead className="w-48" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.files.map((f) => (
                  <TableRow key={f.name}>
                    <TableCell className="font-medium">{f.name}</TableCell>
                    <TableCell className="text-muted-foreground">{kb(f.size)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {fmtTime(f.meta?.ts)} · {f.meta?.uploaded_by?.split('@')[0]}
                    </TableCell>
                    <TableCell className="text-xs">{f.meta?.sent_to_genie_migrate ? <span className="text-emerald-700">copied</span> : <span className="text-muted-foreground">not yet</span>}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => void open(f.name)} aria-label={`View ${f.name}`}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy === f.name} onClick={() => void toGenie(f.name)} title="Copy to your Genie Migrate input folder" aria-label={`Send ${f.name} to Genie Migrate`}>
                        <Send className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy === f.name} onClick={() => void del(f.name)} aria-label={`Delete ${f.name}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-2 text-xs text-muted-foreground">
              Convert these with Genie Migrate (send them to your input folder, then use <Link className="underline" to="/task2">Task 2</Link> to import the result), or pick “Your uploads” as the source of an AI draft in Task 2.
            </div>
          </div>
        )}
      </Section>

      <Section
        title="Scan for SSIS diagrams and an inventory"
        description="Parses your uploaded packages, SQL and Agent scripts (nothing is executed) into the same diagram view and inventory as the workshop estate."
        actions={
          d?.scan_enabled ? (
            <Button size="sm" disabled={scanning || !d.files.length} onClick={() => void scan()}>
              <ScanSearch className="mr-1 h-4 w-4" /> {scanning ? 'Scanning…' : d.scan ? 'Scan again' : 'Scan my code'}
            </Button>
          ) : undefined
        }
      >
        {!d?.scan_enabled && <div className="text-sm text-muted-foreground">Scanning isn&rsquo;t set up in this workspace; ask the facilitator to scan your files.</div>}
        {scanStatus && !['queued', 'running'].includes(scanStatus.state) && scanStatus.state !== 'completed' && scanStatus.state !== 'passed' && (
          <div className="mb-2 rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-900">The scan failed{scanStatus.reason ? `: ${scanStatus.reason}` : '.'}</div>
        )}
        {d?.scan ? (
          <Tabs defaultValue="diagram">
            <TabsList>
              <TabsTrigger value="diagram">SSIS diagrams ({d.scan.packages.length})</TabsTrigger>
              <TabsTrigger value="inventory">Inventory ({d.scan.table_rows.estate_inventory ?? 0})</TabsTrigger>
              {d.scan.errors.length > 0 && <TabsTrigger value="errors">Couldn&rsquo;t parse ({d.scan.errors.length})</TabsTrigger>}
            </TabsList>
            <TabsContent value="diagram">
              {d.scan.packages.length ? (
                <SsisViewer key={scanKey} listPath="/api/uploads/graphs" graphPathFor={(id) => `/api/uploads/graph/${encodeURIComponent(id)}`} refreshKey={scanKey} />
              ) : (
                <EmptyState title="No SSIS packages in your uploads">Upload .dtsx files to see their control and data flow.</EmptyState>
              )}
            </TabsContent>
            <TabsContent value="inventory">
              <InventoryTable key={scanKey} />
            </TabsContent>
            <TabsContent value="errors">
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {d.scan.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </TabsContent>
          </Tabs>
        ) : (
          d?.scan_enabled && <EmptyState title="Not scanned yet">Upload files, then press “Scan my code”.</EmptyState>
        )}
      </Section>

      <Dialog open={Boolean(view)} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{view?.name}</DialogTitle>
          </DialogHeader>
          {view && <CodeView value={view.content} name={view.name} height="560px" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
