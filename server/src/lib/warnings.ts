import { HOUR, addDays, entryWindow, type Designation } from '../../../shared/domain';

export interface WPerson {
  id: string;
  name: string;
  designation: Designation;
  teamId?: string | null;
}
export interface WEntry {
  personId: string;
  date: string;
  type: string;
  shiftCode?: string | null;
  otHours?: number | null;
}
export interface Warning {
  type: 'REST' | 'CONSECUTIVE' | 'NO_WEEKLY_OFF' | 'MIXED_TEAM_SHIFT';
  personId?: string;
  teamId?: string;
  date?: string;
  message: string;
}

/**
 * entries must include the neighbouring weeks (about 7 days either side) so that rest gaps and
 * consecutive working days are checked across week boundaries.
 */
export function computeWarnings(
  people: WPerson[],
  entries: WEntry[],
  dates: string[],
  settings: { minRestHours: number; maxConsecutiveWorkingDays: number },
  teamNumbers: Map<string, number>,
): Warning[] {
  const out: Warning[] = [];
  const at = new Map(entries.map((e) => [`${e.personId}|${e.date}`, e]));
  const inWeek = new Set(dates);
  const from = addDays(dates[0], -7);
  const days = Array.from({ length: 21 }, (_, i) => addDays(from, i));

  for (const p of people) {
    let run = 0;
    let runWarned = false;
    let shiftDays = 0;
    for (const d of days) {
      const e = at.get(`${p.id}|${d}`);
      if (e?.type === 'SHIFT') {
        run++;
        if (inWeek.has(d)) shiftDays++;
        const prev = at.get(`${p.id}|${addDays(d, -1)}`);
        if (prev?.type === 'SHIFT' && inWeek.has(d)) {
          const a = entryWindow(prev);
          const b = entryWindow(e);
          if (a && b && b.start - a.end < settings.minRestHours * HOUR) {
            const gap = Math.round(((b.start - a.end) / HOUR) * 10) / 10;
            out.push({ type: 'REST', personId: p.id, date: d, message: `${p.name}: only ${gap}h rest before ${d} (minimum ${settings.minRestHours}h)` });
          }
        }
        if (run > settings.maxConsecutiveWorkingDays && !runWarned && inWeek.has(d)) {
          runWarned = true;
          out.push({ type: 'CONSECUTIVE', personId: p.id, date: d, message: `${p.name}: ${run} working days in a row by ${d} (maximum ${settings.maxConsecutiveWorkingDays})` });
        }
      } else {
        run = 0;
        runWarned = false;
      }
    }
    if (shiftDays === dates.length) out.push({ type: 'NO_WEEKLY_OFF', personId: p.id, message: `${p.name}: no day off this week` });
  }

  // advisors of one team on different shifts on the same day (the team leader follows the most common one)
  const byTeamDay = new Map<string, Set<string>>();
  for (const p of people) {
    if (p.designation !== 'ADVISOR' || !p.teamId) continue;
    for (const d of dates) {
      const e = at.get(`${p.id}|${d}`);
      if (e?.type !== 'SHIFT' || !e.shiftCode) continue;
      const k = `${p.teamId}|${d}`;
      if (!byTeamDay.has(k)) byTeamDay.set(k, new Set());
      byTeamDay.get(k)!.add(e.shiftCode);
    }
  }
  for (const [k, set] of byTeamDay) {
    if (set.size < 2) continue;
    const [teamId, date] = k.split('|');
    out.push({ type: 'MIXED_TEAM_SHIFT', teamId, date, message: `Team ${teamNumbers.get(teamId) ?? '?'} on ${date}: advisors on different shifts (${[...set].sort().join(', ')})` });
  }
  return out;
}
