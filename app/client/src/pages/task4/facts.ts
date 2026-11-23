/**
 * Derives Task 4 history and done-when facts from the team's labelled runs and request log.
 * Fault ids come from the request log when it has the run; otherwise from the run label (a documented fallback).
 */
import type { RunRow } from '@/lib/types';
import { isRecord, tsMs } from '@/pages/task3/model';
import type { Facts } from '@/lib/doneWhen';

export interface RequestRow {
  run_label: string;
  kind: string;
  job_run_id: number;
  user_email: string;
  ts: string;
  params: string;
}

export type FaultTag = { kind: 'clean' } | { kind: 'fault'; fault_id: string } | { kind: 'unknown' };

export interface ProveRow {
  run: RunRow;
  tag: FaultTag;
  blocking: boolean;
  passed: boolean;
}

export interface ProveSummary {
  rows: ProveRow[];
  faultFailed: number;
  repairPassed: number;
  rulesAdded: number;
  faultsTried: Set<string>;
}

function requestHasFault(raw: string): { has: boolean; fault: string | null } {
  try {
    const v: unknown = JSON.parse(raw);
    if (!isRecord(v) || !('fault_id' in v)) return { has: false, fault: null };
    return { has: true, fault: typeof v.fault_id === 'string' ? v.fault_id : null };
  } catch {
    return { has: false, fault: null };
  }
}

export function faultTag(label: string, requests: RequestRow[], faultIds: string[]): FaultTag {
  const req = requests.find((r) => r.run_label === label);
  if (req) {
    const p = requestHasFault(req.params);
    if (p.has) return p.fault ? { kind: 'fault', fault_id: p.fault } : { kind: 'clean' };
  }
  if (/(^|_)clean$/.test(label)) return { kind: 'clean' };
  // Fallback: labels carry the fault id (or its first six characters) after "prove_".
  const hit = faultIds.find((id) => label.includes(`prove_${id}`) || label.endsWith(`_${id.slice(0, 6)}`));
  return hit ? { kind: 'fault', fault_id: hit } : { kind: 'unknown' };
}

export function summarise(runs: RunRow[], requests: RequestRow[], faultIds: string[]): ProveSummary {
  const rows: ProveRow[] = runs
    .filter((r) => r.kind === 'prove')
    .map((run) => {
      const blocking = Number(run.n_blocking) > 0;
      return {
        run,
        tag: faultTag(run.run_label, requests, faultIds),
        blocking,
        passed: !blocking && Number(run.n_error) === 0,
      };
    })
    .sort((a, b) => tsMs(b.run.run_ts) - tsMs(a.run.run_ts));

  // A gate-rejected fault run: a known fault whose run was blocked.
  const faultFails = rows.filter((r) => r.tag.kind === 'fault' && r.blocking);
  const firstFault = faultFails.length ? Math.min(...faultFails.map((r) => tsMs(r.run.run_ts))) : Number.NaN;
  // A clean run that passed after a fault failure.
  const repairPassed = rows.filter((r) => r.tag.kind === 'clean' && r.passed && tsMs(r.run.run_ts) > firstFault).length;

  const faultsTried = new Set<string>();
  for (const r of rows) if (r.tag.kind === 'fault') faultsTried.add(r.tag.fault_id);

  return {
    rows,
    faultFailed: faultFails.length,
    repairPassed,
    rulesAdded: rows.length,
    faultsTried,
  };
}

export function proveFacts(runs: RunRow[], summary: ProveSummary): Facts {
  return {
    runs: {
      recheck: runs.filter((r) => r.kind === 'recheck').length,
      fault_failed: summary.faultFailed,
      repair_passed: summary.repairPassed,
    },
    rules: { added: summary.rulesAdded },
  };
}
