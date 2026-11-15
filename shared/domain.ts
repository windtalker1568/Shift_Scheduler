// Constants, types and pure helpers shared by the server and the client.

export const CAPACITY = 500;

export const DESIGNATIONS = ['ADVISOR', 'TEAM_LEADER', 'QA', 'TRAINER', 'MANAGEMENT'] as const;
export type Designation = (typeof DESIGNATIONS)[number];
export const DESIGNATION_LABEL: Record<Designation, string> = {
  ADVISOR: 'Advisor',
  TEAM_LEADER: 'Team Leader',
  QA: 'QA',
  TRAINER: 'Trainer',
  MANAGEMENT: 'Management',
};
export const FIXED_DESIGNATIONS: Designation[] = ['QA', 'TRAINER', 'MANAGEMENT'];

export const CLASSIFICATIONS = ['MIRAKL', 'KAREN_MILLEN', 'NORMAL'] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];
export const CLASSIFICATION_LABEL: Record<Classification, string> = {
  MIRAKL: 'Mirakl',
  KAREN_MILLEN: 'Karen Millen',
  NORMAL: 'Normal (Debenhams)',
};

export const GROUPS = ['MIRAKL', 'EGAIN_DEB', 'EGAIN_KM', 'SENT_DEB', 'SENT_KM'] as const;
export type Group = (typeof GROUPS)[number];
export const GROUP_LABEL: Record<Group, string> = {
  MIRAKL: 'Mirakl',
  EGAIN_DEB: 'eGain – Debenhams',
  EGAIN_KM: 'eGain – Karen Millen',
  SENT_DEB: 'Sentiment – Debenhams',
  SENT_KM: 'Sentiment – Karen Millen',
};

export type EntryType = 'SHIFT' | 'OFF' | 'LEAVE';
export type EntrySource = 'AUTO' | 'MANUAL' | 'DERIVED';
export type Reason = 'HOME' | 'LEFTOVER_TO_DEBENHAMS' | 'COVERAGE_NEED' | 'MANUAL';
export const REASON_LABEL: Record<Reason, string> = {
  HOME: 'Team classification match',
  LEFTOVER_TO_DEBENHAMS: 'Leftover moved to Debenhams',
  COVERAGE_NEED: 'Staffing need across classifications',
  MANUAL: 'Set manually',
};

// ---------- shifts (all times IST) ----------
export interface ShiftDef {
  code: string; // the start time, e.g. "09:00"
  label: string;
  startTime: string;
  baseHours: number;
  forAdvisors: boolean;
}
export const BASE_HOURS = 8;
export const ADVISOR_SHIFTS: ShiftDef[] = ['07:00', '08:00', '09:00', '11:30', '12:30', '22:00'].map((t) => ({
  code: t,
  label: t,
  startTime: t,
  baseHours: BASE_HOURS,
  forAdvisors: true,
}));
export const FIXED_SHIFT: ShiftDef = { code: '14:30', label: '14:30 (fixed)', startTime: '14:30', baseHours: BASE_HOURS, forAdvisors: false };
export const ALL_SHIFTS: ShiftDef[] = [...ADVISOR_SHIFTS, FIXED_SHIFT];
export const SHIFT_BY_CODE: Record<string, ShiftDef> = Object.fromEntries(ALL_SHIFTS.map((s) => [s.code, s]));
export const NIGHT_SHIFT_CODE = '22:00';

export const OT_STEP = 0.5;
export const OT_MAX = 5;
export const OT_OPTIONS: number[] = Array.from({ length: OT_MAX / OT_STEP + 1 }, (_, i) => i * OT_STEP);
export const isValidOt = (h: number) =>
  Number.isFinite(h) && h >= 0 && h <= OT_MAX && Math.abs(h / OT_STEP - Math.round(h / OT_STEP)) < 1e-9;

