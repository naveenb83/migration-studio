/** One React Flow node type for the SSIS viewer: containers (collapsible), executables, and data-flow components. */
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface SsisNodeData extends Record<string, unknown> {
  id: string;
  label: string;
  sub: string;
  color: string;
  variant: 'container' | 'exec' | 'component';
  direction: 'DOWN' | 'RIGHT';
  collapsed: boolean;
  hidden: number;
  disabled: boolean;
  hasSql: boolean;
  errorOutputs: number;
  highlight: boolean;
  onToggle: (id: string) => void;
}

export type SsisFlowNode = Node<SsisNodeData, 'ssis'>;

export function SsisNode({ data, selected }: NodeProps<SsisFlowNode>) {
  const horizontal = data.direction === 'RIGHT';
  const ring = data.highlight ? 'ring-4 ring-amber-300' : selected ? 'ring-2 ring-sky-500' : '';
  const handles = (
    <>
      <Handle type="target" position={horizontal ? Position.Left : Position.Top} className="!h-2 !w-2 !bg-slate-400" />
      <Handle type="source" position={horizontal ? Position.Right : Position.Bottom} className="!h-2 !w-2 !bg-slate-400" />
    </>
  );

  if (data.variant === 'container' && !data.collapsed) {
    return (
      <div
        className={`h-full w-full rounded-lg border-2 border-dashed bg-white/60 dark:bg-slate-900/60 ${ring}`}
        style={{ borderColor: data.color }}
        data-testid="ssis-container"
      >
        {handles}
        <div className="flex items-center gap-2 px-2 pt-1.5">
          <button
            type="button"
            className="nodrag nopan flex items-center gap-1 rounded px-1 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={(e) => {
              e.stopPropagation();
              data.onToggle(data.id);
            }}
            aria-expanded={true}
            aria-label={`Collapse ${data.label}`}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <span className="truncate text-xs font-semibold" title={data.label} style={{ color: data.color }}>
            {data.label}
          </span>
          <span className="ml-auto truncate text-[10px] text-muted-foreground">{data.sub}</span>
        </div>
      </div>
    );
  }

  if (data.variant === 'container') {
    return (
      <div className={`flex h-full w-full items-center gap-2 rounded-lg border-2 bg-white px-2 shadow-sm dark:bg-slate-900 ${ring}`} style={{ borderColor: data.color }}>
        {handles}
        <button
          type="button"
          className="nodrag nopan flex items-center gap-1 rounded px-1 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
          onClick={(e) => {
            e.stopPropagation();
            data.onToggle(data.id);
          }}
          aria-expanded={false}
          aria-label={`Expand ${data.label}`}
        >
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="truncate" title={data.label} style={{ color: data.color }}>
            {data.label}
          </span>
        </button>
        <span className="ml-auto shrink-0 rounded bg-slate-100 px-1.5 text-[10px] text-slate-700 dark:bg-slate-800 dark:text-slate-200">+{data.hidden}</span>
      </div>
    );
  }

  return (
    <div
      className={`relative flex h-full w-full overflow-hidden rounded-md border bg-white shadow-sm dark:bg-slate-900 ${ring} ${data.disabled ? 'opacity-50' : ''}`}
      style={{ borderColor: data.color }}
    >
      {handles}
      <div className="w-1.5 shrink-0" style={{ background: data.color }} />
      <div className="min-w-0 flex-1 px-2 py-1">
        <div className="truncate text-xs font-semibold" title={data.label}>
          {data.label}
        </div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className="truncate" title={data.sub}>
            {data.sub}
          </span>
          {data.hasSql && <span className="shrink-0 rounded bg-sky-100 px-1 text-sky-800 dark:bg-sky-950 dark:text-sky-200">SQL</span>}
          {data.errorOutputs > 0 && <span className="shrink-0 rounded bg-red-100 px-1 text-red-800 dark:bg-red-950 dark:text-red-200">error out</span>}
          {data.disabled && <span className="shrink-0 rounded bg-slate-200 px-1 text-slate-700">disabled</span>}
        </div>
      </div>
    </div>
  );
}
