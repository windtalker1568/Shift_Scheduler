import mongoose from 'mongoose';
import {
  CAPACITY,
  CLASSIFICATIONS,
  DESIGNATIONS,
  SEGMENTS,
  homeGroup,
  todayIST,
  type Classification,
  type Designation,
  type Segment,
} from '../../../shared/domain';
import { withTx } from '../db';
import { HttpError } from '../lib/errors';
import { Entry, Person, Settings, Team, toId } from '../models';

const norm = (s: unknown) => String(s ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
const emailNorm = (s: unknown) => String(s ?? '').trim().toLowerCase();
const nameKey = (s: unknown) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const validEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const ALIASES: Record<string, string> = {
  TL: 'TEAM_LEADER', TEAMLEADER: 'TEAM_LEADER', E_GAIN: 'EGAIN', SENTI: 'SENTIMENT', SENT: 'SENTIMENT',
  DEBENHAMS: 'NORMAL', DEB: 'NORMAL', KAREN_MILLAN: 'KAREN_MILLEN', KM: 'KAREN_MILLEN',
};
function pick<T extends string>(list: readonly T[], v: unknown): T | undefined {
  const n = norm(v);
  const a = ALIASES[n] ?? n;
  return (list as readonly string[]).includes(a) ? (a as T) : undefined;
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function ruleProblem(segment: Segment, classification: Classification): string | null {
  if (homeGroup(segment, classification)) return null;
  return segment === 'MIRAKL'
    ? 'Mirakl advisors can only sit under Mirakl team leaders'
    : 'Only Mirakl advisors can sit under a Mirakl team leader';
}

async function reserveSeats(n: number, session: mongoose.ClientSession) {
  const s = await Settings.findOneAndUpdate(
    { key: 'main', activeCount: { $lte: CAPACITY - n } },
    { $inc: { activeCount: n } },
    { new: true, session },
  );
  if (!s) throw new HttpError(409, `This would go over the ${CAPACITY}-person limit`);
}

export interface RawRow {
  emailAddress?: unknown;
  name?: unknown;
  designation?: unknown;
  segment?: unknown;
  teamNumber?: unknown;
  teamLeader?: unknown;
  teamId?: unknown;
  classification?: unknown;
}

/** Validates every row first and saves nothing unless all rows are valid. Used for single adds and CSV import. */
export async function importPeople(raw: RawRow[], rowOffset = 1) {
  const errors: { row: number; message: string }[] = [];
  const teams = await Team.find().lean();
  const teamByNumber = new Map<number, { id: string; classification: Classification }>(
    teams.map((t: any) => [t.teamNumber, { id: String(t._id), classification: t.classification }]),
  );
  const teamById = new Map<string, { number: number; classification: Classification }>(
    teams.map((t: any) => [String(t._id), { number: t.teamNumber, classification: t.classification }]),
  );
  const existingLeaders = await Person.find({ active: true, designation: 'TEAM_LEADER' }).select('name teamId').lean();
  const teamNumbersByLeaderName = new Map<string, Set<number>>();
  const addLeaderName = (name: unknown, teamNumber: number) => {
    const key = nameKey(name);
    if (!key) return;
    const matches = teamNumbersByLeaderName.get(key) ?? new Set<number>();
    matches.add(teamNumber);
    teamNumbersByLeaderName.set(key, matches);
  };
  for (const leader of existingLeaders as any[]) {
    const team = teamById.get(String(leader.teamId));
    if (team) addLeaderName(leader.name, team.number);
  }
  const emails = raw.map((r) => emailNorm(r.emailAddress)).filter(Boolean);
  const existing = new Set((await Person.find({ emailAddress: { $in: emails } }).select('emailAddress').lean()).map((p: any) => p.emailAddress));
  const seen = new Set<string>();
  const newTeams = new Map<number, Classification>();

  type Parsed = { emailAddress: string; name: string; designation: Designation; segment?: Segment; teamNumber?: number; existingTeamId?: string; classification?: Classification };
  const rows: Parsed[] = [];
  raw.forEach((r, i) => {
    const row = i + rowOffset;
    const err = (message: string) => errors.push({ row, message });
    const emailAddress = emailNorm(r.emailAddress);
    const name = String(r.name ?? '').trim();
    const designation = pick(DESIGNATIONS, r.designation);
    if (!emailAddress) return err('E-mail Address is required');
    if (!validEmail(emailAddress)) return err(`"${emailAddress}" is not a valid E-mail Address`);
    if (existing.has(emailAddress) || seen.has(emailAddress)) return err(`E-mail Address ${emailAddress} is already used`);
    seen.add(emailAddress);
    if (!name) return err('Name is required');
    if (!designation) return err(`Unknown designation "${r.designation}"`);
    const p: Parsed = { emailAddress, name, designation };
    if (designation === 'TEAM_LEADER') {
      const teamNumber = Number(r.teamNumber);
      const classification = pick(CLASSIFICATIONS, r.classification);
      if (!Number.isInteger(teamNumber) || teamNumber <= 0) return err('Team leaders need a team number');
      if (!classification) return err('Team leaders need a classification (Mirakl, Karen Millen or Normal)');
      if (teamByNumber.has(teamNumber) || newTeams.has(teamNumber)) return err(`Team ${teamNumber} already exists`);
      newTeams.set(teamNumber, classification);
      p.teamNumber = teamNumber;
      p.classification = classification;
      addLeaderName(name, teamNumber);
    } else if (designation === 'ADVISOR') {
      const segment = pick(SEGMENTS, r.segment);
      if (!segment) return err('Advisors need a segment (eGain, Sentiment or Mirakl)');
      p.segment = segment;
    }
    rows.push(p);
    (p as any)._raw = r;
  });
  // second pass: advisors need a valid team
  for (const p of rows) {
    if (p.designation !== 'ADVISOR') continue;
    const r = (p as any)._raw as RawRow;
    const row = raw.indexOf(r) + rowOffset;
    let classification: Classification | undefined;
    if (r.teamId) {
      const t = teamById.get(String(r.teamId));
      if (t) { p.existingTeamId = String(r.teamId); p.teamNumber = t.number; classification = t.classification; }
    } else {
      const leaderName = String(r.teamLeader ?? '').trim();
      let n: number;
      if (leaderName) {
        const matches = teamNumbersByLeaderName.get(nameKey(leaderName));
        if (!matches?.size) {
          errors.push({ row, message: `Team leader "${leaderName}" was not found` });
          continue;
        }
        if (matches.size > 1) {
          errors.push({ row, message: `Team leader name "${leaderName}" is ambiguous` });
          continue;
        }
        n = [...matches][0];
      } else {
        n = Number(r.teamNumber);
      }
      p.teamNumber = n;
      classification = teamByNumber.get(n)?.classification ?? newTeams.get(n);
      if (teamByNumber.has(n)) p.existingTeamId = teamByNumber.get(n)!.id;
    }
    if (!classification) { errors.push({ row, message: 'Advisors need a valid Team leader' }); continue; }
    const problem = ruleProblem(p.segment!, classification);
    if (problem) errors.push({ row, message: problem });
  }
  if (errors.length) throw new HttpError(400, 'Some rows need fixing. Nothing was saved.', errors);

  await withTx(async (session) => {
    await reserveSeats(rows.length, session);
    const teamIds = new Map<number, mongoose.Types.ObjectId>();
    const teamDocs: any[] = [];
    const personDocs: any[] = [];
    for (const p of rows.filter((r) => r.designation === 'TEAM_LEADER')) {
      const tid = new mongoose.Types.ObjectId();
      const pid = new mongoose.Types.ObjectId();
      teamIds.set(p.teamNumber!, tid);
      teamDocs.push({ _id: tid, teamNumber: p.teamNumber, classification: p.classification, leaderPersonId: pid });
      personDocs.push({ _id: pid, emailAddress: p.emailAddress, name: p.name, designation: p.designation, teamId: tid });
    }
    for (const p of rows.filter((r) => r.designation !== 'TEAM_LEADER')) {
      const doc: any = { emailAddress: p.emailAddress, name: p.name, designation: p.designation };
      if (p.designation === 'ADVISOR') {
        doc.segment = p.segment;
        doc.teamId = p.existingTeamId ? toId(p.existingTeamId) : teamIds.get(p.teamNumber!);
      }
      personDocs.push(doc);
    }
    if (teamDocs.length) await Team.insertMany(teamDocs, { session });
    await Person.insertMany(personDocs, { session });
  });
  return { created: rows.length };
}

export async function listPeople(f: { active?: boolean; designation?: string; segment?: string; teamId?: string; q?: string } = {}) {
  const query: any = {};
  if (f.active !== undefined) query.active = f.active;
  if (f.designation) query.designation = f.designation;
  if (f.segment) query.segment = f.segment;
  if (f.teamId) query.teamId = toId(f.teamId);
  if (f.q) query.$or = [{ name: new RegExp(escapeRe(f.q), 'i') }, { emailAddress: new RegExp(escapeRe(f.q), 'i') }];
  const [people, teams] = await Promise.all([Person.find(query).sort({ name: 1 }).lean(), Team.find().lean()]);
  const byId = new Map(teams.map((t: any) => [String(t._id), t]));
  return people.map((p: any) => {
    const t: any = p.teamId ? byId.get(String(p.teamId)) : undefined;
    return {
      id: String(p._id),
      emailAddress: (p.emailAddress ?? null) as string | null,
      name: p.name as string,
      designation: p.designation as Designation,
      segment: (p.segment ?? null) as Segment | null,
      active: p.active as boolean,
      teamId: t ? String(t._id) : null,
      teamNumber: (t?.teamNumber ?? null) as number | null,
      classification: (t?.classification ?? null) as Classification | null,
      homeGroup: p.designation === 'ADVISOR' ? homeGroup(p.segment, t?.classification) : null,
    };
  });
}

export async function updatePerson(id: string, patch: { name?: string; emailAddress?: string; segment?: string; teamId?: string }) {
  const p: any = await Person.findById(id);
  if (!p || !p.active) throw new HttpError(404, 'Person not found');
  if (patch.name?.trim()) p.name = patch.name.trim();
  if (patch.emailAddress !== undefined) {
    const emailAddress = emailNorm(patch.emailAddress);
    if (!validEmail(emailAddress)) throw new HttpError(400, 'Enter a valid E-mail Address');
    if (await Person.exists({ _id: { $ne: p._id }, emailAddress })) throw new HttpError(409, 'That E-mail Address is already in use');
    p.emailAddress = emailAddress;
  }
  if (p.designation === 'ADVISOR') {
    const segment = patch.segment ? pick(SEGMENTS, patch.segment) : p.segment;
    if (!segment) throw new HttpError(400, 'Unknown segment');
    const team: any = await Team.findById(patch.teamId ?? p.teamId);
    if (!team) throw new HttpError(400, 'Choose a team');
    const problem = ruleProblem(segment, team.classification);
    if (problem) throw new HttpError(409, problem);
    p.segment = segment;
    p.teamId = team._id;
  } else if (patch.segment || patch.teamId) {
    throw new HttpError(400, 'Only advisors have a segment and can be moved between teams');
  }
  await p.save();
  return { ok: true };
}

/** Soft delete: the person leaves the 500 count and future schedules, past rosters keep their history. */
export async function removePerson(id: string) {
  await withTx(async (session) => {
    const p: any = await Person.findById(id).session(session);
    if (!p || !p.active) throw new HttpError(404, 'Person not found');
    if (p.designation === 'TEAM_LEADER') {
      const advisors = await Person.countDocuments({ teamId: p.teamId, designation: 'ADVISOR', active: true }).session(session);
      if (advisors > 0) throw new HttpError(409, `Move this team's ${advisors} advisors to another team leader first`);
      await Team.deleteOne({ _id: p.teamId }, { session });
    }
    const today = todayIST();
    p.active = false;
    p.leftOn = today;
    await p.save({ session });
    await Entry.deleteMany({ personId: p._id, date: { $gte: today } }, { session });
    await Settings.updateOne({ key: 'main' }, { $inc: { activeCount: -1 } }, { session });
  });
  return { ok: true };
}

export async function listTeams() {
  const [teams, people] = await Promise.all([Team.find().sort({ teamNumber: 1 }).lean(), Person.find({ active: true }).lean()]);
  return teams.map((t: any) => {
    const members = people.filter((p: any) => String(p.teamId) === String(t._id));
    const leader: any = members.find((p: any) => p.designation === 'TEAM_LEADER');
    return {
      id: String(t._id),
      teamNumber: t.teamNumber as number,
      classification: t.classification as Classification,
      leaderId: leader ? String(leader._id) : null,
      leaderName: (leader?.name ?? null) as string | null,
      advisors: members.filter((p: any) => p.designation === 'ADVISOR').length,
    };
  });
}

export async function changeClassification(teamId: string, raw: unknown) {
  const classification = pick(CLASSIFICATIONS, raw);
  if (!classification) throw new HttpError(400, 'Unknown classification');
  const team: any = await Team.findById(teamId);
  if (!team) throw new HttpError(404, 'Team not found');
  const advisors: any[] = await Person.find({ teamId: team._id, designation: 'ADVISOR', active: true }).lean();
  const blocked = advisors.filter((a) => ruleProblem(a.segment, classification));
  if (blocked.length)
    throw new HttpError(409, `Move these advisors to a matching team leader first: ${blocked.map((a) => a.name).join(', ')}`);
  team.classification = classification;
  await team.save();
  return { ok: true };
}

export async function reassignAdvisors(personIds: string[], toTeamId: string) {
  const team: any = await Team.findById(toTeamId);
  if (!team) throw new HttpError(404, 'Team not found');
  const advisors: any[] = await Person.find({ _id: { $in: personIds.map(toId) }, designation: 'ADVISOR', active: true }).lean();
  if (advisors.length !== personIds.length) throw new HttpError(400, 'Only active advisors can be moved');
  const blocked = advisors.filter((a) => ruleProblem(a.segment, team.classification));
  if (blocked.length) throw new HttpError(409, `${ruleProblem(blocked[0].segment, team.classification)}: ${blocked.map((a) => a.name).join(', ')}`);
  await Person.updateMany({ _id: { $in: advisors.map((a) => a._id) } }, { $set: { teamId: team._id } });
  return { moved: advisors.length };
}

export async function setupStatus() {
  const s: any = await Settings.findOne({ key: 'main' }).lean();
  return { setupComplete: !!s?.setupComplete, activeCount: (s?.activeCount ?? 0) as number, capacity: CAPACITY };
}

export async function completeSetup() {
  const people = await listPeople({ active: true });
  const teams = await listTeams();
  const problems: string[] = [];
  if (!people.length) problems.push('Add your people first');
  for (const p of people) {
    if (p.designation === 'ADVISOR' && (!p.segment || !p.teamId)) problems.push(`${p.name}: needs a segment and a team leader`);
    if (p.designation === 'ADVISOR' && p.segment && p.teamId && !p.homeGroup) problems.push(`${p.name}: segment does not match the team leader classification`);
  }
  for (const t of teams) if (!t.leaderId) problems.push(`Team ${t.teamNumber} has no team leader`);
  if (problems.length) throw new HttpError(400, 'Setup is not ready to complete', problems);
  await Settings.updateOne({ key: 'main' }, { $set: { setupComplete: true } });
  return { setupComplete: true };
}
