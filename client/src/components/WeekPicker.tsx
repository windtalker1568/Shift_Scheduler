import { addDays, startOfWeek } from '../../../shared/domain';

export default function WeekPicker({ value, weekStartDay, onChange }: { value: string; weekStartDay: number; onChange: (weekStart: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className="btn" onClick={() => onChange(addDays(value, -7))}>Previous week</button>
      <input className="input" type="date" value={value} aria-label="Pick a week" onChange={(e) => e.target.value && onChange(startOfWeek(e.target.value, weekStartDay))} />
      <button className="btn" onClick={() => onChange(addDays(value, 7))}>Next week</button>
      <span className="text-sm text-muted">{value} to {addDays(value, 6)}</span>
    </div>
  );
}
