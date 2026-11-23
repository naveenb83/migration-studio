import { Badge, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@databricks/appkit-ui/react';
import type { RunRow } from '@/lib/types';
import { fmtTime } from '@/components/common';
import { KIND_LABEL } from './model';

export function RunPicker({ runs, value, onChange }: { runs: RunRow[]; value: string | null; onChange: (label: string) => void }) {
  const selected = runs.find((r) => r.run_label === value);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select value={value ?? undefined} onValueChange={onChange}>
        <SelectTrigger className="w-full md:w-[34rem]" aria-label="Choose a labelled run">
          <SelectValue placeholder="Choose a run" />
        </SelectTrigger>
        <SelectContent>
          {runs.map((r) => (
            <SelectItem key={r.run_label} value={r.run_label}>
              {`${KIND_LABEL[r.kind]} · ${r.run_label} · ${fmtTime(r.run_ts)}${r.apply_accepted ? ' · SIMULATED' : ''}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selected && (
        <Badge variant="outline">
          {KIND_LABEL[selected.kind]}
        </Badge>
      )}
      {selected?.apply_accepted && (
        <Badge variant="outline" className="border-dashed">
          SIMULATED classroom run: accepted differences applied
        </Badge>
      )}
    </div>
  );
}
