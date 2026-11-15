import { z } from 'zod';
import { ADVISOR_SHIFTS, GROUPS, reqKey, reqProblem, type Req } from '../../../shared/domain';
import { withTx } from '../db';
import { HttpError } from '../lib/errors';
import { Requirement } from '../models';

const rowSchema = z.object({
  group: z.enum(GROUPS),
  shiftCode: z.string().refine((c) => ADVISOR_SHIFTS.some((s) => s.code === c), 'Unknown shift'),
  dayOfWeek: z.number().int().min(0).max(6),
  min: z.number(),
  target: z.number(),
  max: z.number().nullable(),
});
export type ReqRow = z.infer<typeof rowSchema>;

const toRow = (r: any): ReqRow => ({ group: r.group, shiftCode: r.shiftCode, dayOfWeek: r.dayOfWeek, min: r.minCount, target: r.targetCount, max: r.maxCount ?? null });

export async function getRows(scope: 'TEMPLATE' | 'WEEK', weekStart = ''): Promise<ReqRow[]> {
  const rows = await Requirement.find({ scope, weekStart: scope === 'WEEK' ? weekStart : '' }).lean();
  return rows.map(toRow);
}

/** Replaces all rows of the template, or of one week (a week override replaces the template for that week). */
export async function saveRows(scope: 'TEMPLATE' | 'WEEK', weekStart: string, rawRows: unknown) {
  const rows = z.array(rowSchema).parse(rawRows);
  for (const r of rows) {
    const problem = reqProblem({ min: r.min, target: r.target, max: r.max });
    if (problem) throw new HttpError(400, `${r.group} ${r.shiftCode}: ${problem}`);
  }
  const ws = scope === 'WEEK' ? weekStart : '';
  await withTx(async (session) => {
    await Requirement.deleteMany({ scope, weekStart: ws }, { session });
    if (rows.length)
      await Requirement.insertMany(
        rows.map((r) => ({ scope, weekStart: ws, group: r.group, shiftCode: r.shiftCode, dayOfWeek: r.dayOfWeek, minCount: r.min, targetCount: r.target, maxCount: r.max })),
        { session },
      );
  });
  return { saved: rows.length };
}

export async function removeWeekOverride(weekStart: string) {
  await Requirement.deleteMany({ scope: 'WEEK', weekStart });
  return { ok: true };
}

/** The numbers the scheduler uses for a week: that week's override if one exists, otherwise the template. */
export async function effectiveRows(weekStart: string): Promise<{ rows: ReqRow[]; overridden: boolean }> {
  const week = await getRows('WEEK', weekStart);
  if (week.length) return { rows: week, overridden: true };
  return { rows: await getRows('TEMPLATE'), overridden: false };
}

export async function effectiveRequirements(weekStart: string): Promise<Record<string, Req>> {
  const { rows } = await effectiveRows(weekStart);
  const out: Record<string, Req> = {};
  for (const r of rows) out[reqKey(r.group, r.shiftCode, r.dayOfWeek)] = { min: r.min, target: r.target, max: r.max };
  return out;
}
