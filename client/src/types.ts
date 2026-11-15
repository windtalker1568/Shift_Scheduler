import type { Classification, Designation, Group, Segment } from '../../shared/domain';

export interface PersonDto {
  id: string;
  employeeId: string;
  name: string;
  designation: Designation;
  segment: Segment | null;
  active: boolean;
  teamId: string | null;
  teamNumber: number | null;
  classification: Classification | null;
  homeGroup: Group | null;
}
export interface TeamDto {
  id: string;
  teamNumber: number;
  classification: Classification;
  leaderId: string | null;
  leaderName: string | null;
  advisors: number;
}
export interface EntryDto {
  personId: string;
  date: string;
  type: 'SHIFT' | 'OFF' | 'LEAVE';
  shiftCode?: string;
  otHours: number;
  locked: boolean;
  source: string;
  workGroup?: Group;
  reason?: string;
}
export interface CoverageCell {
  group: Group;
  shiftCode: string;
  date: string;
  min: number;
  target: number;
  max: number | null;
  scheduled: number;
  status: 'BELOW_MIN' | 'BELOW_TARGET' | 'AT_TARGET' | 'ABOVE_TARGET' | 'ABOVE_MAX';
}
export interface WarningDto {
  type: string;
  personId?: string;
  teamId?: string;
  date?: string;
  message: string;
}
export interface Settings {
  weekStartDay: number;
  weeklyOffDays: number;
  minRestHours: number;
  maxConsecutiveWorkingDays: number;
  fixedStaffWorkingWeekdays: number[];
}
export interface WeekData {
  weekStart: string;
  dates: string[];
  people: PersonDto[];
  entries: EntryDto[];
  warnings: WarningDto[];
  coverage: CoverageCell[];
  settings: Settings;
}
export interface GenerateResult {
  weekStart: string;
  advisorEntries: EntryDto[];
  leaderEntries: EntryDto[];
  coverage: CoverageCell[];
  shortfalls: { group: Group; date: string; shiftCode: string; min: number; scheduled: number; why: string }[];
  surplus: { personId: string; date: string }[];
  feasibility: {
    group: Group;
    advisors: number;
    availablePersonDays: number;
    minPersonDays: number;
    targetPersonDays: number;
    shortForMin: number;
    shortForTarget: number;
    spareForTarget: number;
  }[];
  notes: string[];
  stats: { crossSegment: number; leftover: number; surplus: number };
}
export interface ReqRowDto {
  group: Group;
  shiftCode: string;
  dayOfWeek: number;
  min: number;
  target: number;
  max: number | null;
}
