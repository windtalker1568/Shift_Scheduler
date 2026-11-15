import {
  BASE_HOURS,
  GROUPS,
  GROUP_LABEL,
  HOUR,
  NIGHT_SHIFT_CODE,
  addDays,
  debenhamsGroupFor,
  defaultReq,
  entryWindow,
  groupClassification,
  groupSegment,
  mostCommonShift,
  reqKey,
  shiftStartMs,
  weekdayOf,
  type EntrySource,
  type EntryType,
  type Group,
  type Reason,
  type Req,
  type Segment,
  type ShiftDef,
} from '../../../shared/domain';
import { computeCoverage, type CoverageCell } from './coverage';

export interface SAdvisor {
  id: string;
  teamId: string;
  segment: Segment;
  home: Group;
}
export interface SEntry {
  personId: string;
  date: string;
  type: EntryType;
  shiftCode?: string;
  otHours?: number;
  locked?: boolean;
  workGroup?: Group;
  reason?: Reason;
  source?: EntrySource;
}
export interface SchedulerSettings {
  weeklyOffDays: number;
  minRestHours: number;
  maxConsecutiveWorkingDays: number;
}
export interface SchedulerHistory {
  lastWeekShift: Record<string, string>;
  nightsLastWeek: Set<string>;
  crossCounts: Record<string, number>;
}
export interface SchedulerInput {
  dates: string[]; // the 7 days of the week
  advisors: SAdvisor[];
  shifts: ShiftDef[]; // advisor shifts
  requirements: Record<string, Req>;
  fixedEntries: SEntry[]; // locked cells, leave and manual days off: never changed
  neighbourEntries: SEntry[]; // entries outside the week (previous/next weeks) for rest and consecutive-day checks
  settings: SchedulerSettings;
  history?: SchedulerHistory;
}
export interface Shortfall {
  group: Group;
  date: string;
  shiftCode: string;
  min: number;
  scheduled: number;
  why: string;
}
export interface FeasibilityRow {
  group: Group;
  advisors: number;
  availablePersonDays: number;
  minPersonDays: number;
  targetPersonDays: number;
  shortForMin: number; // extra advisors needed to reach the minimum
  shortForTarget: number;
  spareForTarget: number; // advisors beyond what the target needs
}
export interface AdvisorPlan {
  entries: SEntry[]; // generated entries only (fixed cells are not repeated)
  surplus: { personId: string; date: string }[];
  coverage: CoverageCell[];
  shortfalls: Shortfall[];
  feasibility: FeasibilityRow[];
  notes: string[];
  stats: { crossSegment: number; leftover: number; surplus: number };
}

const byTeamThenId = (a: SAdvisor, b: SAdvisor) => a.teamId.localeCompare(b.teamId) || a.id.localeCompare(b.id);

/** All ways to choose `k` of the given day indexes. */
function combos(days: number[], k: number): number[][] {
  if (k === 0) return [[]];
  if (days.length < k) return [];
  const [first, ...rest] = days;
  return [...combos(rest, k - 1).map((c) => [first, ...c]), ...combos(rest, k)];
}
const isBlock = (c: number[]) => c.every((v, i) => i === 0 || v === c[i - 1] + 1);

