/** Schedule timeline: SQL Agent and Databricks schedules on one 24 h axis. Curation scheduled before its ingest is flagged. */
import { useMemo } from 'react';
import { Badge } from '@databricks/appkit-ui/react';
import { EmptyState, ErrorState, Loading } from '@/components/common';
import { useApi } from '@/lib/poll';
import { isTrue, minutesOf } from './shared';

export interface ScheduleRow {
  source_system: string;
  schedule_name: string;
  job_name: string | null;
  human: string | null;
  weekdays: string | null;
  start_time: string | null;
  timezone: string | null;
  enabled: boolean | string | null;
  tasks: string | null;
  order_flag: string | null;
  artifact_id: string | null;
}

const SOURCE_LABEL: Record<string, string> = { sql_agent: 'SQL Agent', databricks_workflow: 'Databricks workflow', lakeflow_connect: 'Lakeflow Connect' };
const SOURCE_COLOR: Record<string, string> = { sql_agent: '#7c3aed', databricks_workflow: '#0284c7', lakeflow_connect: '#059669' };


const TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

export function TimelineTab() {
  const rows = useApi<ScheduleRow[]>('/api/estate/estate_schedules');
  const sorted = useMemo(
    () =>
      [...(rows.data ?? [])].sort((a, b) => (minutesOf(a.start_time) ?? 9999) - (minutesOf(b.start_time) ?? 9999)),
    [rows.data],
  );
  if (rows.loading && !rows.data) return <Loading label="Loading schedules" rows={4} />;
  if (rows.error) return <ErrorState error={rows.error} retry={() => void rows.reload()} />;
  if (!rows.data || rows.data.length === 0) return <EmptyState title="No schedules yet">The scanner has not found any schedules.</EmptyState>;

  const flagged = sorted.filter((r) => Boolean(r.order_flag));
  const dated = sorted.filter((r) => minutesOf(r.start_time) !== null);
  const undated = sorted.filter((r) => minutesOf(r.start_time) === null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Badge variant={flagged.length > 0 ? 'destructive' : 'secondary'}>
          {flagged.length} schedule order flag{flagged.length === 1 ? '' : 's'} from the scanner
        </Badge>
        <span className="text-xs text-muted-foreground">
          Times are as recorded in each config. Timezones differ, and some are not recorded, so compare across sources with care.
        </span>
      </div>

      <div className="overflow-x-auto rounded-md border p-3">
        <div className="min-w-[760px]">
          <div className="flex items-end">
            <div className="w-72 shrink-0" />
            <div className="relative h-6 flex-1">
              {TICKS.map((h) => (
                <span key={h} className="absolute top-0 -translate-x-1/2 text-[10px] text-muted-foreground" style={{ left: `${(h / 24) * 100}%` }}>
                  {String(h % 24).padStart(2, '0')}:00
                </span>
              ))}
            </div>
          </div>
          {dated.map((r) => {
            const at = minutesOf(r.start_time) ?? 0;
            const isFlag = Boolean(r.order_flag);
            const color = SOURCE_COLOR[r.source_system] ?? '#64748b';
            return (
              <div key={`${r.source_system}-${r.schedule_name}`} className={`flex items-center border-t py-2 ${isFlag ? 'bg-amber-50/70 dark:bg-amber-950/30' : ''}`}>
                <div className="w-72 shrink-0 pr-3">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} aria-hidden />
                    <span className="text-muted-foreground">{SOURCE_LABEL[r.source_system] ?? r.source_system}</span>
                    {!isTrue(r.enabled) && <span className="text-muted-foreground">· disabled</span>}
                  </div>
                  <div className="break-all text-xs font-medium" title={r.schedule_name}>
                    {r.job_name ?? r.schedule_name}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {r.human ?? '—'}
                    {r.timezone ? ` · ${r.timezone}` : ''}
                  </div>
                </div>
                <div className="relative h-8 flex-1 rounded bg-slate-100 dark:bg-slate-800">
                  {TICKS.map((h) => (
                    <span key={h} className="absolute top-0 h-full w-px bg-slate-200 dark:bg-slate-700" style={{ left: `${(h / 24) * 100}%` }} aria-hidden />
                  ))}
                  <span
                    className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${isFlag ? 'border-amber-600' : 'border-white'}`}
                    style={{ left: `${(at / 1440) * 100}%`, background: color }}
                    title={`${r.start_time ?? ''} ${r.schedule_name}`}
                    aria-label={`${r.schedule_name} at ${r.start_time ?? ''}${isFlag ? ', flagged' : ''}`}
                  />
                </div>
              </div>
            );
          })}
          {flagged.length > 0 && (
            <div className="mt-3 space-y-2 border-t pt-3">
              {flagged.map((r) => (
                <div key={`flag-${r.schedule_name}`} className="rounded-md border border-dashed border-amber-500 p-2 text-xs text-amber-900 dark:text-amber-100">
                  <b>Order check:</b> {r.order_flag}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {undated.length > 0 && (
        <div className="text-xs text-muted-foreground">
          Without a start time in the config: {undated.map((r) => r.schedule_name).join(', ')}
        </div>
      )}
    </div>
  );
}