// ---------- groups ----------
/** Mirakl stays isolated; other teams can cover any eGain or Sentiment need. */
export function groupsForClassification(classification?: Classification | null): Group[] {
  if (classification === 'MIRAKL') return ['MIRAKL'];
  if (!classification) return [];
  return ['EGAIN_DEB', 'EGAIN_KM', 'SENT_DEB', 'SENT_KM'];
}
export const classificationAllowsGroup = (classification: Classification | null | undefined, group: Group) =>
  classification === 'MIRAKL' ? group === 'MIRAKL' : !!classification && group !== 'MIRAKL';
export const groupClassification = (g: Group): Classification =>
  g === 'MIRAKL' ? 'MIRAKL' : g.endsWith('_KM') ? 'KAREN_MILLEN' : 'NORMAL';
export const isDebenhamsGroup = (g: Group) => g === 'EGAIN_DEB' || g === 'SENT_DEB';

// ---------- requirements ----------
export interface Req {
  min: number;
  target: number;
  max: number | null; // null = unlimited
}
export const reqKey = (g: Group, shiftCode: string, weekday: number) => `${g}|${shiftCode}|${weekday}`;
/** A cell with no row: nothing needed; only the Debenhams groups can absorb extra advisors. */
export const defaultReq = (g: Group): Req => ({ min: 0, target: 0, max: isDebenhamsGroup(g) ? null : 0 });
export function reqProblem(r: Req): string | null {
  if (![r.min, r.target].every((n) => Number.isInteger(n) && n >= 0)) return 'Numbers must be whole and not negative';
  if (r.max !== null && (!Number.isInteger(r.max) || r.max < 0)) return 'Maximum must be a whole number or empty';
  if (r.min > r.target) return 'Minimum cannot be above target';
  if (r.max !== null && r.target > r.max) return 'Target cannot be above maximum';
  return null;
}

// ---------- dates (IST wall-clock, "YYYY-MM-DD") ----------
export const HOUR = 3_600_000;
const DAY_MS = 24 * HOUR;
const parseDate = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, dd);
};
const fmtDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const isDateString = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && fmtDate(parseDate(d)) === d;
export const addDays = (d: string, n: number) => fmtDate(parseDate(d) + n * DAY_MS);
export const weekdayOf = (d: string) => new Date(parseDate(d)).getUTCDay(); // 0 = Sunday
export const startOfWeek = (d: string, weekStartDay: number) => addDays(d, -((weekdayOf(d) - weekStartDay + 7) % 7));
export const weekDatesOf = (weekStart: string) => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
export const todayIST = () => fmtDate(Date.now() + 5.5 * HOUR);
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const shiftStartMs = (date: string, startTime: string) => {
  const [h, m] = startTime.split(':').map(Number);
  return parseDate(date) + (h * 60 + m) * 60_000;
};
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);

/** Start/end of a schedule entry (wall-clock IST treated as UTC; only differences matter). */
export function entryWindow(e: { date: string; shiftCode?: string | null; otHours?: number | null }) {
  const def = e.shiftCode ? SHIFT_BY_CODE[e.shiftCode] : undefined;
  if (!def) return null;
  const start = shiftStartMs(e.date, def.startTime);
  return { start, end: start + (BASE_HOURS + (e.otHours ?? 0)) * HOUR };
}
export function rangeLabel(date: string, code: string, ot = 0): string {
  const w = entryWindow({ date, shiftCode: code, otHours: ot });
  if (!w) return '';
  return `${hhmm(w.start)}–${hhmm(w.end)}${w.end >= parseDate(date) + DAY_MS ? '+1' : ''}`;
}
export const shiftStartMinutes = (code: string) => {
  const d = SHIFT_BY_CODE[code];
  if (!d) return 0;
  const [h, m] = d.startTime.split(':').map(Number);
  return h * 60 + m;
};
/** Most common shift code; ties go to the earliest start. */
export function mostCommonShift(codes: string[]): string | null {
  if (!codes.length) return null;
  const tally = new Map<string, number>();
  for (const c of codes) tally.set(c, (tally.get(c) ?? 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1] || shiftStartMinutes(a[0]) - shiftStartMinutes(b[0]))[0][0];
}
