import bcrypt from 'bcryptjs';
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { ADVISOR_SHIFTS, CAPACITY, FIXED_SHIFT, GROUPS, isDateString, startOfWeek } from '../../shared/domain';
import { config } from './config';
import { HttpError } from './lib/errors';
import { parsePeopleCsv } from './lib/csv';
import { Settings, User, getSettings } from './models';
import { weeklyCsv } from './services/export';
import { changeClassification, completeSetup, importPeople, listPeople, listTeams, reassignAdvisors, removePerson, setupStatus, updatePerson } from './services/people';
import { effectiveRows, getRows, removeWeekOverride, saveRows } from './services/requirements';
import { applyGenerate, runGenerate } from './services/scheduler';
import { clearEntry, copyPreviousWeek, getWeek, setEntry } from './services/schedule';

const h = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res, next) => {
  fn(req, res).then((out) => { if (!res.headersSent) res.json(out); }).catch(next);
};
const sign = (u: any) => jwt.sign({ sub: String(u._id), email: u.email }, config.jwtSecret, { expiresIn: '12h' });
const credentials = z.object({ email: z.string().email(), password: z.string().min(8, 'Password needs at least 8 characters') });

function auth(req: Request, _res: Response, next: NextFunction) {
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  try {
    jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    next(new HttpError(401, 'Please sign in'));
  }
}
/** Normalises any date to the start of its week using the configured week start day. */
async function weekParam(req: Request) {
  const raw = String(req.params.weekStart ?? req.query.weekStart ?? '');
  if (!isDateString(raw)) throw new HttpError(400, 'Invalid week start date');
  const s: any = await getSettings();
  return startOfWeek(raw, s.weekStartDay);
}

export const router = Router();

// ---------- public ----------
router.get('/auth/status', h(async () => ({ hasUsers: (await User.countDocuments()) > 0 })));
router.post('/auth/bootstrap', h(async (req) => {
  if (await User.countDocuments()) throw new HttpError(409, 'A manager account already exists');
  const b = credentials.parse(req.body);
  const u = await User.create({ email: b.email, passwordHash: await bcrypt.hash(b.password, 10) });
  return { token: sign(u) };
}));
router.post('/auth/login', h(async (req) => {
  const b = credentials.pick({ email: true }).extend({ password: z.string() }).parse(req.body);
  const u: any = await User.findOne({ email: b.email.toLowerCase() });
  if (!u || !(await bcrypt.compare(b.password, u.passwordHash))) throw new HttpError(401, 'Email or password is wrong');
  return { token: sign(u) };
}));

// ---------- everything below needs a signed-in manager ----------
router.use(auth);
router.get('/auth/me', h(async () => ({ ok: true })));
router.get('/meta', h(async () => ({ capacity: CAPACITY, shifts: ADVISOR_SHIFTS, fixedShift: FIXED_SHIFT, groups: GROUPS })));

router.get('/settings', h(async () => getSettings()));
router.put('/settings', h(async (req) => {
  const b = z.object({
    weekStartDay: z.number().int().min(0).max(6),
    weeklyOffDays: z.number().int().min(0).max(6),
    minRestHours: z.number().min(0).max(24),
    maxConsecutiveWorkingDays: z.number().int().min(1).max(7),
    fixedStaffWorkingWeekdays: z.array(z.number().int().min(0).max(6)),
  }).parse(req.body);
  return Settings.findOneAndUpdate({ key: 'main' }, { $set: b }, { new: true }).lean();
}));

router.get('/setup/status', h(async () => setupStatus()));
router.post('/setup/complete', h(async () => completeSetup()));

router.get('/people', h(async (req) => {
  const q = req.query;
  return listPeople({
    active: q.active === undefined ? true : q.active === 'true',
    designation: q.designation as string | undefined,
    segment: q.segment as string | undefined,
    teamId: q.teamId as string | undefined,
    q: q.q as string | undefined,
  });
}));
router.post('/people', h(async (req, res) => {
  await importPeople([req.body]);
  res.status(201);
  return { ok: true };
}));
router.post('/people/import', h(async (req) => {
  const { csv } = z.object({ csv: z.string().min(1) }).parse(req.body);
  const rows = parsePeopleCsv(csv);
  if (!rows.length) throw new HttpError(400, 'Paste a header row with Full name, Designation, Team leader and E-mail Address, plus at least one person');
  return importPeople(rows, 2);
}));
router.put('/people/:id', h(async (req) => updatePerson(req.params.id, req.body)));
router.delete('/people/:id', h(async (req) => removePerson(req.params.id)));

router.get('/teams', h(async () => listTeams()));
router.put('/teams/:id/classification', h(async (req) => changeClassification(req.params.id, req.body?.classification)));
router.post('/teams/reassign', h(async (req) => {
  const b = z.object({ personIds: z.array(z.string()).min(1), toTeamId: z.string() }).parse(req.body);
  return reassignAdvisors(b.personIds, b.toTeamId);
}));

router.get('/requirements', h(async (req) => {
  const ws = await weekParam(req);
  const week = await getRows('WEEK', ws);
  return { weekStart: ws, template: await getRows('TEMPLATE'), week, effective: (await effectiveRows(ws)).rows, overridden: week.length > 0 };
}));
router.put('/requirements', h(async (req) => {
  const b = z.object({ scope: z.enum(['TEMPLATE', 'WEEK']), weekStart: z.string().optional(), rows: z.array(z.any()) }).parse(req.body);
  req.params.weekStart = b.weekStart ?? '';
  const ws = b.scope === 'WEEK' ? await weekParam(req) : '';
  return saveRows(b.scope, ws, b.rows);
}));
router.delete('/requirements', h(async (req) => removeWeekOverride(await weekParam(req))));

router.put('/schedule/entry', h(async (req) => setEntry(req.body)));
router.delete('/schedule/entry', h(async (req) => clearEntry(String(req.query.personId), String(req.query.date))));
router.get('/schedule/:weekStart', h(async (req) => getWeek(await weekParam(req))));
router.post('/schedule/:weekStart/copy-previous', h(async (req) => copyPreviousWeek(await weekParam(req))));

router.post('/scheduler/:weekStart/generate', h(async (req) => runGenerate(await weekParam(req))));
router.post('/scheduler/:weekStart/apply', h(async (req) => applyGenerate(await weekParam(req))));

router.get('/export/:weekStart', async (req, res, next) => {
  try {
    const ws = await weekParam(req);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="roster-${ws}.csv"`);
    res.send('\ufeff' + (await weeklyCsv(ws)));
  } catch (e) {
    next(e);
  }
});
