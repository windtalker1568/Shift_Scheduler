import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { WEEKDAY_SHORT } from '../../../shared/domain';
import type { Settings } from '../types';

export default function SettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') });
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { if (q.data) setS(q.data); }, [q.data]);
  const save = useMutation({
    mutationFn: () => api('/settings', { method: 'PUT', body: { weekStartDay: s!.weekStartDay, weeklyOffDays: s!.weeklyOffDays, minRestHours: s!.minRestHours, maxConsecutiveWorkingDays: s!.maxConsecutiveWorkingDays, fixedStaffWorkingWeekdays: s!.fixedStaffWorkingWeekdays } }),
    onSuccess: () => { setMsg('Settings saved'); qc.invalidateQueries(); },
    onError: (e) => setMsg((e as Error).message),
  });
  if (!s) return <p>Loading…</p>;
  const num = (v: string) => Number(v);
  return (
    <section className="card max-w-xl space-y-4 p-4">
      <h2 className="text-lg">Scheduling rules</h2>
      <label className="block text-sm font-bold">Week starts on
        <select className="input mt-1 block" value={s.weekStartDay} onChange={(e) => setS({ ...s, weekStartDay: num(e.target.value) })}>
          {WEEKDAY_SHORT.map((d, i) => <option key={d} value={i}>{d}</option>)}
        </select>
      </label>
      <label className="block text-sm font-bold">Days off per advisor each week
        <input className="input mt-1 block w-24" type="number" min={0} max={6} value={s.weeklyOffDays} onChange={(e) => setS({ ...s, weeklyOffDays: num(e.target.value) })} />
      </label>
      <label className="block text-sm font-bold">Minimum rest between shifts (hours)
        <input className="input mt-1 block w-24" type="number" min={0} max={24} value={s.minRestHours} onChange={(e) => setS({ ...s, minRestHours: num(e.target.value) })} />
      </label>
      <label className="block text-sm font-bold">Most working days in a row
        <input className="input mt-1 block w-24" type="number" min={1} max={7} value={s.maxConsecutiveWorkingDays} onChange={(e) => setS({ ...s, maxConsecutiveWorkingDays: num(e.target.value) })} />
      </label>
      <fieldset>
        <legend className="text-sm font-bold">Working days for QA, Trainers and Management (14:30–22:30)</legend>
        <div className="mt-1 flex flex-wrap gap-3">
          {WEEKDAY_SHORT.map((d, i) => (
            <label key={d} className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={s.fixedStaffWorkingWeekdays.includes(i)} onChange={(e) => setS({ ...s, fixedStaffWorkingWeekdays: e.target.checked ? [...s.fixedStaffWorkingWeekdays, i] : s.fixedStaffWorkingWeekdays.filter((x) => x !== i) })} />
              {d}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex items-center gap-3">
        <button className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>Save settings</button>
        {msg && <span role="status" className="text-sm">{msg}</span>}
      </div>
    </section>
  );
}
