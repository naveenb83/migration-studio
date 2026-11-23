import { Badge, Checkbox, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@databricks/appkit-ui/react';
import type { RuleTemplate } from '@/lib/types';
import { CodeView } from '@/components/common/CodeView';
import { EmptyState } from '@/components/common';
import { paramValue, sqlPreview, type ParamValues } from './rules';

const MAX_RULES = 3;

interface Props {
  templates: RuleTemplate[];
  selected: string[];
  values: ParamValues;
  yaml: string | null;
  onToggle: (id: string) => void;
  onParam: (id: string, name: string, value: number) => void;
}

export function RuleBuilder({ templates, selected, values, yaml, onToggle, onParam }: Props) {
  if (templates.length === 0) return <EmptyState title="This pack has no rule templates." />;
  const chosen = templates.filter((t) => selected.includes(t.id));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="text-sm text-muted-foreground">Pick 1 to {MAX_RULES} vetted rules. Each one checks a specific thing and records the rows it covers.</div>
        <ul className="space-y-2">
          {templates.map((t) => {
            const on = selected.includes(t.id);
            const disabled = !on && selected.length >= MAX_RULES;
            return (
              <li key={t.id} className="flex items-start gap-3 rounded-md border p-3">
                <Checkbox id={`tpl-${t.id}`} checked={on} disabled={disabled} onCheckedChange={() => onToggle(t.id)} aria-label={t.label} />
                <label htmlFor={`tpl-${t.id}`} className="min-w-0 flex-1 text-sm">
                  <div className="font-medium">{t.label}</div>
                  {t.description && <div className="text-xs text-muted-foreground">{t.description}</div>}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {t.level && <Badge variant="outline">{t.level}</Badge>}
                    {t.severity && <Badge variant="outline">{t.severity}</Badge>}
                    {t.expect && <Badge variant="outline">expect {t.expect}</Badge>}
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
        {chosen.map((t) =>
          (t.params ?? []).length === 0 ? null : (
            <div key={t.id} className="space-y-2 rounded-md bg-muted/40 p-3">
              <div className="text-xs font-medium">Parameters: {t.label}</div>
              {(t.params ?? []).map((p) => (
                <div key={p.name} className="grid grid-cols-[10rem_1fr] items-center gap-2 text-sm">
                  <span>{p.label}</span>
                  {p.options && p.options.length > 0 ? (
                    <Select value={String(paramValue(t, p.name, values))} onValueChange={(v) => onParam(t.id, p.name, Number(v))}>
                      <SelectTrigger className="h-8" aria-label={p.label}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {p.options.map((o) => (
                          <SelectItem key={String(o)} value={String(o)}>
                            {String(o)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      type="number"
                      className="h-8"
                      aria-label={p.label}
                      value={String(paramValue(t, p.name, values))}
                      onChange={(e) => onParam(t.id, p.name, Number(e.target.value))}
                    />
                  )}
                </div>
              ))}
            </div>
          ),
        )}
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {yaml ? 'Rules sent with the last run (read-only)' : 'Selected rule SQL (read-only, before the first run)'}
          <Badge variant="outline">{yaml ? 'from the last run' : 'preview'}</Badge>
        </div>
        {chosen.length === 0 && !yaml ? (
          <EmptyState title="No rule selected" />
        ) : (
          <CodeView value={yaml ?? sqlPreview(selected, templates)} name={yaml ? 'team_rules.recon.yml' : 'rules.sql'} height="360px" />
        )}
        <div className="text-xs text-muted-foreground">Placeholders such as table names are filled in on the server. Free-form SQL is not part of this build.</div>
      </div>
    </div>
  );
}
