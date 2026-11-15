import { z } from 'zod';
import {
  ADVISOR_SHIFTS,
  FIXED_DESIGNATIONS,
  FIXED_SHIFT,
  GROUPS,
  addDays,
  classificationAllowsGroup,
  groupsForClassification,
  isDateString,
  isValidOt,
  mostCommonShift,
  todayIST,
  weekDatesOf,
  weekdayOf,
} from '../../../shared/domain';
import { computeCoverage } from '../lib/coverage';
import { HttpError } from '../lib/errors';
import { computeWarnings } from '../lib/warnings';
import { Entry, Person, Team, getSettings, toId } from '../models';
import { listPeople } from './people';
import { effectiveRequirements } from './requirements';

export const toDto = (e: any) => ({
  personId: String(e.personId),
  date: e.date as string,
  type: e.type as string,
  shiftCode: e.shiftCode as string | undefined,
  otHours: (e.otHours ?? 0) as number,
  locked: !!e.locked,
  source: e.source as string,
  workGroup: e.workGroup as string | undefined,
  reason: e.reason as string | undefined,
});

/** QA, Trainers and Management have a fixed 14:30 shift on working weekdays and are off otherwise. */
async function ensureFixedStaff(dates: string[], settings: any) {
  if (dates[6] < todayIST()) return;
  const staff = await Person.find({ active: true, designation: { $in: FIXED_DESIGNATIONS } }).select('_id').lean();
  const ops: any[] = [];
  for (const p of staff)
    for (const date of dates) {
      const works = settings.fixedStaffWorkingWeekdays.includes(weekdayOf(date));
      ops.push({
        updateOne: {
          filter: { personId: p._id, date },
          update: { $setOnInsert: works ? { type: 'SHIFT', shiftCode: FIXED_SHIFT.code, otHours: 0, source: 'DERIVED', locked: false } : { type: 'OFF', source: 'DERIVED', locked: false } },
          upsert: true,
        },
      });
    }
  if (ops.length) await Entry.bulkWrite(ops, { ordered: false });
}

export async function getWeek(weekStart: string) {
  const settings: any = await getSettings();
  const dates = weekDatesOf(weekStart);
  await ensureFixedStaff(dates, settings);
  const people = await listPeople({ active: true });
  const ids = people.map((p) => toId(p.id));
  const range = Array.from({ length: 21 }, (_, i) => addDays(weekStart, i - 7));
  const all = (await Entry.find({ date: { $in: range }, personId: { $in: ids } }).lean()).map(toDto);
  const entries = all.filter((e) => dates.includes(e.date));
  const teams: any[] = await Team.find().lean();
  const teamNumbers = new Map<string, number>(teams.map((t) => [String(t._id), t.teamNumber]));
  const warnings = computeWarnings(
    people.map((p) => ({ id: p.id, name: p.name, designation: p.designation, teamId: p.teamId })),
    all,
    dates,
    settings,
    teamNumbers,
  );
  const advisorIds = new Set(people.filter((p) => p.designation === 'ADVISOR').map((p) => p.id));
  const coverage = computeCoverage(await effectiveRequirements(weekStart), entries.filter((e) => advisorIds.has(e.personId)) as any, dates, ADVISOR_SHIFTS);
  const { weekStartDay, weeklyOffDays, minRestHours, maxConsecutiveWorkingDays } = settings;
  return { weekStart, dates, people, entries, warnings, coverage, settings: { weekStartDay, weeklyOffDays, minRestHours, maxConsecutiveWorkingDays } };
}

const entryBody = z.object({
  personId: z.string(),
  date: z.string().refine(isDateString, 'Invalid date'),
  type: z.enum(['SHIFT', 'OFF', 'LEAVE']),
  shiftCode: z.string().optional(),
  otHours: z.number().optional(),
  locked: z.boolean().optional(),
  workGroup: z.enum(GROUPS).optional(),
});