export function generateAdvisorWeek(inp: SchedulerInput): AdvisorPlan {
  const { dates, advisors, shifts, settings } = inp;
  const hist = inp.history ?? { lastWeekShift: {}, nightsLastWeek: new Set<string>(), crossCounts: {} };
  const minRestMs = settings.minRestHours * HOUR;
  const key = (pid: string, date: string) => `${pid}|${date}`;
  const reqOf = (g: Group, code: string, date: string): Req => inp.requirements[reqKey(g, code, weekdayOf(date))] ?? defaultReq(g);

  const fixed = new Map<string, SEntry>(inp.fixedEntries.map((e) => [key(e.personId, e.date), e]));
  const outside = new Map<string, SEntry>(inp.neighbourEntries.map((e) => [key(e.personId, e.date), e]));
  const plan = new Map<string, SEntry>();
  const entryAt = (pid: string, date: string) => plan.get(key(pid, date)) ?? fixed.get(key(pid, date)) ?? outside.get(key(pid, date));
  const isFixedOff = (pid: string, date: string) => {
    const f = fixed.get(key(pid, date));
    return !!f && f.type !== 'SHIFT';
  };
  const wouldExceedConsecutiveDays = (pid: string, date: string) => {
    let run = 1;
    for (let i = 1; i <= 14 && entryAt(pid, addDays(date, -i))?.type === 'SHIFT'; i++) run++;
    for (let i = 1; i <= 14 && entryAt(pid, addDays(date, i))?.type === 'SHIFT'; i++) run++;
    return run > settings.maxConsecutiveWorkingDays;
  };
  const advisorById = new Map(advisors.map((a) => [a.id, a]));

  // counts of who is working where (group | shift | day index), plus team and fairness trackers
  const count = new Map<string, number>();
  const cnt = (g: Group, code: string, d: number) => count.get(`${g}|${code}|${d}`) ?? 0;
  const bump = (g: Group, code: string, d: number) => count.set(`${g}|${code}|${d}`, cnt(g, code, d) + 1);
  const teamOn = new Map<string, number>();
  const weekShift = new Map<string, string>();
  const nightsThis = new Map<string, number>();
  const register = (a: SAdvisor, code: string, d: number, group: Group) => {
    bump(group, code, d);
    const tk = `${a.teamId}|${d}|${code}`;
    teamOn.set(tk, (teamOn.get(tk) ?? 0) + 1);
    weekShift.set(a.id, code);
    if (code === NIGHT_SHIFT_CODE) nightsThis.set(a.id, (nightsThis.get(a.id) ?? 0) + 1);
  };
  for (const e of inp.fixedEntries) {
    const a = advisorById.get(e.personId);
    const d = dates.indexOf(e.date);
    if (a && d >= 0 && e.type === 'SHIFT' && e.shiftCode) register(a, e.shiftCode, d, e.workGroup ?? a.home);
  }

  // ---------- 1. weekly days off, placed where demand is lowest ----------
  const offDays = new Map<string, Set<number>>();
  for (const g of GROUPS) {
    const advs = advisors.filter((a) => a.home === g).sort(byTeamThenId);
    if (!advs.length) continue;
    const slack = dates.map((date) => {
      const supply = advs.filter((a) => !isFixedOff(a.id, date)).length;
      const demand = shifts.reduce((s, sh) => s + reqOf(g, sh.code, date).target, 0);
      return supply - demand;
    });
    for (const a of advs) {
      const fixedOff = dates.filter((dt) => isFixedOff(a.id, dt)).length;
      const need = Math.max(0, settings.weeklyOffDays - fixedOff);
      const chosen = new Set<number>();
      if (need > 0) {
        const freeDays = dates.map((_, i) => i).filter((i) => !fixed.has(key(a.id, dates[i])));
        let best: number[] | null = null;
        let bestScore = -Infinity;
        for (const c of combos(freeDays, need)) {
          const off = new Set(c);
          let run = 0;
          let valid = true;
          for (let i = -7; i < dates.length + 7; i++) {
            const date = addDays(dates[0], i);
            let working: boolean;
            if (i >= 0 && i < dates.length) {
              const fixedEntry = fixed.get(key(a.id, date));
              working = fixedEntry ? fixedEntry.type === 'SHIFT' : !off.has(i);
            } else {
              working = outside.get(key(a.id, date))?.type === 'SHIFT';
            }
            run = working ? run + 1 : 0;
            if (run > settings.maxConsecutiveWorkingDays) {
              valid = false;
              break;
            }
          }
          if (!valid) continue;
          const score = c.reduce((s, i) => s + slack[i], 0) + (isBlock(c) ? 1.5 : 0);
          if (score > bestScore) {
            bestScore = score;
            best = c;
          }
        }
        if (!best) best = [...freeDays].sort((x, y) => slack[y] - slack[x] || x - y).slice(0, need);
        best.forEach((i) => {
          chosen.add(i);
          slack[i]--;
        });
      }
      offDays.set(a.id, chosen);
    }
  }

  // ---------- 2. day by day: assign shift and work group ----------
  const surplus: { personId: string; date: string }[] = [];
  const stats = { crossSegment: 0, leftover: 0, surplus: 0 };
  const shiftByCode = new Map(shifts.map((s) => [s.code, s]));

  for (let d = 0; d < dates.length; d++) {
    const date = dates[d];
    const pool = new Map<string, SAdvisor>();
    for (const a of advisors) {
      if (fixed.has(key(a.id, date)) || offDays.get(a.id)?.has(d)) continue;
      pool.set(a.id, a);
    }
    for (const a of [...pool.values()]) {
      if (!wouldExceedConsecutiveDays(a.id, date)) continue;
      plan.set(key(a.id, date), { personId: a.id, date, type: 'OFF', source: 'AUTO' });
      pool.delete(a.id);
    }

    const feasible = (a: SAdvisor, sh: ShiftDef) => {
      if (wouldExceedConsecutiveDays(a.id, date)) return false;
      const start = shiftStartMs(date, sh.startTime);
      const end = start + BASE_HOURS * HOUR;
      const prev = entryAt(a.id, addDays(date, -1));
      const pw = prev?.type === 'SHIFT' ? entryWindow(prev) : null;
      if (pw && start - pw.end < minRestMs) return false;
      const next = entryAt(a.id, addDays(date, 1));
      const nw = next?.type === 'SHIFT' ? entryWindow(next) : null;
      if (nw && nw.start - end < minRestMs) return false;
      return true;
    };
    const cost = (a: SAdvisor, sh: ShiftDef) => {
      let c = 0;
      const last = weekShift.get(a.id);
      if (last) c += last === sh.code ? 0 : 10; // stay on the same shift within the week
      else if (hist.lastWeekShift[a.id] === sh.code) c += 3; // rotate compared with last week
      if (sh.code === NIGHT_SHIFT_CODE) {
        if (hist.nightsLastWeek.has(a.id)) c += 30; // avoid nights in consecutive weeks
        c += 2 * (nightsThis.get(a.id) ?? 0);
      }
      c -= 2 * Math.min(4, teamOn.get(`${a.teamId}|${d}|${sh.code}`) ?? 0); // keep teams together
      return c;
    };
    const assign = (a: SAdvisor, sh: ShiftDef, group: Group, reason: Reason) => {
      plan.set(key(a.id, date), {
        personId: a.id,
        date,
        type: 'SHIFT',
        shiftCode: sh.code,
        otHours: 0,
        workGroup: group,
        reason: a.home === group ? 'HOME' : reason,
        source: 'AUTO',
      });
      register(a, sh.code, d, group);
      pool.delete(a.id);
    };
    const cellsFor = (level: 'min' | 'target') => {
      const cells: { g: Group; sh: ShiftDef; goal: number }[] = [];
      for (const g of GROUPS)
        for (const sh of shifts) {
          const r = reqOf(g, sh.code, date);
          const goal = level === 'min' ? r.min : r.max === null ? r.target : Math.min(r.target, r.max);
          if (goal - cnt(g, sh.code, d) > 0) cells.push({ g, sh, goal });
        }
      // most constrained cells first
      const room = (c: { g: Group; sh: ShiftDef; goal: number }) =>
        [...pool.values()].filter((a) => a.home === c.g && feasible(a, c.sh)).length - (c.goal - cnt(c.g, c.sh.code, d));
      return cells.map((c) => ({ c, r: room(c) })).sort((x, y) => x.r - y.r).map((x) => x.c);
    };
    const fillHome = (level: 'min' | 'target') => {
      for (const c of cellsFor(level)) {
        while (c.goal - cnt(c.g, c.sh.code, d) > 0) {
          let best: SAdvisor | null = null;
          let bestCost = Infinity;
          for (const a of pool.values()) {
            if (a.home !== c.g || !feasible(a, c.sh)) continue;
            const k = cost(a, c.sh);
            if (k < bestCost || (k === bestCost && best && byTeamThenId(a, best) < 0)) {
              best = a;
              bestCost = k;
            }
          }
          if (!best) break;
          assign(best, c.sh, c.g, 'HOME');
        }
      }
    };
    const ownGap = (h: Group) =>
      shifts.reduce((s, sh) => s + Math.max(0, reqOf(h, sh.code, date).target - cnt(h, sh.code, d)), 0);

    // a) segment priority: fill every minimum with advisors from that group
    fillHome('min');

    // b) business need: groups still under their minimum borrow from the other non-Mirakl segment
    for (const c of cellsFor('min')) {
      if (c.g === 'MIRAKL') continue;
      while (c.goal - cnt(c.g, c.sh.code, d) > 0) {
        let best: SAdvisor | null = null;
        let bestCost = Infinity;
        for (const a of pool.values()) {
          if (a.segment === 'MIRAKL' || a.segment === groupSegment(c.g) || !feasible(a, c.sh)) continue;
          const k =
            cost(a, c.sh) +
            (groupClassification(a.home) === groupClassification(c.g) ? 0 : 2) +
            3 * (hist.crossCounts[a.id] ?? 0) +
            (ownGap(a.home) > 0 ? 6 : 0);
          if (k < bestCost || (k === bestCost && best && byTeamThenId(a, best) < 0)) {
            best = a;
            bestCost = k;
          }
        }
        if (!best) break;
        assign(best, c.sh, c.g, 'CROSS_SEGMENT_NEED');
        stats.crossSegment++;
      }
    }

    // c) raise groups from minimum towards target
    fillHome('target');

    // d) leftover advisors go to the Debenhams group of their own segment (up to its maximum)
    for (const a of [...pool.values()].sort(byTeamThenId)) {
      const tg = debenhamsGroupFor(a.segment);
      if (!tg) continue; // Mirakl advisors are never moved
      let best: ShiftDef | null = null;
      let bestScore = Infinity;
      for (const sh of shifts) {
        if (!feasible(a, sh)) continue;
        const r = reqOf(tg, sh.code, date);
        const n = cnt(tg, sh.code, d);
        if (r.max !== null && n >= r.max) continue;
        const score = (n / Math.max(1, r.target)) * 10 + (r.target === 0 ? 20 : 0) + cost(a, sh);
        if (score < bestScore) {
          bestScore = score;
          best = sh;
        }
      }
      if (best) {
        if (a.home !== tg) stats.leftover++;
        assign(a, best, tg, 'LEFTOVER_TO_DEBENHAMS');
      }
    }

    // e) anyone still unplaced is reported as surplus
    for (const a of pool.values()) {
      surplus.push({ personId: a.id, date });
      stats.surplus++;
    }
  }

  // ---------- 3. output ----------
  const entries: SEntry[] = [];
  for (const a of advisors)
    dates.forEach((date, d) => {
      if (fixed.has(key(a.id, date))) return;
      const e = plan.get(key(a.id, date));
      if (e) entries.push(e);
      else if (offDays.get(a.id)?.has(d)) entries.push({ personId: a.id, date, type: 'OFF', source: 'AUTO' });
    });

  const shiftEntries = [...plan.values(), ...inp.fixedEntries]
    .filter((e) => e.type === 'SHIFT')
    .map((e) => ({ ...e, workGroup: e.workGroup ?? advisorById.get(e.personId)?.home }));
  const coverage = computeCoverage(inp.requirements, shiftEntries, dates, shifts);

  const shortfalls: Shortfall[] = coverage
    .filter((c) => c.status === 'BELOW_MIN')
    .map((c) => {
      const home = advisors.filter((a) => a.home === c.group);
      let off = 0;
      let elsewhere = 0;
      for (const a of home) {
        const e = entryAt(a.id, c.date);
        if (!e || e.type !== 'SHIFT') {
          if (isFixedOff(a.id, c.date) || offDays.get(a.id)?.has(dates.indexOf(c.date))) off++;
        } else if (e.shiftCode !== c.shiftCode || (e.workGroup ?? a.home) !== c.group) elsewhere++;
      }
      const blocked = surplus.filter((s) => s.date === c.date && advisorById.get(s.personId)?.home === c.group).length;
      return {
        group: c.group,
        date: c.date,
        shiftCode: c.shiftCode,
        min: c.min,
        scheduled: c.scheduled,
        why: `${home.length} ${GROUP_LABEL[c.group]} advisors: ${off} off/leave, ${elsewhere} working other shifts or groups, ${blocked} blocked by rest rules`,
      };
    });

  const perAdvisor = dates.length - settings.weeklyOffDays || 1;
  const feasibility: FeasibilityRow[] = GROUPS.map((g) => {
    const advs = advisors.filter((a) => a.home === g);
    let available = 0;
    for (const a of advs) available += dates.length - Math.max(settings.weeklyOffDays, dates.filter((dt) => isFixedOff(a.id, dt)).length);
    let minPD = 0;
    let targetPD = 0;
    for (const date of dates)
      for (const sh of shifts) {
        const r = reqOf(g, sh.code, date);
        minPD += r.min;
        targetPD += r.target;
      }
    return {
      group: g,
      advisors: advs.length,
      availablePersonDays: available,
      minPersonDays: minPD,
      targetPersonDays: targetPD,
      shortForMin: Math.max(0, Math.ceil((minPD - available) / perAdvisor)),
      shortForTarget: Math.max(0, Math.ceil((targetPD - available) / perAdvisor)),
      spareForTarget: Math.max(0, Math.floor((available - targetPD) / perAdvisor)),
    };
  });

  const notes: string[] = [];
  if (stats.crossSegment) notes.push(`${stats.crossSegment} cross-segment assignments were needed to reach minimums.`);
  if (stats.leftover) notes.push(`${stats.leftover} leftover advisor-days were moved onto Debenhams eGain/Sentiment work.`);
  if (stats.surplus) notes.push(`${stats.surplus} advisor-days could not be placed (surplus Mirakl advisors, group maximums, or rest rules).`);
  if (shortfalls.length) notes.push(`${shortfalls.length} group/shift/day cells are below their minimum.`);
  void shiftByCode;
  return { entries, surplus, coverage, shortfalls, feasibility, notes, stats };
}

