import {
  ADVISOR_SHIFTS,
  addDays,
  homeGroup,
  mostCommonShift,
  weekDatesOf,
  NIGHT_SHIFT_CODE,
  type Group,
} from '../../../shared/domain';
import { withTx } from '../db';
import { deriveLeaderEntries, generateAdvisorWeek, type SAdvisor, type SEntry } from '../lib/autoScheduler';
import { Entry, Person, Team, getSettings, toId } from '../models';
import { effectiveRequirements } from './requirements';

const toSEntry = (e: any): SEntry => ({
  personId: String(e.personId),
  date: e.date,
  type: e.type,
  shiftCode: e.shiftCode ?? undefined,
  otHours: e.otHours ?? 0,
  locked: !!e.locked,
  workGroup: e.workGroup ?? undefined,
  reason: e.reason ?? undefined,
  source: e.source,
});
/** Cells the scheduler must not touch: locked cells, leave and days off set by hand. */
const isFixed = (e: SEntry) => e.locked || e.type === 'LEAVE' || (e.type === 'OFF' && e.source === 'MANUAL');

export async function runGenerate(weekStart: string) {
  const settings: any = await getSettings();
  const dates = weekDatesOf(weekStart);
  const [people, teams, requirements] = await Promise.all([
    Person.find({ active: true, designation: { $in: ['ADVISOR', 'TEAM_LEADER'] } }).lean(),
    Team.find().lean(),
    effectiveRequirements(weekStart),
  ]);
  const teamById = new Map<string, any>(teams.map((t: any) => [String(t._id), t]));
  const advisors: SAdvisor[] = [];
  const skipped: string[] = [];
  for (const p of people as any[]) {
    if (p.designation !== 'ADVISOR') continue;
    const home = homeGroup(p.segment, teamById.get(String(p.teamId))?.classification);
    if (!home) skipped.push(p.name);
    else advisors.push({ id: String(p._id), teamId: String(p.teamId), segment: p.segment, home });
  }
  const leaders = (people as any[]).filter((p) => p.designation === 'TEAM_LEADER' && p.teamId).map((p) => ({ leaderId: String(p._id), teamId: String(p.teamId) }));
  const peopleIds = (people as any[]).map((p) => p._id);

  const from = addDays(weekStart, -28);
  const to = addDays(weekStart, 13);
  const range = Array.from({ length: 42 }, (_, i) => addDays(from, i));
  const all = (await Entry.find({ date: { $in: range }, personId: { $in: peopleIds } }).lean()).map(toSEntry);
  const advisorIds = new Set(advisors.map((a) => a.id));
  const inWeek = all.filter((e) => dates.includes(e.date));
  const fixedAdvisor = inWeek.filter((e) => advisorIds.has(e.personId) && isFixed(e));
  const fixedLeader = inWeek.filter((e) => !advisorIds.has(e.personId) && isFixed(e));
  const neighbour = all.filter((e) => advisorIds.has(e.personId) && !dates.includes(e.date));

  // history for fair rotation
  const lastWeek = new Set(weekDatesOf(addDays(weekStart, -7)));
  const lastShifts = new Map<string, string[]>();
  const nightsLastWeek = new Set<string>();
  const crossCounts: Record<string, number> = {};
  for (const e of neighbour) {
    if (e.date >= weekStart) continue;
    if (e.reason === 'CROSS_SEGMENT_NEED') crossCounts[e.personId] = (crossCounts[e.personId] ?? 0) + 1;
    if (e.type === 'SHIFT' && e.shiftCode && lastWeek.has(e.date)) {
      lastShifts.set(e.personId, [...(lastShifts.get(e.personId) ?? []), e.shiftCode]);
      if (e.shiftCode === NIGHT_SHIFT_CODE) nightsLastWeek.add(e.personId);
    }
  }
  const lastWeekShift: Record<string, string> = {};
  for (const [pid, codes] of lastShifts) lastWeekShift[pid] = mostCommonShift(codes)!;

  const plan = generateAdvisorWeek({
    dates,
    advisors,
    shifts: ADVISOR_SHIFTS,
    requirements,
    fixedEntries: fixedAdvisor,
    neighbourEntries: neighbour,
    settings,
    history: { lastWeekShift, nightsLastWeek, crossCounts },
  });
  const teamOf = new Map(advisors.map((a) => [a.id, a.teamId]));
  const leaderEntries = deriveLeaderEntries({
    dates,
    leaders,
    advisorEntries: [...plan.entries, ...fixedAdvisor],
    teamOf,
    leaderFixed: fixedLeader,
    weeklyOffDays: settings.weeklyOffDays,
  });
  const notes = [...plan.notes];
  if (skipped.length) notes.push(`Skipped advisors with no valid team/segment: ${skipped.join(', ')}`);
  return { weekStart, advisorEntries: plan.entries, leaderEntries, coverage: plan.coverage, shortfalls: plan.shortfalls, surplus: plan.surplus, feasibility: plan.feasibility, notes, stats: plan.stats };
}

/** Re-runs the generator on the server and saves the result, replacing everything except locked cells, leave and manual days off. */
export async function applyGenerate(weekStart: string) {
  const result = await runGenerate(weekStart);
  const dates = weekDatesOf(weekStart);
  const people = await Person.find({ active: true, designation: { $in: ['ADVISOR', 'TEAM_LEADER'] } }).select('_id').lean();
  await withTx(async (session) => {
    await Entry.deleteMany(
      {
        personId: { $in: people.map((p: any) => p._id) },
        date: { $in: dates },
        locked: { $ne: true },
        $nor: [{ type: 'LEAVE' }, { type: 'OFF', source: 'MANUAL' }],
      },
      { session },
    );
    const docs = [...result.advisorEntries, ...result.leaderEntries].map((e) => ({
      personId: toId(e.personId),
      date: e.date,
      type: e.type,
      shiftCode: e.shiftCode,
      otHours: e.otHours ?? 0,
      locked: false,
      source: e.source ?? 'AUTO',
      workGroup: e.workGroup as Group | undefined,
      reason: e.reason,
    }));
    if (docs.length) await Entry.insertMany(docs, { session });
  });
  return result;
}
