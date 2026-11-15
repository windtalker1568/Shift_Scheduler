import test from 'node:test';
import assert from 'node:assert/strict';
import { generateAdvisorWeek, deriveLeaderEntries, type SAdvisor, type SEntry } from '../src/lib/autoScheduler';
import { ADVISOR_SHIFTS, addDays, reqKey, weekDatesOf, weekdayOf, type Group, type Req, type Segment } from '../../shared/domain';

const WEEK = '2026-11-16'; // a Monday
const dates = weekDatesOf(WEEK);
const settings = { weeklyOffDays: 2, minRestHours: 11, maxConsecutiveWorkingDays: 6 };

function team(prefix: string, teamId: string, segment: Segment, home: Group, n: number): SAdvisor[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, teamId, segment, home }));
}
type RequirementRow = [group: Group, shift: string, target: number, min?: number, max?: number | null];
function reqs(rows: RequirementRow[]): Record<string, Req> {
  const out: Record<string, Req> = {};
  for (const [g, shift, target, min, max] of rows)
    for (let wd = 0; wd < 7; wd++) out[reqKey(g, shift, wd)] = { min: min ?? target, target, max: max === undefined ? (g === 'EGAIN_DEB' || g === 'SENT_DEB' ? null : target) : max };
  return out;
}
const run = (advisors: SAdvisor[], requirements: Record<string, Req>, extra: Partial<Parameters<typeof generateAdvisorWeek>[0]> = {}) =>
  generateAdvisorWeek({ dates, advisors, shifts: ADVISOR_SHIFTS, requirements, fixedEntries: [], neighbourEntries: [], settings, ...extra });
const workingOn = (entries: SEntry[], date: string, group?: Group) =>
  entries.filter((e) => e.date === date && e.type === 'SHIFT' && (!group || e.workGroup === group));

test('meets the target every day and gives each advisor the weekly days off', () => {
  const advisors = team('m', 'T1', 'MIRAKL', 'MIRAKL', 16);
  const plan = run(advisors, reqs([['MIRAKL', '09:00', 8]]));
  for (const d of dates) assert.equal(workingOn(plan.entries, d, 'MIRAKL').length, 8, d);
  for (const a of advisors) assert.ok(plan.entries.filter((e) => e.personId === a.id && e.type === 'OFF').length >= 2, a.id);
  assert.equal(plan.shortfalls.length, 0);
});

test('Mirakl advisors are never moved, and leftover Mirakl advisors are reported as surplus', () => {
  const advisors = [...team('m', 'T1', 'MIRAKL', 'MIRAKL', 12), ...team('e', 'T2', 'EGAIN', 'EGAIN_DEB', 6)];
  const plan = run(advisors, reqs([['MIRAKL', '09:00', 4], ['EGAIN_DEB', '09:00', 4]]));
  assert.ok(plan.entries.filter((e) => e.personId.startsWith('m') && e.type === 'SHIFT').every((e) => e.workGroup === 'MIRAKL'));
  assert.ok(plan.surplus.some((s) => s.personId.startsWith('m')));
  assert.ok(!plan.entries.some((e) => e.personId.startsWith('e') && e.workGroup === 'MIRAKL'));
});

test('segment priority: Sentiment advisors stay on Sentiment when eGain minimum is already met', () => {
  const advisors = [...team('e', 'T1', 'EGAIN', 'EGAIN_DEB', 14), ...team('s', 'T2', 'SENTIMENT', 'SENT_DEB', 14)];
  const plan = run(advisors, reqs([['EGAIN_DEB', '09:00', 8], ['SENT_DEB', '09:00', 8]]));
  assert.equal(plan.stats.crossSegment, 0);
  assert.ok(plan.entries.filter((e) => e.personId.startsWith('s') && e.type === 'SHIFT').every((e) => e.workGroup === 'SENT_DEB'));
});

test('business need: Sentiment advisors cover eGain only when eGain is below its minimum', () => {
  const advisors = [...team('e', 'T1', 'EGAIN', 'EGAIN_DEB', 4), ...team('s', 'T2', 'SENTIMENT', 'SENT_DEB', 20)];
  const plan = run(advisors, reqs([['EGAIN_DEB', '09:00', 8, 8, null], ['SENT_DEB', '12:30', 4]]));
  assert.ok(plan.stats.crossSegment > 0);
  for (const d of dates) assert.ok(workingOn(plan.entries, d, 'EGAIN_DEB').length >= 8, d);
  assert.ok(plan.entries.filter((e) => e.reason === 'CROSS_SEGMENT_NEED').every((e) => e.personId.startsWith('s')));
});

test('leftover advisors are put on Debenhams work in their own segment, Karen Millen leftovers included', () => {
  const advisors = [...team('k', 'T1', 'SENTIMENT', 'SENT_KM', 10), ...team('n', 'T2', 'EGAIN', 'EGAIN_DEB', 10)];
  const plan = run(advisors, reqs([['SENT_KM', '09:00', 2], ['EGAIN_DEB', '08:00', 3]]));
  const kmLeftovers = plan.entries.filter((e) => e.personId.startsWith('k') && e.reason === 'LEFTOVER_TO_DEBENHAMS');
  assert.ok(kmLeftovers.length > 0);
  assert.ok(kmLeftovers.every((e) => e.workGroup === 'SENT_DEB'));
  assert.equal(plan.surplus.length, 0);
});

