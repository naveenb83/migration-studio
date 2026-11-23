/**
 * The ONE generic register: an editable grid over the latest entries of one `kind` for the caller's team.
 * Rows save individually (append-only on the server; latest wins). Partner edits appear on the next refresh
 * (every 5 s while visible; the server cache is off).
 */
import { useMemo, useState } from 'react';
import { Button, Checkbox, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Textarea } from '@databricks/appkit-ui/react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi, useInterval } from '@/lib/poll';
import type { EntryRow } from '@/lib/types';
import { EmptyState, ErrorState, Loading, notify } from '../common';

export type Column =
  | { key: string; label: string; type: 'text' | 'longtext'; width?: string; readOnly?: boolean; placeholder?: string }
  | { key: string; label: string; type: 'select'; options: string[]; width?: string; readOnly?: boolean }
  | { key: string; label: string; type: 'check'; width?: string; readOnly?: boolean };

type Payload = Record<string, string | number | boolean | null>;

export interface RegisterProps {
  kind: string;
  columns: Column[];
  /** Rows shown before anything is saved (e.g. pack seeds); key → payload. */
  seed?: Array<{ key: string; payload: Payload; locked?: Record<string, string> }>;
  allowAdd?: boolean;
  allowDelete?: boolean;
  newKey?: () => string;
  onChanged?: (rows: EntryRow<Payload>[]) => void;
  emptyText?: string;
}

export function useEntries<P = Payload>(kind: string) {
  const r = useApi<EntryRow<P>[]>(`/api/entries?kind=${kind}`);
  useInterval(() => {
    if (document.visibilityState === 'visible') void r.reload();
  }, 5000);
  return r;
}

export function Register({ kind, columns, seed = [], allowAdd = true, allowDelete = true, newKey, onChanged, emptyText = 'Nothing saved yet.' }: RegisterProps) {
  const { data, error, loading, reload } = useEntries<Payload>(kind);
  const [drafts, setDrafts] = useState<Record<string, Payload>>({});
  const [extra, setExtra] = useState<string[]>([]);
  const [saving, setSaving] = useState<string | null>(null);

  const rows = useMemo(() => {
    const saved = new Map((data ?? []).map((r) => [r.entry_key, r]));
    const keys = [...seed.map((s) => s.key), ...[...saved.keys()].filter((k) => !seed.some((s) => s.key === k)), ...extra.filter((k) => !saved.has(k))];
    return [...new Set(keys)].map((key) => {
      const s = seed.find((x) => x.key === key);
      const sv = saved.get(key);
      return { key, saved: sv ?? null, base: { ...(s?.payload ?? {}), ...((sv?.payload as Payload) ?? {}) }, locked: s?.locked ?? {} };
    });
  }, [data, seed, extra]);

  const value = (key: string, base: Payload, col: string) => (drafts[key] && col in drafts[key] ? drafts[key][col] : base[col]);
  const set = (key: string, col: string, v: string | boolean) => setDrafts((d) => ({ ...d, [key]: { ...(d[key] ?? {}), [col]: v } }));

  const save = async (key: string, base: Payload) => {
    setSaving(key);
    try {
      const payload = { ...base, ...(drafts[key] ?? {}) };
      await api.post('/api/entries', { kind, entry_key: key, payload });
      setDrafts((d) => {
        const n = { ...d };
        delete n[key];
        return n;
      });
      await reload();
      notify.ok('Saved. Your partner sees it on their next refresh.');
      onChanged?.(data ?? []);
    } catch (e) {
      notify.error((e as Error).message);
    } finally {
      setSaving(null);
    }
  };
  const del = async (key: string) => {
    setSaving(key);
    try {
      await api.post('/api/entries', { kind, entry_key: key, payload: {}, deleted: true });
      setExtra((x) => x.filter((k) => k !== key));
      await reload();
    } catch (e) {
      notify.error((e as Error).message);
    } finally {
      setSaving(null);
    }
  };

  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} retry={reload} />;
  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <EmptyState title={emptyText} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((c) => (
                  <TableHead key={c.key} style={{ width: c.width }}>
                    {c.label}
                  </TableHead>
                ))}
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ key, saved, base, locked }) => {
                const dirty = Boolean(drafts[key] && Object.keys(drafts[key]).length);
                return (
                  <TableRow key={key} className={dirty ? 'bg-amber-50/60 dark:bg-amber-950/30' : undefined}>
                    {columns.map((c) => {
                      const v = value(key, base, c.key);
                      const lockedText = locked[c.key];
                      if (lockedText !== undefined || c.readOnly)
                        return (
                          <TableCell key={c.key} className="align-top text-sm">
                            {lockedText ?? String(v ?? '')}
                          </TableCell>
                        );
                      return (
                        <TableCell key={c.key} className="align-top">
                          {c.type === 'check' ? (
                            <Checkbox checked={Boolean(v)} onCheckedChange={(x) => set(key, c.key, Boolean(x))} aria-label={c.label} />
                          ) : c.type === 'select' ? (
                            <Select value={v ? String(v) : undefined} onValueChange={(x) => set(key, c.key, x)}>
                              <SelectTrigger className="h-8 min-w-28" aria-label={c.label}>
                                <SelectValue placeholder="choose" />
                              </SelectTrigger>
                              <SelectContent>
                                {c.options.map((o) => (
                                  <SelectItem key={o} value={o}>
                                    {o}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : c.type === 'longtext' ? (
                            <Textarea className="min-h-16 text-sm" value={String(v ?? '')} onChange={(e) => set(key, c.key, e.target.value)} placeholder={c.placeholder} aria-label={c.label} />
                          ) : (
                            <Input className="h-8 text-sm" value={String(v ?? '')} onChange={(e) => set(key, c.key, e.target.value)} placeholder={c.placeholder} aria-label={c.label} />
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell className="whitespace-nowrap align-top">
                      <Button size="sm" variant={dirty ? 'default' : 'ghost'} disabled={saving === key || (!dirty && Boolean(saved))} onClick={() => void save(key, base)} aria-label={`Save ${key}`}>
                        <Save className="h-3.5 w-3.5" />
                      </Button>
                      {allowDelete && saved && (
                        <Button size="sm" variant="ghost" disabled={saving === key} onClick={() => void del(key)} aria-label={`Delete ${key}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {saved && <div className="mt-1 max-w-32 truncate text-[10px] text-muted-foreground" title={saved.user_email}>{saved.user_email.split('@')[0]}</div>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {allowAdd && (
        <Button size="sm" variant="outline" onClick={() => setExtra((x) => [...x, newKey ? newKey() : `row_${Date.now().toString(36)}`])}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add row
        </Button>
      )}
    </div>
  );
}
