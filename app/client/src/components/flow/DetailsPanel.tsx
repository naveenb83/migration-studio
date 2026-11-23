/** Side panel: the selected step (SQL, links, component outputs), or the package summary when nothing is selected. */
import { useMemo } from 'react';
import { CodeView } from '@/components/common/CodeView';
import { categoryStyle, ROLE_COLOR, shorten } from './model';
import type { GraphDoc, GraphNode, GraphVariable } from './types';

export function DetailsPanel({ doc, selectedId, onSelect }: { doc: GraphDoc; selectedId: string | null; onSelect: (id: string) => void }) {
  const node = selectedId ? (doc.nodes.find((n) => n.id === selectedId) ?? null) : null;
  return (
    <div className="space-y-3 text-sm">
      {node ? <NodeDetails doc={doc} node={node} onSelect={onSelect} /> : <PackageSummary doc={doc} />}
      <PackageSections doc={doc} onSelect={onSelect} />
    </div>
  );
}

function NodeDetails({ doc, node, onSelect }: { doc: GraphDoc; node: GraphNode; onSelect: (id: string) => void }) {
  const names = useMemo(() => new Map(doc.nodes.map((n) => [n.id, n.name] as const)), [doc]);
  const isComp = node.kind === 'component';
  const cat = categoryStyle(node.category);
  const incoming = doc.edges.filter((e) => e.to === node.id);
  const outgoing = doc.edges.filter((e) => e.from === node.id);
  const edgeLine = (e: (typeof doc.edges)[number], other: string) => {
    const bits = [e.kind === 'precedence' ? (e.value ?? 'success') : e.name ?? 'path', e.expression ? `expr ${shorten(e.expression, 60)}` : null, e.logical_and === false ? 'OR' : null, e.is_error ? 'error path' : null];
    return (
      <li key={e.id}>
        <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => onSelect(other)}>
          {names.get(other) ?? other}
        </button>{' '}
        <span className="text-xs text-muted-foreground">({bits.filter(Boolean).join(' · ')})</span>
      </li>
    );
  };
  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{isComp ? 'Component' : node.kind === 'event_handler' ? 'Event handler' : 'Step'}</div>
        <div className="break-words text-base font-semibold">{node.name}</div>
        <div className="mt-1 flex flex-wrap gap-1 text-xs">
          {!isComp && <span className="rounded px-1.5 py-0.5 text-white" style={{ background: cat.color }}>{cat.label}</span>}
          {isComp && node.role && <span className="rounded px-1.5 py-0.5 text-white" style={{ background: ROLE_COLOR[node.role] ?? '#6b7280' }}>{node.role}</span>}
          {node.disabled && <span className="rounded bg-slate-200 px-1.5 py-0.5">disabled</span>}
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {node.exec_type && (<><dt className="text-muted-foreground">Type</dt><dd className="break-all">{node.exec_type}</dd></>)}
        {node.class_id && (<><dt className="text-muted-foreground">Component</dt><dd className="break-all">{node.class_id}</dd></>)}
        {node.data_flow && (<><dt className="text-muted-foreground">Data Flow task</dt><dd className="break-all">{names.get(node.data_flow) ?? node.data_flow}</dd></>)}
        {node.table && (<><dt className="text-muted-foreground">Table</dt><dd className="break-all">{node.table}</dd></>)}
        {node.connection && (<><dt className="text-muted-foreground">Connection</dt><dd className="break-all">{node.connection}</dd></>)}
      </dl>
      {node.description && <p className="text-xs text-muted-foreground">{node.description}</p>}
      {node.outputs && node.outputs.length > 0 && (
        <div>
          <div className="text-xs font-medium">Outputs</div>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {node.outputs.map((o) => (
              <li key={o.id}>
                {o.name}
                {o.is_error ? ' (error output)' : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      {node.sql ? (
        <div className="space-y-1">
          <div className="text-xs font-medium">SQL</div>
          <CodeView value={node.sql} name="step.sql" height="220px" />
          {node.sql_truncated && (
            <p className="text-xs text-amber-800 dark:text-amber-200">Shown truncated ({node.sql_length} characters in full). The full text is kept in the estate statements table.</p>
          )}
        </div>
      ) : null}
      <div>
        <div className="text-xs font-medium">Runs after / feeds</div>
        {incoming.length + outgoing.length === 0 ? (
          <p className="text-xs text-muted-foreground">No links.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-xs">
            {incoming.map((e) => (
              <li key={`in-${e.id}`} className="text-muted-foreground">
                from{' '}
                <button type="button" className="underline-offset-2 hover:underline" onClick={() => onSelect(e.from)}>
                  {names.get(e.from) ?? e.from}
                </button>{' '}
                ({e.kind === 'precedence' ? (e.value ?? 'success') : (e.name ?? 'path')}
                {e.is_error ? ', error path' : ''})
              </li>
            ))}
            {outgoing.map((e) => (
              <li key={`out-${e.id}`} className="text-muted-foreground">
                to {edgeLine(e, e.to)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PackageSummary({ doc }: { doc: GraphDoc }) {
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">Package</div>
      <div className="break-words text-base font-semibold">{doc.package_name}</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Format</dt>
        <dd>{doc.format_version ?? '—'}</dd>
        <dt className="text-muted-foreground">Encoding</dt>
        <dd>{doc.encoding ?? '—'}</dd>
        <dt className="text-muted-foreground">Steps</dt>
        <dd>{doc.stats.nodes}</dd>
        <dt className="text-muted-foreground">Links</dt>
        <dd>{doc.stats.edges}</dd>
      </dl>
      <p className="text-xs text-muted-foreground">Select a step in the diagram to see its SQL and links.</p>
    </div>
  );
}

function groupByScope(items: GraphVariable[]): Array<[string, GraphVariable[]]> {
  const m = new Map<string, GraphVariable[]>();
  for (const v of items) {
    const k = v.scope ?? 'Package';
    m.set(k, [...(m.get(k) ?? []), v]);
  }
  return [...m.entries()];
}

function PackageSections({ doc, onSelect }: { doc: GraphDoc; onSelect: (id: string) => void }) {
  const handlers = doc.nodes.filter((n) => n.kind === 'event_handler');
  return (
    <div className="space-y-2">
      <details className="rounded-md border p-2" open>
        <summary className="cursor-pointer text-xs font-semibold">Connection managers ({doc.connections.length})</summary>
        <ul className="mt-2 space-y-2 text-xs">
          {doc.connections.map((c) => (
            <li key={c.name}>
              <div className="font-medium">{c.name}</div>
              <div className="text-muted-foreground">
                {[c.creation_name, c.server, c.database].filter(Boolean).join(' · ') || 'no server details'}
              </div>
              {c.connection_string && <code className="block break-all text-[11px]">{c.connection_string}</code>}
              {c.property_expression && <code className="block break-all text-[11px]">{c.property_expression}</code>}
            </li>
          ))}
          {doc.connections.length === 0 && <li className="text-muted-foreground">None recorded.</li>}
        </ul>
        <p className="mt-2 text-[11px] text-muted-foreground">Passwords are masked by the scanner, as delivered.</p>
      </details>
      <details className="rounded-md border p-2">
        <summary className="cursor-pointer text-xs font-semibold">Variables ({doc.variables.length})</summary>
        <div className="mt-2 space-y-2 text-xs">
          {groupByScope(doc.variables).map(([scope, vars]) => (
            <div key={scope}>
              <div className="font-medium text-muted-foreground">{scope}</div>
              <ul className="space-y-0.5">
                {vars.map((v) => (
                  <li key={`${scope}-${v.name}`} className="break-all">
                    <span className="font-mono">{v.name}</span>
                    {v.data_type ? <span className="text-muted-foreground"> ({v.data_type})</span> : null}
                    {v.value !== null && v.value !== undefined && v.value !== '' ? <span> = {shorten(v.value, 120)}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {doc.variables.length === 0 && <div className="text-muted-foreground">None recorded.</div>}
        </div>
      </details>
      <details className="rounded-md border p-2">
        <summary className="cursor-pointer text-xs font-semibold">Parameters ({doc.parameters.length})</summary>
        <ul className="mt-2 space-y-0.5 text-xs">
          {doc.parameters.map((p) => (
            <li key={p.name} className="break-all">
              <span className="font-mono">{p.name}</span>
              {p.value ? <span> = {shorten(p.value, 120)}</span> : null}
            </li>
          ))}
          {doc.parameters.length === 0 && <li className="text-muted-foreground">None recorded.</li>}
        </ul>
      </details>
      <details className="rounded-md border p-2">
        <summary className="cursor-pointer text-xs font-semibold">Event handlers ({handlers.length})</summary>
        <ul className="mt-2 space-y-1 text-xs">
          {handlers.map((h) => (
            <li key={h.id}>
              <button type="button" className="underline-offset-2 hover:underline" onClick={() => onSelect(h.id)}>
                {h.name}
              </button>
            </li>
          ))}
          {handlers.length === 0 && <li className="text-muted-foreground">None recorded.</li>}
        </ul>
      </details>
      {doc.warnings.length > 0 && (
        <details className="rounded-md border border-amber-300 p-2" open>
          <summary className="cursor-pointer text-xs font-semibold">Scanner warnings ({doc.warnings.length})</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
            {doc.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
