import { GROUPS, defaultReq, reqKey, weekdayOf, type Group, type Req, type ShiftDef } from '../../../shared/domain';

export type CoverageStatus = 'BELOW_MIN' | 'BELOW_TARGET' | 'AT_TARGET' | 'ABOVE_TARGET' | 'ABOVE_MAX';
export interface CoverageCell {
  group: Group;
  shiftCode: string;
  date: string;
  min: number;
  target: number;
  max: number | null;
  scheduled: number;
  status: CoverageStatus;
}
export interface CoverageEntry {
  date: string;
  type: string;
  shiftCode?: string | null;
  workGroup?: Group | null;
}

export function statusOf(scheduled: number, r: Req): CoverageStatus {
  if (scheduled < r.min) return 'BELOW_MIN';
  if (scheduled < r.target) return 'BELOW_TARGET';
  if (r.max !== null && scheduled > r.max) return 'ABOVE_MAX';
  if (scheduled > r.target) return 'ABOVE_TARGET';
  return 'AT_TARGET';
}

/** Required (min/target/max) vs scheduled per group, shift and day. Advisor entries only. */
export function computeCoverage(
  reqs: Record<string, Req>,
  entries: CoverageEntry[],
  dates: string[],
  shifts: ShiftDef[],
): CoverageCell[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (e.type !== 'SHIFT' || !e.shiftCode || !e.workGroup) continue;
    const k = `${e.workGroup}|${e.shiftCode}|${e.date}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const cells: CoverageCell[] = [];
  for (const group of GROUPS) {
    for (const sh of shifts) {
      for (const date of dates) {
        const r = reqs[reqKey(group, sh.code, weekdayOf(date))] ?? defaultReq(group);
        const scheduled = counts.get(`${group}|${sh.code}|${date}`) ?? 0;
        if (r.target === 0 && r.min === 0 && scheduled === 0) continue;
        cells.push({ group, shiftCode: sh.code, date, min: r.min, target: r.target, max: r.max, scheduled, status: statusOf(scheduled, r) });
      }
    }
  }
  return cells;
}
