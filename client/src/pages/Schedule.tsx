import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ApiError, api, download } from '../api';
import {
  ADVISOR_SHIFTS, DESIGNATION_LABEL, FIXED_SHIFT, GROUPS, GROUP_LABEL, OT_OPTIONS, REASON_LABEL, WEEKDAY_SHORT,
  rangeLabel, startOfWeek, todayIST, weekdayOf, type Group,
} from '../../../shared/domain';
import CoverageMatrix from '../components/CoverageMatrix';
import WeekPicker from '../components/WeekPicker';
import type { EntryDto, GenerateResult, PersonDto, Settings, WeekData } from '../types';

const ROW_H = 40;
const VIEW_H = 540;
const NAME_W = 230;
const COL_W = 128;
const RANK: Record<string, number> = { TEAM_LEADER: 0, ADVISOR: 1, QA: 2, TRAINER: 3, MANAGEMENT: 4 };
const COLS = `${NAME_W}px repeat(7, ${COL_W}px)`;
const TOTAL_W = NAME_W + 7 * COL_W;

export default function Schedule() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') });
  const [weekStart, setWeekStart] = useState('');
  const wsDay = settings.data?.weekStartDay ?? 1;
  const ws = weekStart || startOfWeek(todayIST(), wsDay);
  const week = useQuery({ queryKey: ['week', ws], queryFn: () => api<WeekData>(`/schedule/${ws}`), enabled: !!settings.data });
  const data = week.data;

  const [f, setF] = useState({ q: '', designation: '', teamId: '', group: '' });
  const [selected, setSelected] = useState<{ personId: string; date: string } | null>(null);
  const [preview, setPreview] = useState<GenerateResult | null>(null);
  const [notice, setNotice] = useState('');
  const [scrollTop, setScrollTop] = useState(0);

  const refresh = () => qc.invalidateQueries({ queryKey: ['week'] });
  const gen = useMutation({
    mutationFn: () => api<GenerateResult>(`/scheduler/${ws}/generate`, { method: 'POST' }),
    onSuccess: (r) => { setPreview(r); setNotice(''); },
    onError: (e) => setNotice((e as Error).message),
  });
  const apply = useMutation({
    mutationFn: () => api<GenerateResult>(`/scheduler/${ws}/apply`, { method: 'POST' }),
    onSuccess: () => { setPreview(null); setNotice('Schedule applied to this week'); refresh(); },
    onError: (e) => setNotice((e as Error).message),
  });
  const copy = useMutation({
    mutationFn: () => api(`/schedule/${ws}/copy-previous`, { method: 'POST' }),
    onSuccess: () => { setNotice('Last week copied into this week'); refresh(); },
    onError: (e) => setNotice((e as Error).message),
  });

  const entryMap = useMemo(() => new Map((data?.entries ?? []).map((e) => [`${e.personId}|${e.date}`, e])), [data]);
  const nameOf = useMemo(() => new Map((data?.people ?? []).map((p) => [p.id, p.name])), [data]);
  const warned = useMemo(() => new Set((data?.warnings ?? []).map((w) => w.personId).filter(Boolean)), [data]);
  const teams = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of data?.people ?? []) if (p.teamId && p.teamNumber) m.set(p.teamId, p.teamNumber);
    return [...m.entries()].sort((a, b) => a[1] - b[1]);
  }, [data]);
  const rows = useMemo(() => {
    const q = f.q.toLowerCase();
    return (data?.people ?? [])
      .filter((p) => (!f.designation || p.designation === f.designation) && (!f.teamId || p.teamId === f.teamId) && (!f.group || p.homeGroup === f.group) && (!q || p.name.toLowerCase().includes(q) || (p.emailAddress ?? '').toLowerCase().includes(q)))
      .sort((a, b) => (a.teamNumber ?? 9999) - (b.teamNumber ?? 9999) || RANK[a.designation] - RANK[b.designation] || a.name.localeCompare(b.name));
  }, [data, f]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 6);
  const last = Math.min(rows.length, Math.ceil((scrollTop + VIEW_H) / ROW_H) + 6);
  const selPerson = selected ? data?.people.find((p) => p.id === selected.personId) : undefined;

  return (
    <div className="space-y-4">
      <section className="card flex flex-wrap items-center gap-3 p-3">
        <WeekPicker value={ws} weekStartDay={wsDay} onChange={(w) => { setWeekStart(w); setPreview(null); setSelected(null); setNotice(''); }} />
        <div className="ml-auto flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={() => gen.mutate()} disabled={gen.isPending}>{gen.isPending ? 'Working…' : 'Generate schedule (preview)'}</button>
          <button className="btn" onClick={() => confirm('Copy last week into this week? Unlocked cells are replaced.') && copy.mutate()}>Copy previous week</button>
          <button className="btn" onClick={() => download(`/export/${ws}`, `roster-${ws}.csv`)}>Export CSV</button>
        </div>
        {notice && <p role="status" className="w-full text-sm">{notice}</p>}
      </section>

      {preview && <PreviewPanel result={preview} dates={data?.dates ?? []} nameOf={nameOf} applying={apply.isPending} onApply={() => apply.mutate()} onDiscard={() => setPreview(null)} />}

      <section className="card p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <input className="input" placeholder="Search name or email" aria-label="Search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
          <select className="input" aria-label="Designation" value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })}>
            <option value="">All designations</option>
            {Object.entries(DESIGNATION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="input" aria-label="Team" value={f.teamId} onChange={(e) => setF({ ...f, teamId: e.target.value })}>
            <option value="">All teams</option>
            {teams.map(([id, n]) => <option key={id} value={id}>Team {n}</option>)}
          </select>
          <select className="input" aria-label="Group" value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })}>
            <option value="">All groups</option>
            {GROUPS.map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
          </select>
          <span className="text-sm text-muted">{rows.length} people</span>
          <span className="ml-auto flex flex-wrap gap-1 text-xs">{GROUPS.map((g) => <span key={g} className={`grp-${g} rounded px-1.5 py-0.5`}>{GROUP_LABEL[g]}</span>)}</span>
        </div>
        {week.isLoading && <p className="p-4 text-sm text-muted">Loading the week…</p>}
        {week.error && <p className="p-4 text-sm text-red-700" role="alert">{(week.error as Error).message}</p>}
        {data && (
          <div style={{ height: VIEW_H, overflow: 'auto' }} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} className="rounded border border-line">
            <div style={{ display: 'grid', gridTemplateColumns: COLS, position: 'sticky', top: 0, zIndex: 2, width: TOTAL_W }} className="border-b border-line bg-white">
              <div className="th">Person</div>
              {data.dates.map((d) => <div key={d} className="th">{WEEKDAY_SHORT[weekdayOf(d)]} {d.slice(8)}/{d.slice(5, 7)}</div>)}
            </div>
            <div style={{ height: rows.length * ROW_H, position: 'relative', width: TOTAL_W }}>
              {rows.slice(first, last).map((p, i) => (
                <div key={p.id} style={{ position: 'absolute', top: (first + i) * ROW_H, height: ROW_H, display: 'grid', gridTemplateColumns: COLS, width: TOTAL_W }} className="items-center border-b border-line">
                  <div className="truncate px-2 text-sm leading-tight">
                    <div className="truncate font-bold">{p.name}{warned.has(p.id) && <span title="Has a warning" className="ml-1 text-red-700">!</span>}</div>
                    <div className="truncate text-xs text-muted">{p.emailAddress ?? '–'} · {DESIGNATION_LABEL[p.designation]}{p.teamNumber ? ` · Team ${p.teamNumber}` : ''}{p.homeGroup ? ` · ${GROUP_LABEL[p.homeGroup]}` : ''}</div>
                  </div>
                  {data.dates.map((d) => (
                    <Cell key={d} person={p} date={d} entry={entryMap.get(`${p.id}|${d}`)} selected={selected?.personId === p.id && selected.date === d} onClick={() => setSelected({ personId: p.id, date: d })} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {selected && selPerson && (
        <CellEditor key={`${selected.personId}|${selected.date}`} person={selPerson} date={selected.date} entry={entryMap.get(`${selected.personId}|${selected.date}`)} onClose={() => setSelected(null)} onSaved={refresh} />
      )}

      {data && (
        <div className="grid gap-4 xl:grid-cols-2">
          <section className="card p-4">
            <h2 className="mb-2 text-lg">Coverage this week</h2>
            <CoverageMatrix cells={data.coverage} dates={data.dates} />
          </section>
          <section className="card p-4">
            <h2 className="mb-2 text-lg">Warnings ({data.warnings.length})</h2>
            {data.warnings.length === 0 ? <p className="text-sm text-muted">No rest, working-day or team-shift problems found.</p> : (
              <ul className="max-h-80 list-disc space-y-1 overflow-auto pl-5 text-sm">
                {data.warnings.slice(0, 80).map((w, i) => <li key={i}>{w.message}</li>)}
                {data.warnings.length > 80 && <li className="text-muted">and {data.warnings.length - 80} more</li>}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Cell({ person, date, entry, selected, onClick }: { person: PersonDto; date: string; entry?: EntryDto; selected: boolean; onClick: () => void }) {
  let cls = '';
  let main = '–';
  let sub = '';
  let title = 'Empty. Click to set.';
  if (entry?.type === 'OFF') { cls = 'bg-gray-100 text-gray-600'; main = 'Off'; title = 'Day off'; }
  else if (entry?.type === 'LEAVE') { cls = 'bg-amber-100 text-amber-900'; main = 'Leave'; title = 'Leave'; }
  else if (entry?.type === 'SHIFT') {
    cls = entry.workGroup ? `grp-${entry.workGroup}` : 'grp-none';
    main = rangeLabel(date, entry.shiftCode!, entry.otHours);
    const moved = person.designation === 'ADVISOR' && entry.workGroup && entry.workGroup !== person.homeGroup;
    sub = [entry.otHours ? `+${entry.otHours}h OT` : '', entry.locked ? 'locked' : '', moved ? `on ${GROUP_LABEL[entry.workGroup!]}` : ''].filter(Boolean).join(' · ');
    title = `${main}${entry.reason ? ` · ${REASON_LABEL[entry.reason as keyof typeof REASON_LABEL] ?? entry.reason}` : ''}${person.designation === 'TEAM_LEADER' ? ' · follows the team' : ''}`;
  }
  return (
    <button className={`cell ${cls} ${selected ? 'cell-selected' : ''}`} onClick={onClick} title={title} aria-label={`${person.name}, ${date}: ${main} ${sub}`}>
      <div className="truncate font-bold">{main}</div>
      {sub && <div className="truncate opacity-80">{sub}</div>}
    </button>
  );
}

function CellEditor({ person, date, entry, onClose, onSaved }: { person: PersonDto; date: string; entry?: EntryDto; onClose: () => void; onSaved: () => void }) {
  const isAdvisor = person.designation === 'ADVISOR';
  const isLeader = person.designation === 'TEAM_LEADER';
  const [type, setType] = useState<string>(entry?.type ?? (isLeader ? 'OFF' : 'SHIFT'));
  const [shiftCode, setShiftCode] = useState(entry?.shiftCode ?? ADVISOR_SHIFTS[2].code);
  const [ot, setOt] = useState(entry?.otHours ?? 0);
  const [workGroup, setWorkGroup] = useState<string>(entry?.workGroup ?? person.homeGroup ?? '');
  const [locked, setLocked] = useState(entry?.locked ?? false);
  const [error, setError] = useState('');
  const groups = person.homeGroup === 'MIRAKL' ? (['MIRAKL'] as Group[]) : GROUPS.filter((g) => g !== 'MIRAKL');
  const done = { onSuccess: () => { setError(''); onSaved(); }, onError: (e: unknown) => setError(e instanceof ApiError ? e.message : (e as Error).message) };
  const save = useMutation({
    mutationFn: () => api('/schedule/entry', { method: 'PUT', body: { personId: person.id, date, type, ...(type === 'SHIFT' && isAdvisor ? { shiftCode, otHours: ot, workGroup: workGroup || undefined } : {}), locked } }),
    ...done,
  });
  const clear = useMutation({ mutationFn: () => api(`/schedule/entry?personId=${person.id}&date=${date}`, { method: 'DELETE' }), ...done });

  return (
    <section className="card space-y-3 border-brand p-4" aria-label="Edit cell">
      <div className="flex items-center justify-between">
        <h2 className="text-base">{person.name} · {date}</h2>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
      {isLeader && <p className="text-sm text-muted">A team leader's shift follows their team automatically. You can set a day off or leave.</p>}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-bold">Day type
          <select className="input mt-1 block" value={type} onChange={(e) => setType(e.target.value)}>
            {!isLeader && <option value="SHIFT">{isAdvisor ? 'Shift' : `Fixed shift ${FIXED_SHIFT.startTime}`}</option>}
            <option value="OFF">Day off</option>
            <option value="LEAVE">Leave</option>
          </select>
        </label>
        {type === 'SHIFT' && isAdvisor && (
          <>
            <label className="text-sm font-bold">Shift start
              <select className="input mt-1 block" value={shiftCode} onChange={(e) => setShiftCode(e.target.value)}>
                {ADVISOR_SHIFTS.map((s) => <option key={s.code} value={s.code}>{s.code} ({rangeLabel(date, s.code, 0)})</option>)}
              </select>
            </label>
            <label className="text-sm font-bold">Overtime
              <select className="input mt-1 block" value={ot} onChange={(e) => setOt(Number(e.target.value))}>
                {OT_OPTIONS.map((h) => <option key={h} value={h}>{h === 0 ? 'None' : `+${h}h (${8 + h}h shift)`}</option>)}
              </select>
            </label>
            <label className="text-sm font-bold">Working in
              <select className="input mt-1 block" value={workGroup} onChange={(e) => setWorkGroup(e.target.value)}>
                {groups.map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}{g === person.homeGroup ? ' (own group)' : ''}</option>)}
              </select>
            </label>
          </>
        )}
        <label className="flex items-center gap-1 pb-2 text-sm"><input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} />Lock (the scheduler will not change it)</label>
        <button className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>Save cell</button>
        <button className="btn btn-danger" onClick={() => clear.mutate()} disabled={clear.isPending || !entry}>Clear cell</button>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </section>
  );
}

function PreviewPanel({ result, dates, nameOf, applying, onApply, onDiscard }: { result: GenerateResult; dates: string[]; nameOf: Map<string, string>; applying: boolean; onApply: () => void; onDiscard: () => void }) {
  const tally = (items: { personId: string }[]) => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.personId, (m.get(i.personId) ?? 0) + 1);
    return [...m.entries()].map(([id, n]) => `${nameOf.get(id) ?? id}: ${n} day${n > 1 ? 's' : ''}`);
  };
  const cross = tally(result.advisorEntries.filter((e) => e.reason === 'CROSS_SEGMENT_NEED'));
  const leftover = tally(result.advisorEntries.filter((e) => e.reason === 'LEFTOVER_TO_DEBENHAMS'));
  const surplus = tally(result.surplus);
  return (
    <section className="card space-y-4 border-brand p-4" aria-label="Schedule preview">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg">Preview of the generated week</h2>
        <button className="btn btn-primary" onClick={onApply} disabled={applying}>{applying ? 'Applying…' : 'Apply to this week'}</button>
        <button className="btn" onClick={onDiscard}>Discard</button>
        <span className="text-sm text-muted">Applying replaces every unlocked cell except leave and days off set by hand.</span>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="rounded bg-paper px-2 py-1">{result.stats.crossSegment} cross-segment days</span>
        <span className="rounded bg-paper px-2 py-1">{result.stats.leftover} leftover days moved to Debenhams</span>
        <span className="rounded bg-paper px-2 py-1">{result.stats.surplus} unplaced days</span>
        <span className="rounded bg-paper px-2 py-1">{result.shortfalls.length} cells below minimum</span>
      </div>
      {result.notes.length > 0 && <ul className="list-disc pl-5 text-sm">{result.notes.map((n) => <li key={n}>{n}</li>)}</ul>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <caption className="pb-1 text-left font-bold">Can the team cover what is needed?</caption>
          <thead><tr><th className="th">Group</th><th className="th">Advisors</th><th className="th">Person-days available</th><th className="th">Target needs</th><th className="th">More advisors for minimum</th><th className="th">More for target</th><th className="th">Spare</th></tr></thead>
          <tbody>
            {result.feasibility.filter((r) => r.advisors > 0 || r.targetPersonDays > 0).map((r) => (
              <tr key={r.group} className="border-t border-line">
                <td className="td"><span className={`grp-${r.group} rounded px-1.5 py-0.5 text-xs font-bold`}>{GROUP_LABEL[r.group]}</span></td>
                <td className="td">{r.advisors}</td><td className="td">{r.availablePersonDays}</td><td className="td">{r.targetPersonDays}</td>
                <td className={`td ${r.shortForMin ? 'font-bold text-red-700' : ''}`}>{r.shortForMin}</td>
                <td className={`td ${r.shortForTarget ? 'font-bold text-amber-800' : ''}`}>{r.shortForTarget}</td>
                <td className="td">{r.spareForTarget}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <List title="Shortfalls" empty="Every minimum is met." items={result.shortfalls.slice(0, 30).map((s) => `${GROUP_LABEL[s.group]}, ${s.date}, ${s.shiftCode}: minimum ${s.min}, scheduled ${s.scheduled}. ${s.why}`)} />
        <List title="Covering another segment (business need)" empty="None needed." items={cross.slice(0, 40)} />
        <List title="Leftover advisors moved to Debenhams" empty="None." items={leftover.slice(0, 40)} />
      </div>
      <List title="Surplus advisors (not placed)" empty="Everyone has a place." items={surplus.slice(0, 40)} />
      <CoverageMatrix cells={result.coverage} dates={dates} />
    </section>
  );
}

function List({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div>
      <h3 className="mb-1 text-sm">{title}</h3>
      {items.length === 0 ? <p className="text-sm text-muted">{empty}</p> : <ul className="max-h-48 list-disc space-y-1 overflow-auto pl-5 text-sm">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>}
    </div>
  );
}
