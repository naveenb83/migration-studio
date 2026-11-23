/** Mapping: when the app can't work something out on its own. Unknown tables, which converted object replaces which
 * legacy table, and column pairs. Every choice is checked on the server and applies from the next run. */
import { useMemo, useState } from 'react';
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@databricks/appkit-ui/react';
import { ErrorState, Loading, Section, notify } from '@/components/common';
import { api } from '@/lib/api';
import { short, type ConversionInfo, type RunReport } from '@/lib/conversion';
import { useApi } from '@/lib/poll';

const SKIP = '__skip__';
const AUTO = '__auto__';

export function Mapping({ report }: { report: RunReport }) {
  const info = useApi<ConversionInfo>('/api/conversion');
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [outputs, setOutputs] = useState<Record<string, string>>({});
  const [cols, setCols] = useState<Record<string, Record<string, string | null>>>({});
  const [busy, setBusy] = useState(false);

  // objects the converted code created or wrote, from the run itself
  const objects = useMemo(
    () => [...new Set(report.files.flatMap((f) => f.steps.map((s) => s.target)).filter((t): t is string => Boolean(t)))].map((t) => t.split('.').pop() as string),
    [report],
  );
  const ov = info.data?.overrides ?? {};
  const save = async () => {
    setBusy(true);
    try {
      const merged = {
        names: { ...(ov.names ?? {}), ...names },
        outputs: Object.fromEntries(Object.entries({ ...Object.fromEntries(Object.entries(ov.outputs ?? {}).map(([k, v]) => [k, v.split('.').pop() as string])), ...outputs }).filter(([, v]) => v && v !== AUTO)),
        columns: Object.fromEntries(
          // '' = back to automatic: drop the choice
          [...new Set([...Object.keys(ov.columns ?? {}), ...Object.keys(cols)])].map((id) => [
            id,
            Object.fromEntries(Object.entries({ ...((ov.columns ?? {})[id] ?? {}), ...(cols[id] ?? {}) }).filter(([, v]) => v !== '')),
          ]),
        ),
      };
      await api.put('/api/conversion/mapping', merged);
      notify.ok('Mapping saved. It applies from your next run: press Run my files again.');
      setNames({});
      setOutputs({});
      setCols({});
      await info.reload();
    } catch (e) {
      notify.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    setBusy(true);
    try {
      await api.put('/api/conversion/mapping', { names: {}, outputs: {}, columns: {} });
      notify.ok('Mapping cleared: the app matches everything itself again on the next run.');
      await info.reload();
    } catch (e) {
      notify.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const nChoices = Object.keys(ov.names ?? {}).length + Object.keys(ov.outputs ?? {}).length + Object.values(ov.columns ?? {}).reduce((n, c) => n + Object.keys(c).length, 0);
  return (
    <Section
      title="Mapping"
      description="Only when the app couldn't work something out on its own, or got it wrong: an unknown table, which converted object replaces a legacy table, or which column pairs with which. Your choices apply from the next run."
      actions={
        <Button size="sm" variant="outline" onClick={() => setOpen(!open)}>
          {open ? 'Hide' : `Edit mapping${nChoices ? ` (${nChoices} choice${nChoices === 1 ? '' : 's'})` : ''}`}
        </Button>
      }
    >
      {!open ? (
        <div className="text-xs text-muted-foreground">
          {report.unresolved.length > 0
            ? `${report.unresolved.length} unknown table(s) in this run: open the mapping to point them at your tables.`
            : 'Everything in this run was resolved automatically.'}
        </div>
      ) : info.error ? (
        <ErrorState error={info.error} retry={() => void info.reload()} />
      ) : !info.data ? (
        <Loading rows={3} />
      ) : (
        <div className="space-y-5 text-sm">
          {report.unresolved.length > 0 && (
            <div className="space-y-2">
              <div className="font-medium">Unknown tables</div>
              {[...new Set(report.unresolved.map((u) => u.name))].map((n) => (
                <div key={n} className="flex flex-wrap items-center gap-2">
                  <code className="min-w-[14rem]">{n}</code> →
                  <Select value={names[n] ?? ov.names?.[n] ?? ''} onValueChange={(v) => setNames({ ...names, [n]: v })}>
                    <SelectTrigger className="w-[28rem]" aria-label={`Table for ${n}`}>
                      <SelectValue placeholder="Choose one of your tables" />
                    </SelectTrigger>
                    <SelectContent>
                      {info.data!.tables.map((t) => (
                        <SelectItem key={t} value={t}>
                          {short(t)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}
          {report.outputs.map((o) => {
            const convCols = [...new Set([...o.columns.map((c) => c.converted), ...o.unmatched_converted, ...o.ignored_converted])];
            const legacyCols = [...o.columns.map((c) => c.legacy), ...o.unmatched_legacy];
            const current = (ov.outputs ?? {})[o.id]?.split('.').pop();
            return (
              <div key={o.id} className="space-y-2 rounded-md border p-3">
                <div className="font-medium">{o.label}</div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  Converted object that replaces <code>{short(o.legacy_table)}</code>:
                  <Select value={outputs[o.id] ?? current ?? AUTO} onValueChange={(v) => setOutputs({ ...outputs, [o.id]: v })}>
                    <SelectTrigger className="w-[24rem]" aria-label={`Converted object for ${o.label}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={AUTO}>Let the app choose ({o.converted_object ? short(o.converted_object) : 'none found'})</SelectItem>
                      {objects.map((x) => (
                        <SelectItem key={x} value={x}>
                          {x}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {convCols.length > 0 && (
                  <div className="grid gap-1 md:grid-cols-2">
                    {legacyCols.map((l) => {
                      const auto = o.columns.find((c) => c.legacy === l)?.converted;
                      const chosen = cols[o.id]?.[l] !== undefined ? cols[o.id][l] : (ov.columns ?? {})[o.id]?.[l];
                      const value = chosen === undefined ? AUTO : chosen === null ? SKIP : chosen;
                      return (
                        <div key={l} className="flex items-center gap-2 text-xs">
                          <span className="w-44 truncate" title={l}>
                            {l}
                          </span>
                          <Select value={value} onValueChange={(v) => setCols({ ...cols, [o.id]: { ...(cols[o.id] ?? {}), [l]: v === SKIP ? null : v === AUTO ? '' : v } })}>
                            <SelectTrigger className="h-8 w-56" aria-label={`Converted column for ${l}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={AUTO}>auto ({auto ?? 'no match'})</SelectItem>
                              <SelectItem value={SKIP}>don&rsquo;t compare</SelectItem>
                              {convCols.map((c) => (
                                <SelectItem key={c} value={c}>
                                  {c}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => void save()}>
              Save mapping
            </Button>
            <Button variant="outline" disabled={busy || nChoices === 0} onClick={() => void clear()}>
              Clear my choices
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}
