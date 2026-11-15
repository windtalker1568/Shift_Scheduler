import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, api } from '../api';
import {
  CLASSIFICATIONS, CLASSIFICATION_LABEL, DESIGNATIONS, DESIGNATION_LABEL, GROUP_LABEL, SEGMENTS, SEGMENT_LABEL,
  type Classification, type Designation, type Segment,
} from '../../../shared/domain';
import type { PersonDto, TeamDto } from '../types';

function errText(e: unknown): string {
  if (e instanceof ApiError && Array.isArray(e.details) && e.details.length === 1 && typeof e.details[0] === 'object' && 'message' in e.details[0])
    return e.details[0].message;
  if (e instanceof ApiError && Array.isArray(e.details) && e.details.length)
    return e.details.map((d: any) => (typeof d === 'string' ? d : `Row ${d.row}: ${d.message}`)).join('\n');
  return (e as Error).message;
}
const SAMPLE = 'Full name,Designation,Team leader,E-mail Address,Segment,Team number,Classification\nAsha Rao,Team Leader,,asha.rao@example.com,,12,Normal\nDev Nair,Advisor,Asha Rao,dev.nair@example.com,eGain,,\nMaya Iyer,QA,,maya.iyer@example.com,,,';

export default function PeopleManager({ setupMode = false, onCompleted }: { setupMode?: boolean; onCompleted?: () => void }) {
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ q: '', designation: '', segment: '', teamId: '' });
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]).toString();
  const people = useQuery({ queryKey: ['people', filters], queryFn: () => api<PersonDto[]>('/people?' + query) });
  const everyone = useQuery({ queryKey: ['people', 'all'], queryFn: () => api<PersonDto[]>('/people') });
  const teams = useQuery({ queryKey: ['teams'], queryFn: () => api<TeamDto[]>('/teams') });
  const refresh = () => ['people', 'teams', 'setup', 'week'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const [form, setForm] = useState({ emailAddress: '', name: '', designation: 'ADVISOR' as Designation, segment: 'EGAIN' as Segment, teamId: '', teamNumber: '', classification: 'NORMAL' as Classification });
  const [formError, setFormError] = useState('');
  const add = useMutation({
    mutationFn: () => {
      const base = { emailAddress: form.emailAddress, name: form.name, designation: form.designation };
      const body = form.designation === 'ADVISOR' ? { ...base, segment: form.segment, teamId: form.teamId }
        : form.designation === 'TEAM_LEADER' ? { ...base, teamNumber: form.teamNumber, classification: form.classification } : base;
      return api('/people', { method: 'POST', body });
    },
    onSuccess: () => { refresh(); setForm((f) => ({ ...f, emailAddress: '', name: '', teamNumber: '' })); setFormError(''); },
    onError: (e) => setFormError(errText(e)),
  });

  const [csv, setCsv] = useState('');
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const doImport = useMutation({
    mutationFn: () => api<{ created: number }>('/people/import', { method: 'POST', body: { csv } }),
    onSuccess: (r) => { refresh(); setCsv(''); setImportMsg({ ok: true, text: `Added ${r.created} people` }); },
    onError: (e) => setImportMsg({ ok: false, text: errText(e) }),
  });

  const [problems, setProblems] = useState<string[]>([]);
  const complete = useMutation({
    mutationFn: () => api('/setup/complete', { method: 'POST' }),
    onSuccess: () => onCompleted?.(),
    onError: (e) => setProblems(e instanceof ApiError && Array.isArray(e.details) ? e.details : [(e as Error).message]),
  });

  const teamLabel = (t: TeamDto) => `${t.leaderName ?? 'Team leader'} · Team ${t.teamNumber} · ${CLASSIFICATION_LABEL[t.classification]}`;
  const canAdd = form.emailAddress.trim() && form.name.trim() && (form.designation !== 'ADVISOR' || form.teamId) && (form.designation !== 'TEAM_LEADER' || form.teamNumber);

  return (
    <div className="space-y-4">
      {setupMode && (
        <section className="card border-brand p-4">
          <h2 className="text-lg">Set up your people</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted">Add everyone once: team leaders first (each creates a team), then their advisors, then QA, Trainers and Management. When the list is complete, finish setup to unlock the scheduler. You can still add or remove people afterwards.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className="btn btn-primary" onClick={() => { setProblems([]); complete.mutate(); }} disabled={complete.isPending}>Finish setup</button>
            <span className="text-sm text-muted">{everyone.data?.length ?? 0} people added so far</span>
          </div>
          {problems.length > 0 && <ul role="alert" className="mt-2 list-disc pl-5 text-sm text-red-700">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-3 p-4">
          <h2 className="text-lg">Add a person</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-bold">E-mail Address<input className="input mt-1 w-full" type="email" required value={form.emailAddress} onChange={(e) => setForm({ ...form, emailAddress: e.target.value })} /></label>
            <label className="text-sm font-bold">Full name<input className="input mt-1 w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="text-sm font-bold">Designation
              <select className="input mt-1 w-full" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value as Designation })}>
                {DESIGNATIONS.map((d) => <option key={d} value={d}>{DESIGNATION_LABEL[d]}</option>)}
              </select>
            </label>
            {form.designation === 'ADVISOR' && (
              <>
                <label className="text-sm font-bold">Segment
                  <select className="input mt-1 w-full" value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value as Segment })}>
                    {SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABEL[s]}</option>)}
                  </select>
                </label>
                <label className="text-sm font-bold sm:col-span-2">Team leader
                  <select className="input mt-1 w-full" value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })}>
                    <option value="">Choose a team</option>
                    {teams.data?.map((t) => <option key={t.id} value={t.id}>{teamLabel(t)}{t.leaderName ? ` · ${t.leaderName}` : ''}</option>)}
                  </select>
                </label>
              </>
            )}
            {form.designation === 'TEAM_LEADER' && (
              <>
                <label className="text-sm font-bold">Team number (also the team name)<input className="input mt-1 w-full" type="number" min={1} value={form.teamNumber} onChange={(e) => setForm({ ...form, teamNumber: e.target.value })} /></label>
                <label className="text-sm font-bold">Classification
                  <select className="input mt-1 w-full" value={form.classification} onChange={(e) => setForm({ ...form, classification: e.target.value as Classification })}>
                    {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{CLASSIFICATION_LABEL[c]}</option>)}
                  </select>
                </label>
              </>
            )}
          </div>
          {formError && <p role="alert" className="whitespace-pre-line text-sm text-red-700">{formError}</p>}
          <button className="btn btn-primary" disabled={!canAdd || add.isPending} onClick={() => add.mutate()}>Add person</button>
        </section>

        <section className="card space-y-3 p-4">
          <h2 className="text-lg">Add many at once</h2>
          <p className="text-sm text-muted">Paste comma- or tab-separated rows with Full name, Designation, Team leader and E-mail Address. For advisors, enter the team leader's name; their team number is filled from that leader. Team leader rows need a Team number and Classification, and advisors need a Segment. Nothing is saved unless every row is valid.</p>
          <textarea className="input h-32 w-full font-mono text-xs" placeholder={SAMPLE} value={csv} onChange={(e) => setCsv(e.target.value)} />
          {importMsg && <p role="status" className={`whitespace-pre-line text-sm ${importMsg.ok ? 'text-green-800' : 'text-red-700'}`}>{importMsg.text}</p>}
          <button className="btn btn-primary" disabled={!csv.trim() || doImport.isPending} onClick={() => { setImportMsg(null); doImport.mutate(); }}>Import people</button>
        </section>
      </div>

      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <h2 className="mr-2 text-lg">People</h2>
          <input className="input" placeholder="Search name or email" aria-label="Search" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
          <select className="input" aria-label="Designation" value={filters.designation} onChange={(e) => setFilters({ ...filters, designation: e.target.value })}>
            <option value="">All designations</option>
            {DESIGNATIONS.map((d) => <option key={d} value={d}>{DESIGNATION_LABEL[d]}</option>)}
          </select>
          <select className="input" aria-label="Segment" value={filters.segment} onChange={(e) => setFilters({ ...filters, segment: e.target.value })}>
            <option value="">All segments</option>
            {SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABEL[s]}</option>)}
          </select>
          <select className="input" aria-label="Team" value={filters.teamId} onChange={(e) => setFilters({ ...filters, teamId: e.target.value })}>
            <option value="">All teams</option>
            {teams.data?.map((t) => <option key={t.id} value={t.id}>{teamLabel(t)}</option>)}
          </select>
        </div>
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-white"><tr><th className="th">E-mail Address</th><th className="th">Name</th><th className="th">Designation</th><th className="th">Segment</th><th className="th">Team</th><th className="th">Group</th><th className="th" /></tr></thead>
            <tbody>
              {people.data?.map((p) => <PersonRow key={p.id + p.name + p.emailAddress + p.segment + p.teamId} p={p} teams={teams.data ?? []} onChanged={refresh} teamLabel={teamLabel} />)}
            </tbody>
          </table>
          {people.data?.length === 0 && <p className="p-3 text-sm text-muted">No one matches. Add people above or clear the filters.</p>}
        </div>
      </section>

      <section className="card p-4">
        <h2 className="mb-2 text-lg">Teams</h2>
        <table className="w-full border-collapse">
          <thead><tr><th className="th">Team</th><th className="th">Team leader</th><th className="th">Classification</th><th className="th">Advisors</th><th className="th">Move all advisors to</th></tr></thead>
          <tbody>
            {teams.data?.map((t) => <TeamRow key={t.id} t={t} teams={teams.data!} everyone={everyone.data ?? []} onChanged={refresh} teamLabel={teamLabel} />)}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function PersonRow({ p, teams, onChanged, teamLabel }: { p: PersonDto; teams: TeamDto[]; onChanged: () => void; teamLabel: (t: TeamDto) => string }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(p.name);
  const [emailAddress, setEmailAddress] = useState(p.emailAddress ?? '');
  const [segment, setSegment] = useState<string>(p.segment ?? '');
  const [teamId, setTeamId] = useState(p.teamId ?? '');
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () => api(`/people/${p.id}`, { method: 'PUT', body: { name, emailAddress, ...(p.designation === 'ADVISOR' ? { segment, teamId } : {}) } }),
    onSuccess: () => { setEditing(false); setError(''); onChanged(); },
    onError: (e) => setError(errText(e)),
  });
  const del = useMutation({
    mutationFn: () => api(`/people/${p.id}`, { method: 'DELETE' }),
    onSuccess: onChanged,
    onError: (e) => setError(errText(e)),
  });
  return (
    <>
      <tr className="border-t border-line">
        <td className="td">{editing ? <input className="input w-48" type="email" required value={emailAddress} onChange={(e) => setEmailAddress(e.target.value)} /> : p.emailAddress ?? '–'}</td>
        <td className="td">{editing ? <input className="input w-44" value={name} onChange={(e) => setName(e.target.value)} /> : p.name}</td>
        <td className="td">{DESIGNATION_LABEL[p.designation]}</td>
        <td className="td">{editing && p.designation === 'ADVISOR'
          ? <select className="input" value={segment} onChange={(e) => setSegment(e.target.value)}>{SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABEL[s]}</option>)}</select>
          : p.segment ? SEGMENT_LABEL[p.segment] : '–'}</td>
        <td className="td">{editing && p.designation === 'ADVISOR'
          ? <select className="input" value={teamId} onChange={(e) => setTeamId(e.target.value)}>{teams.map((t) => <option key={t.id} value={t.id}>{teamLabel(t)}</option>)}</select>
          : p.teamNumber ? `Team ${p.teamNumber}` : '–'}</td>
        <td className="td">{p.homeGroup ? GROUP_LABEL[p.homeGroup] : '–'}</td>
        <td className="td whitespace-nowrap text-right">
          {editing ? (
            <>
              <button className="btn btn-primary mr-1" onClick={() => save.mutate()} disabled={save.isPending}>Save</button>
              <button className="btn" onClick={() => { setEditing(false); setError(''); }}>Cancel</button>
            </>
          ) : (
            <>
              <button className="btn mr-1" onClick={() => setEditing(true)}>Edit</button>
              <button className="btn btn-danger" onClick={() => confirm(`Remove ${p.name}? Their future shifts are deleted; past rosters keep their name.`) && del.mutate()}>Remove</button>
            </>
          )}
        </td>
      </tr>
      {error && <tr><td colSpan={7} className="px-2 pb-2 text-sm text-red-700" role="alert">{error}</td></tr>}
    </>
  );
}

