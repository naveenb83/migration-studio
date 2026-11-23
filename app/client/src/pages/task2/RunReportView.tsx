/** What a convert run did: each statement's result, the labelled stand-ins and feeds, and how outputs were matched. */
import { useState } from 'react';
import { Badge, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@databricks/appkit-ui/react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { short, STEP_TONE, type RunReport } from '@/lib/conversion';

const STEP_TEXT: Record<string, string> = { ran: 'ran', failed: 'failed', blocked: 'not run (blocked)', skip: 'skipped' };

export function RunReportView({ report, showMatching = false }: { report: RunReport; showMatching?: boolean }) {
  const [openSql, setOpenSql] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      {report.edge && (
        <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
          <b>Edge cases.</b> {report.edge.explain} Added {report.edge.seed_statements} insert statement(s) to a copy of the source, then ran the legacy logic ({report.edge.legacy_runner.map((x) => x.file.split('/').pop()).join(', ')}) and your converted code on that copy.
        </div>
      )}
      {report.fault && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <b>Planted fault ({report.fault.fault.replace('_', ' ')}).</b> In a copy of your converted output for <i>{report.fault.output}</i>, the app {report.fault.what}. The gate should reject this run and name that row.
        </div>
      )}
      <div>
        <div className="mb-1 text-sm font-medium">What ran</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[30%]">File · statement</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>Creates / writes</TableHead>
              <TableHead>Reads</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.files.flatMap((f) =>
              (f.steps.length ? f.steps : [null]).map((s, i) => {
                const k = `${f.name}#${s?.n ?? 0}`;
                return (
                  <TableRow key={k} className="align-top">
                    <TableCell className="whitespace-normal text-xs">
                      {i === 0 && (
                        <div className="font-medium">
                          {f.name} <code className="text-[10px] text-muted-foreground">{f.sha256.slice(0, 12)}</code>
                        </div>
                      )}
                      {s ? (
                        <button type="button" className="mt-0.5 flex items-start gap-1 text-left text-muted-foreground hover:underline" onClick={() => setOpenSql(openSql === k ? null : k)}>
                          {openSql === k ? <ChevronDown className="mt-0.5 h-3 w-3 shrink-0" /> : <ChevronRight className="mt-0.5 h-3 w-3 shrink-0" />}
                          #{s.n} {s.kind.replace('_', ' ')}
                          {s.from_procedure && <span> (inside {s.from_procedure})</span>}
                        </button>
                      ) : (
                        <div className="text-muted-foreground">no statements: comments only, nothing to run</div>
                      )}
                      {s && openSql === k && (
                        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-[11px]">{s.sql || s.preview}</pre>
                      )}
                    </TableCell>
                    <TableCell className={`whitespace-normal text-xs ${s ? (STEP_TONE[s.status] ?? '') : ''}`}>
                      {s ? STEP_TEXT[s.status] ?? s.status : ''}
                      {s?.reason && <div className="mt-0.5 max-w-md break-words text-[11px] text-muted-foreground">{s.reason}</div>}
                    </TableCell>
                    <TableCell className="whitespace-normal break-all text-xs">{s?.target ? s.target.split('.').pop() : ''}</TableCell>
                    <TableCell className="whitespace-normal text-xs text-muted-foreground">{s ? [...new Set(Object.values(s.reads).map(short))].join(', ') : ''}</TableCell>
                  </TableRow>
                );
              }),
            )}
          </TableBody>
        </Table>
      </div>
      {(report.prep.length > 0 || report.feeds.length > 0) && (
        <div>
          <div className="mb-1 text-sm font-medium">Stand-ins (labelled: not part of your converted code)</div>
          <div className="space-y-1 text-xs">
            {report.prep.map((x) => (
              <div key={x.name} className="rounded border px-2 py-1">
                <Badge variant="outline" className="mr-2">{x.label}</Badge> <code>{x.name}</code> · {x.status === 'ok' ? 'created' : <span className="text-red-700">failed: {x.error}</span>}
                <div className="text-muted-foreground">{x.why}</div>
              </div>
            ))}
            {report.feeds.map((x) => (
              <div key={x.target} className="rounded border px-2 py-1">
                <Badge variant="outline" className="mr-2">{x.label}</Badge> <code>{short(x.target)}</code> ← <code>{short(x.from)}</code> ·{' '}
                {x.status === 'ok' ? `${x.rows ?? '?'} rows (${x.how})` : <span className="text-red-700">failed: {x.error}</span>}
                <div className="text-muted-foreground">{x.why}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {report.unresolved.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          Unknown table(s): {report.unresolved.map((u) => `${u.name} (${u.file} #${u.n})`).join(', ')}. Map them to one of your tables in Validate → Mapping, then run again.
        </div>
      )}
      <div>
        <div className="mb-1 text-sm font-medium">Compared with legacy</div>
        <div className="grid gap-2 md:grid-cols-2">
          {report.outputs.map((o) => (
            <div key={o.id} className="rounded-md border p-2 text-xs">
              <div className="font-medium">{o.label}</div>
              <div className="text-muted-foreground">
                legacy <code>{short(o.legacy_table)}</code> vs converted {o.converted_object ? <code>{short(o.converted_object)}</code> : <span className="text-red-700">not found</span>}
                {o.converted_object && <> ({o.found_by})</>}
              </div>
              {o.rows && (
                <div>
                  rows: legacy {o.rows.legacy} · converted {o.rows.converted}
                </div>
              )}
              <div>
                {o.columns.length} column(s) matched{o.keys.length > 0 && <> · key {o.keys.map((k) => `${k.legacy} = ${k.converted}`).join(', ')}</>}
                {o.unmatched_legacy.length > 0 && <span className="text-amber-800"> · {o.unmatched_legacy.length} legacy column(s) not matched</span>}
              </div>
              {o.error && <div className="text-red-700">{o.error}</div>}
              {showMatching && <MatchingTable output={o} />}
            </div>
          ))}
        </div>
      </div>
      {report.errors.length > 0 && <div className="text-xs text-red-700">{report.errors.join(' · ')}</div>}
    </div>
  );
}

export function MatchingTable({ output }: { output: RunReport['outputs'][number] }) {
  const [all, setAll] = useState(false);
  const rows = all ? output.columns : output.columns.slice(0, 8);
  return (
    <div className="mt-2 space-y-1">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Legacy column</TableHead>
            <TableHead>Converted column</TableHead>
            <TableHead>How matched</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((c) => (
            <TableRow key={c.legacy}>
              <TableCell className="text-xs">
                {c.legacy} {c.key && <Badge variant="outline">key</Badge>}
                <div className="text-[10px] text-muted-foreground">{c.legacy_type}</div>
              </TableCell>
              <TableCell className="text-xs">
                {c.converted}
                <div className="text-[10px] text-muted-foreground">{c.converted_type}</div>
              </TableCell>
              <TableCell className="whitespace-normal text-xs text-muted-foreground">{c.how}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {output.columns.length > 8 && (
        <Button size="sm" variant="ghost" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${output.columns.length}`}
        </Button>
      )}
      {(output.ignored_legacy.length > 0 || output.ignored_converted.length > 0) && (
        <div className="text-[11px] text-muted-foreground">
          Not compared (change on every run: audit columns, current time or user): legacy {output.ignored_legacy.join(', ') || 'none'} · converted {output.ignored_converted.join(', ') || 'none'}
        </div>
      )}
      {output.unmatched_legacy.length > 0 && (
        <div className="text-[11px] text-amber-800">Legacy columns with no converted counterpart: {output.unmatched_legacy.join(', ')}</div>
      )}
      {output.unmatched_converted.length > 0 && (
        <div className="text-[11px] text-muted-foreground">Converted columns not in legacy: {output.unmatched_converted.join(', ')}</div>
      )}
    </div>
  );
}
