import mongoose, { Schema, model, type ClientSession } from 'mongoose';
import { CLASSIFICATIONS, DESIGNATIONS, GROUPS, SEGMENTS } from '../../shared/domain';

const oid = Schema.Types.ObjectId;

export const User = model(
  'User',
  new Schema(
    {
      email: { type: String, required: true, unique: true, lowercase: true, trim: true },
      passwordHash: { type: String, required: true },
      role: { type: String, default: 'MANAGER' },
    },
    { timestamps: true },
  ),
);

export const Settings = model(
  'Settings',
  new Schema({
    key: { type: String, default: 'main', unique: true },
    setupComplete: { type: Boolean, default: false },
    activeCount: { type: Number, default: 0 }, // atomic counter behind the 500-person cap
    weekStartDay: { type: Number, default: 1, min: 0, max: 6 }, // 0 = Sunday
    weeklyOffDays: { type: Number, default: 2, min: 0, max: 6 },
    minRestHours: { type: Number, default: 11, min: 0, max: 24 },
    maxConsecutiveWorkingDays: { type: Number, default: 6, min: 1, max: 7 },
    fixedStaffWorkingWeekdays: { type: [Number], default: [1, 2, 3, 4, 5] }, // QA / Trainers / Management
  }),
);

const personSchema = new Schema(
  {
    emailAddress: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    designation: { type: String, enum: DESIGNATIONS, required: true },
    segment: { type: String, enum: SEGMENTS },
    teamId: { type: oid, ref: 'Team' },
    active: { type: Boolean, default: true },
    leftOn: { type: String },
  },
  { timestamps: true },
);
personSchema.index({ designation: 1, segment: 1, teamId: 1, active: 1 });
export const Person = model('Person', personSchema);

export const Team = model(
  'Team',
  new Schema({
    teamNumber: { type: Number, required: true, unique: true },
    classification: { type: String, enum: CLASSIFICATIONS, required: true },
    leaderPersonId: { type: oid, ref: 'Person' },
  }),
);

const entrySchema = new Schema(
  {
    personId: { type: oid, ref: 'Person', required: true },
    date: { type: String, required: true }, // "YYYY-MM-DD" in IST
    type: { type: String, enum: ['SHIFT', 'OFF', 'LEAVE'], required: true },
    shiftCode: { type: String },
    otHours: { type: Number, default: 0 },
    locked: { type: Boolean, default: false },
    source: { type: String, enum: ['AUTO', 'MANUAL', 'DERIVED'], default: 'MANUAL' },
    workGroup: { type: String, enum: GROUPS },
    reason: { type: String, enum: ['HOME', 'LEFTOVER_TO_DEBENHAMS', 'CROSS_SEGMENT_NEED', 'MANUAL'] },
  },
  { timestamps: true },
);
entrySchema.index({ personId: 1, date: 1 }, { unique: true });
entrySchema.index({ date: 1 });
export const Entry = model('ScheduleEntry', entrySchema);

const requirementSchema = new Schema({
  scope: { type: String, enum: ['TEMPLATE', 'WEEK'], required: true },
  weekStart: { type: String, default: '' },
  group: { type: String, enum: GROUPS, required: true },
  shiftCode: { type: String, required: true },
  dayOfWeek: { type: Number, min: 0, max: 6, required: true }, // 0 = Sunday
  minCount: { type: Number, required: true },
  targetCount: { type: Number, required: true },
  maxCount: { type: Number, default: null }, // null = unlimited
});
requirementSchema.index({ scope: 1, weekStart: 1, group: 1, shiftCode: 1, dayOfWeek: 1 }, { unique: true });
export const Requirement = model('StaffingRequirement', requirementSchema);

export async function getSettings(session?: ClientSession) {
  return Settings.findOneAndUpdate(
    { key: 'main' },
    { $setOnInsert: { key: 'main' } },
    { upsert: true, new: true, setDefaultsOnInsert: true, session },
  ).lean();
}

export const toId = (v: unknown) => new mongoose.Types.ObjectId(String(v));
