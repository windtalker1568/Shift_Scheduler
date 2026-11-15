import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api';
import {
  ADVISOR_SHIFTS, GROUPS, GROUP_LABEL, WEEKDAY_SHORT, defaultReq, isDebenhamsGroup, reqKey, reqProblem, startOfWeek, todayIST,
  type Group, type Req,
} from '../../../shared/domain';
import WeekPicker from '../components/WeekPicker';
import type { ReqRowDto, Settings } from '../types';

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first
type Cells = Record<string, Req>;

export default function Requirements() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') });
  const [scope, setScope] = useState<'TEMPLATE' | 'WEEK'>('TEMPLATE');
  const [weekStart, setWeekStart] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [cells, setCells] = useState<Cells>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const wsDay = settings.data?.weekStartDay ?? 1;
  const ws = weekStart || startOfWeek(todayIST(), wsDay);

  const data = useQuery({
    queryKey: ['requirements', ws],
    enabled: !!settings.data,
    queryFn: () => api<{ template: ReqRowDto[]; week: ReqRowDto[]; effective: ReqRowDto[]; overridden: boolean }>(`/requirements?weekStart=${ws}`),
  });
  useEffect(() => {
    if (!data.data) return;
    const rows = scope === 'TEMPLATE' ? data.data.template : data.data.effective;
    const c: Cells = {};
    for (const r of rows) c[reqKey(r.group, r.shiftCode, r.dayOfWeek)] = { min: r.min, target: r.target, max: r.max };
    setCells(c);
    setMsg(null);
  }, [data.data, scope]);

  const get = (g: Group, code: string, wd: number): Req => cells[reqKey(g, code, wd)] ?? defaultReq(g);
  const put = (g: Group, code: string, wd: number, r: Req) => setCells((c) => ({ ...c, [reqKey(g, code, wd)]: r }));
  const whole = (v: string) => Math.max(0, Math.floor(Number(v)) || 0);
  const setSimple = (g: Group, code: string, wd: number, v: string) => {
    const n = whole(v);
    put(g, code, wd, { min: n, target: n, max: isDebenhamsGroup(g) ? null : n });
  };
  const setField = (g: Group, code: string, wd: number, field: keyof Req, v: string) => {
    const cur = get(g, code, wd);
    put(g, code, wd, { ...cur, [field]: field === 'max' && v.trim() === '' ? null : whole(v) });
  };

  const save = useMutation({
    mutationFn: () => {
      const rows: ReqRowDto[] = [];
      for (const g of GROUPS)
        for (const s of ADVISOR_SHIFTS)
          for (let wd = 0; wd < 7; wd++) {
            const r = get(g, s.code, wd);
            const d = defaultReq(g);
            if (scope === 'TEMPLATE' && r.min === d.min && r.target === d.target && r.max === d.max) continue;
            const problem = reqProblem(r);
            if (problem) throw new Error(`${GROUP_LABEL[g]}, ${s.code}, ${WEEKDAY_SHORT[wd]}: ${problem}`);
            rows.push({ group: g, shiftCode: s.code, dayOfWeek: wd, ...r });
          }
      return api('/requirements', { method: 'PUT', body: { scope, weekStart: ws, rows } });
    },
    onSuccess: () => { setMsg({ ok: true, text: scope === 'TEMPLATE' ? 'Default template saved' : 'Numbers for this week saved' }); qc.invalidateQueries({ queryKey: ['requirements'] }); qc.invalidateQueries({ queryKey: ['week'] }); },
    onError: (e) => setMsg({ ok: false, text: (e as Error).message }),
  });
  const removeOverride = useMutation({
    mutationFn: () => api(`/requirements?weekStart=${ws}`, { method: 'DELETE' }),
    onSuccess: () => { setMsg({ ok: true, text: 'This week now uses the default template' }); qc.invalidateQueries({ queryKey: ['requirements'] }); qc.invalidateQueries({ queryKey: ['week'] }); },
  });

  return (
    <div className="space-y-4">
      <section className="card space-y-3 p-4">
        <h2 className="text-lg">Staffing needs</h2>
        <p className="max-w-3xl text-sm text-muted">
          Enter how many advisors each group needs on each shift and day. <b>Target</b> is the number you want, <b>minimum</b> must be met, and <b>maximum</b> is never exceeded.
          The two Debenhams groups have no maximum by default, so available non-Mirakl advisors can cover extra demand there. Mirakl teams remain separate.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <fieldset className="flex gap-3 text-sm">
            <legend className="sr-only">Which numbers to edit</legend>
            <label className="flex items-center gap-1"><input type="radio" checked={scope === 'TEMPLATE'} onChange={() => setScope('TEMPLATE')} />Default weekly template</label>
            <label className="flex items-center gap-1"><input type="radio" checked={scope === 'WEEK'} onChange={() => setScope('WEEK')} />One week only</label>
          </fieldset>
          {scope === 'WEEK' && <WeekPicker value={ws} weekStartDay={wsDay} onChange={setWeekStart} />}
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />Show minimum and maximum</label>
        </div>
        {scope === 'WEEK' && (
          <p className="text-sm">
            {data.data?.overridden
              ? <>This week has its own numbers. <button className="btn ml-2" onClick={() => removeOverride.mutate()}>Use the default template instead</button></>
              : <span className="text-muted">This week uses the default template. Saving here creates numbers for this week only.</span>}
          </p>
        )}
        <div className="flex items-center gap-3">
          <button className="btn btn-primary" onClick={() => { setMsg(null); save.mutate(); }} disabled={save.isPending}>Save</button>
          {msg && <span role="status" className={`text-sm ${msg.ok ? 'text-green-800' : 'text-red-700'}`}>{msg.text}</span>}
        </div>
      </section>

      {GROUPS.map((g) => (
        <section key={g} className="card overflow-x-auto">
          <h3 className={`grp-${g} rounded-t px-3 py-2 text-sm`}>{GROUP_LABEL[g]}</h3>
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr>
                <th className="th w-28">Shift</th>
                {DAY_ORDER.map((wd) => <th key={wd} className="th text-center">{WEEKDAY_SHORT[wd]}</th>)}
                <th className="th w-28">All days</th>
              </tr>
            </thead>
            <tbody>
              {ADVISOR_SHIFTS.map((s) => (
                <tr key={s.code} className="border-t border-line">
                  <td className="td font-bold">{s.code}</td>
                  {DAY_ORDER.map((wd) => {
                    const r = get(g, s.code, wd);
                    return (
                      <td key={wd} className="p-1 text-center">
                        {advanced ? (
                          <div className="flex justify-center gap-0.5">
                            <input aria-label={`Minimum ${s.code} ${WEEKDAY_SHORT[wd]}`} title="Minimum" className="input w-11 px-1 text-center" type="number" min={0} value={r.min} onChange={(e) => setField(g, s.code, wd, 'min', e.target.value)} />
                            <input aria-label={`Target ${s.code} ${WEEKDAY_SHORT[wd]}`} title="Target" className="input w-11 px-1 text-center font-bold" type="number" min={0} value={r.target} onChange={(e) => setField(g, s.code, wd, 'target', e.target.value)} />
                            <input aria-label={`Maximum ${s.code} ${WEEKDAY_SHORT[wd]}`} title="Maximum (empty = unlimited)" placeholder="∞" className="input w-11 px-1 text-center" type="number" min={0} value={r.max ?? ''} onChange={(e) => setField(g, s.code, wd, 'max', e.target.value)} />
                          </div>
                        ) : (
                          <input aria-label={`Target ${s.code} ${WEEKDAY_SHORT[wd]}`} className="input w-16 text-center" type="number" min={0} value={r.target} onChange={(e) => setSimple(g, s.code, wd, e.target.value)} />
                        )}
                      </td>
                    );
                  })}
                  <td className="p-1"><FillAll onFill={(v) => DAY_ORDER.forEach((wd) => setSimple(g, s.code, wd, v))} label={`${GROUP_LABEL[g]} ${s.code}`} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line bg-paper">
                <td className="td font-bold">Needed per day</td>
                {DAY_ORDER.map((wd) => <td key={wd} className="td text-center font-bold">{ADVISOR_SHIFTS.reduce((sum, s) => sum + get(g, s.code, wd).target, 0)}</td>)}
                <td />
              </tr>
            </tfoot>
          </table>
        </section>
      ))}
    </div>
  );
}

function FillAll({ onFill, label }: { onFill: (v: string) => void; label: string }) {
  const [v, setV] = useState('');
  return (
    <div className="flex gap-1">
      <input aria-label={`Number for every day, ${label}`} className="input w-12 px-1 text-center" type="number" min={0} value={v} onChange={(e) => setV(e.target.value)} />
      <button className="btn px-2" disabled={v === ''} onClick={() => { onFill(v); setV(''); }}>Fill</button>
    </div>
  );
}