test('rest rules look across the week boundary (Sunday night shift blocks a Monday 07:00 start)', () => {
  const advisors = team('e', 'T1', 'EGAIN', 'EGAIN_DEB', 6);
  const prevSunday = addDays(WEEK, -1);
  const neighbour: SEntry[] = advisors.map((a) => ({ personId: a.id, date: prevSunday, type: 'SHIFT', shiftCode: '22:00' }));
  const plan = run(advisors, reqs([['EGAIN_DEB', '07:00', 6, 0, null]]), { neighbourEntries: neighbour });
  const monday = plan.entries.filter((e) => e.date === WEEK && e.type === 'SHIFT');
  assert.ok(monday.every((e) => e.shiftCode !== '07:00' && e.shiftCode !== '08:00' && e.shiftCode !== '09:00'));
});

test('days off and generated shifts respect the consecutive-day limit across week boundaries', () => {
  const advisors = team('e', 'T1', 'EGAIN', 'EGAIN_DEB', 8);
  const previousDays = [addDays(WEEK, -2), addDays(WEEK, -1)];
  const nextDay = addDays(WEEK, 7);
  const neighbour: SEntry[] = advisors.flatMap((a) => [
    ...previousDays.map((date) => ({ personId: a.id, date, type: 'SHIFT' as const, shiftCode: '09:00' })),
    { personId: a.id, date: nextDay, type: 'SHIFT' as const, shiftCode: '22:00' },
  ]);
  const plan = run(advisors, reqs([]), {
    neighbourEntries: neighbour,
    settings: { ...settings, weeklyOffDays: 2, maxConsecutiveWorkingDays: 5 },
  });
  for (const advisor of advisors) {
    const entries = plan.entries.filter((e) => e.personId === advisor.id);
    assert.equal(entries.filter((e) => e.type === 'SHIFT').length, 5);
    assert.equal(entries.filter((e) => e.type === 'OFF').length, 2);
    const workingDates = new Set([
      ...neighbour.filter((e) => e.personId === advisor.id).map((e) => e.date),
      ...entries.filter((e) => e.type === 'SHIFT').map((e) => e.date),
    ]);
    let runLength = 0;
    for (const date of [...previousDays, ...dates, nextDay]) {
      if (workingDates.has(date)) {
        runLength++;
        assert.ok(runLength <= 5, `${advisor.id} exceeded five consecutive working days by ${date}`);
      } else {
        runLength = 0;
      }
    }
  }
});

test('locked cells and leave are never changed and still count for coverage', () => {
  const advisors = team('e', 'T1', 'EGAIN', 'EGAIN_DEB', 10);
  const fixedEntries: SEntry[] = [
    { personId: 'e0', date: WEEK, type: 'LEAVE' },
    { personId: 'e1', date: WEEK, type: 'SHIFT', shiftCode: '22:00', locked: true, workGroup: 'EGAIN_DEB' },
  ];
  const plan = run(advisors, reqs([['EGAIN_DEB', '09:00', 3, 3, null]]), { fixedEntries });
  assert.ok(!plan.entries.some((e) => e.date === WEEK && (e.personId === 'e0' || e.personId === 'e1')));
  assert.equal(plan.coverage.find((c) => c.group === 'EGAIN_DEB' && c.shiftCode === '22:00' && c.date === WEEK)?.scheduled, 1);
});

test('shortfalls are explained and feasibility says how many advisors are missing', () => {
  const advisors = team('m', 'T1', 'MIRAKL', 'MIRAKL', 6);
  const plan = run(advisors, reqs([['MIRAKL', '09:00', 10]]));
  assert.ok(plan.shortfalls.length > 0 && plan.shortfalls[0].why.includes('advisors'));
  const row = plan.feasibility.find((f) => f.group === 'MIRAKL')!;
  assert.ok(row.shortForMin > 0);
});

test('team leaders follow their team and get days off on the quietest days', () => {
  const advisors = team('e', 'T1', 'EGAIN', 'EGAIN_DEB', 10);
  const plan = run(advisors, reqs([['EGAIN_DEB', '09:00', 5, 5, null]]));
  const leaderEntries = deriveLeaderEntries({
    dates,
    leaders: [{ leaderId: 'L1', teamId: 'T1' }],
    advisorEntries: plan.entries,
    teamOf: new Map(advisors.map((a) => [a.id, a.teamId])),
    leaderFixed: [],
    weeklyOffDays: 2,
  });
  assert.equal(leaderEntries.filter((e) => e.type === 'OFF').length, 2);
  assert.ok(leaderEntries.filter((e) => e.type === 'SHIFT').every((e) => workingOn(plan.entries, e.date).some((a) => a.shiftCode === e.shiftCode)));
  assert.ok(weekdayOf(WEEK) === 1);
});
