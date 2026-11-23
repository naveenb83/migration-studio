/** Packages and data flows, with the SSIS viewer for the chosen package. */
import { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@databricks/appkit-ui/react';
import { SsisViewer } from '@/components/flow/SsisViewer';
import { EmptyState, ErrorState, Loading } from '@/components/common';
import { useApi } from '@/lib/poll';
import { LANDING_LABEL, landingTone, num } from './shared';

interface PackageRow {
  package_id: string;
  package_name: string;
  rel_path: string;
  format_version: string | null;
  n_executables: number | string | null;
  n_data_flows: number | string | null;
  n_components: number | string | null;
  n_sql: number | string | null;
  scheduled_by: string | null;
  warnings: string | null;
}

interface DataFlowRow {
  package_id: string;
  data_flow: string;
  destination_table: string | null;
  dataset_key: string | null;
  dataset_status: string | null;
  sources: string | null;
  landing: string | null;
  n_components: number | string | null;
}

export function PackagesTab() {
  const pk = useApi<PackageRow[]>('/api/estate/estate_packages');
  const df = useApi<DataFlowRow[]>('/api/estate/estate_dataflows');
  const [picked, setPicked] = useState<string | null>(null);

  if ((pk.loading && !pk.data) || (df.loading && !df.data)) return <Loading label="Loading packages" rows={4} />;
  if (pk.error) return <ErrorState error={pk.error} retry={() => void pk.reload()} />;
  if (df.error) return <ErrorState error={df.error} retry={() => void df.reload()} />;
  if (!pk.data || pk.data.length === 0) return <EmptyState title="No packages scanned yet" />;

  const active = picked ?? pk.data[0].package_id;

  return (
    <div className="space-y-5">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Package</TableHead>
              <TableHead>Format</TableHead>
              <TableHead className="text-right">Executables</TableHead>
              <TableHead className="text-right">Data flows</TableHead>
              <TableHead className="text-right">SQL</TableHead>
              <TableHead>Scheduled by</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pk.data.map((p) => (
              <TableRow key={p.package_id} data-state={p.package_id === active ? 'selected' : undefined}>
                <TableCell className="max-w-xs break-all text-sm">{p.package_name}</TableCell>
                <TableCell className="text-xs">{p.format_version ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{num(p.n_executables)}</TableCell>
                <TableCell className="text-right tabular-nums">{num(p.n_data_flows)}</TableCell>
                <TableCell className="text-right tabular-nums">{num(p.n_sql)}</TableCell>
                <TableCell className="text-xs">{p.scheduled_by ?? '—'}</TableCell>
                <TableCell>
                  <button type="button" className="text-xs underline-offset-2 hover:underline" onClick={() => setPicked(p.package_id)} aria-pressed={p.package_id === active}>
                    Open diagram
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div>
        <div className="mb-2 text-sm font-semibold">Data flows</div>
        {(df.data ?? []).length === 0 ? (
          <EmptyState title="No data flows scanned" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data flow</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead>Dataset</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Lands in</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(df.data ?? []).map((r) => (
                  <TableRow key={`${r.package_id}|${r.data_flow}|${r.destination_table ?? ''}`}>
                    <TableCell className="max-w-xs break-all text-xs">{r.data_flow}</TableCell>
                    <TableCell className="break-all font-mono text-xs">{r.destination_table ?? '—'}</TableCell>
                    <TableCell className="break-all text-xs">{r.dataset_key ?? '—'}</TableCell>
                    <TableCell className="text-xs">{r.dataset_status?.replace(/_/g, ' ') ?? '—'}</TableCell>
                    <TableCell>
                      {r.landing ? (
                        <span className={`rounded border px-1.5 py-0.5 text-xs ${landingTone(r.landing)}`}>{LANDING_LABEL[r.landing] ?? r.landing}</span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 text-sm font-semibold">Diagram: {active}</div>
        <SsisViewer key={active} packageId={active} />
      </div>
    </div>
  );
}
