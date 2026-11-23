/** CodeMirror 6 viewer / editor with SQL + YAML highlighting, and a two-pane diff (merge view). */
import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { yaml } from '@codemirror/lang-yaml';
import { MergeView } from '@codemirror/merge';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useEffect, useRef } from 'react';

export function langFor(name: string) {
  const n = name.toLowerCase();
  if (n.endsWith('.yml') || n.endsWith('.yaml')) return [yaml()];
  if (n.endsWith('.dtsx') || n.endsWith('.xml') || n.endsWith('.json') || n.endsWith('.md')) return [];
  return [sql()];
}

export function CodeView({ value, name = 'x.sql', height = '420px', onChange, readOnly = !onChange }: { value: string; name?: string; height?: string; onChange?: (v: string) => void; readOnly?: boolean }) {
  return (
    <div className="overflow-hidden rounded-md border text-[13px]">
      <CodeMirror value={value} height={height} extensions={langFor(name)} editable={!readOnly} readOnly={readOnly} onChange={onChange} basicSetup={{ lineNumbers: true, foldGutter: true }} />
    </div>
  );
}

/** Side-by-side diff: left = current file, right = proposed content. Read-only. */
export function DiffView({ left, right, name = 'x.sql', height = 420 }: { left: string; right: string; name?: string; height?: number }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const ext = [...langFor(name), EditorState.readOnly.of(true), EditorView.editable.of(false)];
    const mv = new MergeView({ a: { doc: left, extensions: ext }, b: { doc: right, extensions: ext }, parent: host.current, collapseUnchanged: { margin: 3, minSize: 6 } });
    return () => mv.destroy();
  }, [left, right, name]);
  return <div ref={host} className="overflow-auto rounded-md border text-[13px]" style={{ maxHeight: height }} />;
}