/** Team leaders follow their team: same shift as the team's advisors on working days. Their days off are spread to the quietest days. */
export function deriveLeaderEntries(p: {
  dates: string[];
  leaders: { leaderId: string; teamId: string }[];
  advisorEntries: SEntry[];
  teamOf: Map<string, string>;
  leaderFixed: SEntry[];
  weeklyOffDays: number;
}): SEntry[] {
  const byTeamDay = new Map<string, string[]>();
  for (const e of p.advisorEntries) {
    if (e.type !== 'SHIFT' || !e.shiftCode) continue;
    const t = p.teamOf.get(e.personId);
    if (!t) continue;
    const k = `${t}|${e.date}`;
    byTeamDay.set(k, [...(byTeamDay.get(k) ?? []), e.shiftCode]);
  }
  const fixed = new Map(p.leaderFixed.map((e) => [`${e.personId}|${e.date}`, e]));
  const out: SEntry[] = [];
  for (const l of p.leaders) {
    const load = p.dates.map((d) => (byTeamDay.get(`${l.teamId}|${d}`) ?? []).length);
    const fixedOff = p.dates.filter((d) => {
      const f = fixed.get(`${l.leaderId}|${d}`);
      return f && f.type !== 'SHIFT';
    }).length;
    const need = Math.max(0, p.weeklyOffDays - fixedOff);
    const free = p.dates.map((_, i) => i).filter((i) => !fixed.has(`${l.leaderId}|${p.dates[i]}`));
    const off = new Set<number>();
    if (need > 0) {
      let best: number[] | null = null;
      let bestLoad = Infinity;
      for (const c of combos(free, need)) {
        const sum = c.reduce((s, i) => s + load[i], 0) + (isBlock(c) ? 0 : 1.5);
        if (sum < bestLoad) {
          bestLoad = sum;
          best = c;
        }
      }
      best?.forEach((i) => off.add(i));
    }
    p.dates.forEach((date, i) => {
      if (fixed.has(`${l.leaderId}|${date}`)) return;
      if (off.has(i)) {
        out.push({ personId: l.leaderId, date, type: 'OFF', source: 'AUTO' });
        return;
      }
      const code = mostCommonShift(byTeamDay.get(`${l.teamId}|${date}`) ?? []);
      if (code) out.push({ personId: l.leaderId, date, type: 'SHIFT', shiftCode: code, otHours: 0, source: 'DERIVED' });
    });
  }
  return out;
}
