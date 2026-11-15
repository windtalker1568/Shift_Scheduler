import { GROUP_LABEL, DESIGNATION_LABEL, SEGMENT_LABEL, rangeLabel, type Group } from '../../../shared/domain';
import { csvCell } from '../lib/csv';
import { getWeek } from './schedule';

const ORDER: Record<string, number> = { TEAM_LEADER: 0, ADVISOR: 1, QA: 2, TRAINER: 3, MANAGEMENT: 4 };

/** Weekly roster as CSV (opens in Excel). */
export async function weeklyCsv(weekStart: string) {
  const w = await getWeek(weekStart);
  const entry = new Map(w.entries.map((e) => [`${e.personId}|${e.date}`, e]));
  const people = [...w.people].sort((a, b) => (a.teamNumber ?? 9999) - (b.teamNumber ?? 9999) || ORDER[a.designation] - ORDER[b.designation] || a.name.localeCompare(b.name));
  const header = ['Employee ID', 'Name', 'Designation', 'Team', 'Segment', 'Home group', ...w.dates, 'OT hours'];
  const lines = [header.map(csvCell).join(',')];
  for (const p of people) {
    let ot = 0;
    const cells = w.dates.map((d) => {
      const e = entry.get(`${p.id}|${d}`);
      if (!e) return '';
      if (e.type === 'OFF') return 'OFF';
      if (e.type === 'LEAVE') return 'LEAVE';
      ot += e.otHours;
      const wg = e.workGroup && e.workGroup !== p.homeGroup ? ` [${GROUP_LABEL[e.workGroup as Group]}]` : '';
      return `${rangeLabel(d, e.shiftCode!, e.otHours)}${e.otHours ? ` (+${e.otHours}h OT)` : ''}${wg}`;
    });
    lines.push(
      [p.employeeId, p.name, DESIGNATION_LABEL[p.designation], p.teamNumber ?? '', p.segment ? SEGMENT_LABEL[p.segment] : '', p.homeGroup ? GROUP_LABEL[p.homeGroup] : '', ...cells, ot || ''].map(csvCell).join(','),
    );
  }
  return lines.join('\n');
}