function TeamRow({ t, teams, everyone, onChanged, teamLabel }: { t: TeamDto; teams: TeamDto[]; everyone: PersonDto[]; onChanged: () => void; teamLabel: (t: TeamDto) => string }) {
  const [target, setTarget] = useState('');
  const [error, setError] = useState('');
  const classify = useMutation({
    mutationFn: (classification: string) => api(`/teams/${t.id}/classification`, { method: 'PUT', body: { classification } }),
    onSuccess: () => { setError(''); onChanged(); },
    onError: (e) => setError(errText(e)),
  });
  const move = useMutation({
    mutationFn: () => api('/teams/reassign', { method: 'POST', body: { personIds: everyone.filter((p) => p.teamId === t.id && p.designation === 'ADVISOR').map((p) => p.id), toTeamId: target } }),
    onSuccess: () => { setTarget(''); setError(''); onChanged(); },
    onError: (e) => setError(errText(e)),
  });
  return (
    <>
      <tr className="border-t border-line">
        <td className="td font-bold">Team {t.teamNumber}</td>
        <td className="td">{t.leaderName ?? '–'}</td>
        <td className="td">
          <select className="input" value={t.classification} onChange={(e) => classify.mutate(e.target.value)} aria-label={`Classification of team ${t.teamNumber}`}>
            {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{CLASSIFICATION_LABEL[c]}</option>)}
          </select>
        </td>
        <td className="td">{t.advisors}</td>
        <td className="td">
          <select className="input mr-1" value={target} onChange={(e) => setTarget(e.target.value)} aria-label={`Move advisors of team ${t.teamNumber} to`}>
            <option value="">Choose a team</option>
            {teams.filter((x) => x.id !== t.id).map((x) => <option key={x.id} value={x.id}>{teamLabel(x)}</option>)}
          </select>
          <button className="btn" disabled={!target || t.advisors === 0 || move.isPending} onClick={() => move.mutate()}>Move</button>
        </td>
      </tr>
      {error && <tr><td colSpan={5} className="px-2 pb-2 text-sm text-red-700" role="alert">{error}</td></tr>}
    </>
  );
}
