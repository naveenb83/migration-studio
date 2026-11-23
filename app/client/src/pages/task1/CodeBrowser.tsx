/** Read-only browser over the pack's legacy folder. Files are shown as text in CodeMirror (never as HTML). */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, File, Folder } from 'lucide-react';
import { CodeView, type LineSelection } from '@/components/common/CodeView';
import { FileActions } from './FileActions';
import { EmptyState, ErrorState, Loading } from '@/components/common';
import { useApi } from '@/lib/poll';

interface TreeFile {
  path: string;
  size: number;
}

interface FileBody {
  path: string;
  content: string;
  truncated: boolean;
}

interface DirNode {
  name: string;
  path: string;
  dirs: Map<string, DirNode>;
  files: TreeFile[];
}

function buildDirTree(files: TreeFile[]): DirNode {
  const root: DirNode = { name: '', path: '', dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let cur = root;
    parts.slice(0, -1).forEach((seg, i) => {
      const path = parts.slice(0, i + 1).join('/');
      let next = cur.dirs.get(seg);
      if (!next) {
        next = { name: seg, path, dirs: new Map(), files: [] };
        cur.dirs.set(seg, next);
      }
      cur = next;
    });
    cur.files.push(f);
  }
  return root;
}

export function CodeBrowser() {
  const tree = useApi<TreeFile[]>('/api/pack/tree?dir=legacy');
  const [selected, setSelectedRaw] = useState<string | null>(null);
  const [sel, setSel] = useState<LineSelection | null>(null);
  const setSelected = (p: string) => {
    setSelectedRaw(p);
    setSel(null);
  };
  const file = useApi<FileBody>(selected ? `/api/pack/file?path=${encodeURIComponent(selected)}` : null, [selected]);
  const root = useMemo(() => buildDirTree(tree.data ?? []), [tree.data]);

  if (tree.loading && !tree.data) return <Loading label="Loading files" />;
  if (tree.error) return <ErrorState error={tree.error} retry={() => void tree.reload()} />;
  if (!tree.data || tree.data.length === 0) return <EmptyState title="No legacy files in this pack" />;

  return (
    <div className="grid gap-4 md:grid-cols-[300px_1fr]">
      <nav aria-label="Legacy files" className="max-h-[560px] overflow-auto rounded-md border p-2 text-sm">
        <DirView node={root} depth={0} selected={selected} onSelect={setSelected} />
      </nav>
      <div className="min-w-0">
        {!selected ? (
          <EmptyState title="Pick a file">Its contents appear here, read only.</EmptyState>
        ) : file.loading ? (
          <Loading label="Opening file" rows={6} />
        ) : file.error ? (
          <ErrorState error={file.error} retry={() => void file.reload()} />
        ) : file.data ? (
          <div className="space-y-2">
            <div className="break-all font-mono text-xs text-muted-foreground">{file.data.path}</div>
            <FileActions path={file.data.path} sel={sel} />
            {file.data.truncated && <div className="text-xs text-amber-800">Shown up to the first 600 KB.</div>}
            <CodeView value={file.data.content} name={selected} height="520px" onSelectLines={setSel} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DirView({ node, depth, selected, onSelect }: { node: DirNode; depth: number; selected: string | null; onSelect: (p: string) => void }) {
  return (
    <ul className="space-y-0.5">
      {[...node.dirs.values()].map((d) => (
        <DirItem key={d.path} dir={d} depth={depth} selected={selected} onSelect={onSelect} />
      ))}
      {node.files.map((f) => {
        const name = f.path.split('/').pop() ?? f.path;
        const active = selected === f.path;
        return (
          <li key={f.path}>
            <button
              type="button"
              onClick={() => onSelect(f.path)}
              aria-current={active ? 'true' : undefined}
              className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-800 ${active ? 'bg-sky-100 font-medium dark:bg-sky-950' : ''}`}
              style={{ paddingLeft: 6 + depth * 12 + 18 }}
              title={f.path}
            >
              <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{name}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function DirItem({ dir, depth, selected, onSelect }: { dir: DirNode; depth: number; selected: string | null; onSelect: (p: string) => void }) {
  const [open, setOpen] = useState(depth < 1);
  return (
    <li>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-800" style={{ paddingLeft: 6 + depth * 12 }}>
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <Folder className="h-3.5 w-3.5 shrink-0 text-amber-600" />
        <span className="truncate font-medium">{dir.name}</span>
      </button>
      {open && <DirView node={dir} depth={depth + 1} selected={selected} onSelect={onSelect} />}
    </li>
  );
}