export async function setEntry(raw: unknown) {
  const b = entryBody.parse(raw);
  const person: any = await Person.findById(b.personId).lean();
  if (!person || !person.active) throw new HttpError(404, 'Person not found');
  const set: any = { type: b.type, source: 'MANUAL', locked: !!b.locked, otHours: 0 };
  const unset: any = {};
  if (b.type === 'SHIFT') {
    if (person.designation === 'TEAM_LEADER') throw new HttpError(409, 'Team leader shifts follow their team. You can only set Off or Leave.');
    if (FIXED_DESIGNATIONS.includes(person.designation)) {
      set.shiftCode = FIXED_SHIFT.code;
      unset.workGroup = '';
      unset.reason = '';
    } else {
      if (!b.shiftCode || !ADVISOR_SHIFTS.some((s) => s.code === b.shiftCode)) throw new HttpError(400, 'Choose one of the advisor shifts');
      const ot = b.otHours ?? 0;
      if (!isValidOt(ot)) throw new HttpError(400, 'Overtime must be between 0.5 and 5 hours, in 0.5-hour steps');
      const team: any = person.teamId ? await Team.findById(person.teamId).lean() : null;
      if (!team) throw new HttpError(409, 'This advisor needs a team leader before scheduling');
      const wg = b.workGroup ?? groupsForClassification(team.classification)[0];
      if (!wg) throw new HttpError(409, 'This advisor has no valid team classification');
      if (!classificationAllowsGroup(team.classification, wg))
        throw new HttpError(409, 'Mirakl teams only cover Mirakl; other teams can cover eGain and Sentiment needs');
      Object.assign(set, { shiftCode: b.shiftCode, otHours: ot, workGroup: wg, reason: 'MANUAL' });
    }
  } else {
    if (b.otHours) throw new HttpError(400, 'Overtime only applies to shifts');
    Object.assign(unset, { shiftCode: '', workGroup: '', reason: '' });
  }
  const update: any = { $set: set };
  if (Object.keys(unset).length) update.$unset = unset;
  const saved = await Entry.findOneAndUpdate({ personId: person._id, date: b.date }, update, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
  if (person.designation === 'ADVISOR' && person.teamId) await recomputeLeaderDay(person.teamId, b.date);
  return toDto(saved);
}

export async function clearEntry(personId: string, date: string) {
  if (!isDateString(date)) throw new HttpError(400, 'Invalid date');
  const person: any = await Person.findById(personId).lean();
  if (!person) throw new HttpError(404, 'Person not found');
  await Entry.deleteOne({ personId: person._id, date });
  if (person.designation === 'ADVISOR' && person.teamId) await recomputeLeaderDay(person.teamId, date);
  return { ok: true };
}

/** Keeps a team leader's shift equal to the most common shift of the team's advisors on that day. */
export async function recomputeLeaderDay(teamId: unknown, date: string) {
  const team: any = await Team.findById(teamId).lean();
  if (!team?.leaderPersonId) return;
  const existing: any = await Entry.findOne({ personId: team.leaderPersonId, date }).lean();
  if (existing && (existing.type !== 'SHIFT' || existing.locked || existing.source === 'MANUAL')) return;
  const advisors = await Person.find({ teamId, designation: 'ADVISOR', active: true }).select('_id').lean();
  const es: any[] = await Entry.find({ personId: { $in: advisors.map((a: any) => a._id) }, date, type: 'SHIFT' }).lean();
  const code = mostCommonShift(es.map((e) => e.shiftCode));
  if (!code) {
    if (existing) await Entry.deleteOne({ _id: existing._id });
    return;
  }
  await Entry.updateOne({ personId: team.leaderPersonId, date }, { $set: { type: 'SHIFT', shiftCode: code, otHours: 0, source: 'DERIVED', locked: false } }, { upsert: true });
}

/** Copies last week's days (not leave, not locked flags) into this week where the target cell is not locked. */
export async function copyPreviousWeek(weekStart: string) {
  const prevDates = weekDatesOf(addDays(weekStart, -7));
  const dates = weekDatesOf(weekStart);
  const active = await Person.find({ active: true }).select('_id designation teamId').lean();
  const byId = new Map<string, any>(active.map((p: any) => [String(p._id), p]));
  const prev: any[] = await Entry.find({ date: { $in: prevDates }, personId: { $in: active.map((p: any) => p._id) } }).lean();
  const locked = new Set((await Entry.find({ date: { $in: dates }, locked: true }).select('personId date').lean()).map((e: any) => `${e.personId}|${e.date}`));
  const ops: any[] = [];
  for (const e of prev) {
    const p = byId.get(String(e.personId));
    if (e.type === 'LEAVE' || (p.designation === 'TEAM_LEADER' && e.type === 'SHIFT')) continue;
    const date = addDays(e.date, 7);
    if (locked.has(`${e.personId}|${date}`)) continue;
    const $set: any = { type: e.type, otHours: e.otHours ?? 0, source: 'AUTO', locked: false };
    const $unset: any = {};
    for (const f of ['shiftCode', 'workGroup', 'reason']) if (e[f]) $set[f] = e[f]; else $unset[f] = '';
    ops.push({ updateOne: { filter: { personId: e.personId, date }, update: Object.keys($unset).length ? { $set, $unset } : { $set }, upsert: true } });
  }
  if (ops.length) await Entry.bulkWrite(ops, { ordered: false });
  const teamIds = new Set(active.filter((p: any) => p.teamId && p.designation === 'ADVISOR').map((p: any) => String(p.teamId)));
  for (const t of teamIds) for (const d of dates) await recomputeLeaderDay(t, d);
  return { copied: ops.length };
}
