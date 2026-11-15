import { useMemo } from 'react';
import { GROUPS, GROUP_LABEL, WEEKDAY_SHORT, weekdayOf } from '../../../shared/domain';
import type { CoverageCell } from '../types';

const LEGEND: [string, string][] = [
  ['cov-BELOW_MIN', 'Below minimum'],
  ['cov-BELOW_TARGET', 'Below target'],
  ['cov-AT_TARGET', 'At target'],
  ['cov-ABOVE_TARGET', 'Above target'],
  ['cov-ABOVE_MAX', 'Above maximum'],
];

/** Scheduled / target for every group and shift, per day. Hover a cell for minimum and maximum. */
export default function CoverageMatrix({ cells, dates }: { cells: CoverageCell[]; dates: string[] }) {
  const rows = useMemo(() => {
    const m = new Map<string, Map<string, CoverageCell>>();
    for (const c of cells) {
      const k = `${c.group}|${c.shiftCode}`;
      if (!m.has(k)) m.set(k, new Map());
      m.get(k)!.set(c.date, c);
    }
    return [...m.entries()].sort(([a], [b]) => GROUPS.indexOf(a.split('|')[0] as any) - GROUPS.indexOf(b.split('|')[0] as any) || a.localeCompare(b));
  }, [cells]);

  if (!rows.length) return <p className="text-sm text-muted">No staffing needs are set for this week yet. Add them under Staffing needs.</p>;
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2 text-xs">
        {LEGEND.map(([cls, label]) => <span key={cls} className={`rounded px-2 py-0.5 ${cls}`}>{label}</span>)}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="th">Group and shift</th>
              {dates.map((d) => <th key={d} className="th text-center">{WEEKDAY_SHORT[weekdayOf(d)]} {d.slice(8)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, byDate]) => {
              const [g, shift] = k.split('|');
              return (
                <tr key={k} className="border-t border-line">
                  <td className="td whitespace-nowrap"><span className={`grp-${g} mr-2 rounded px-1.5 py-0.5 text-xs font-bold`}>{GROUP_LABEL[g as keyof typeof GROUP_LABEL]}</span>{shift}</td>
                  {dates.map((d) => {
                    const c = byDate.get(d);
                    return (
                      <td key={d} className="p-0.5 text-center">
                        {c ? <div className={`rounded px-1 py-1 ${'cov-' + c.status}`} title={`Scheduled ${c.scheduled}. Minimum ${c.min}, target ${c.target}, maximum ${c.max ?? 'unlimited'}`}>{c.scheduled}/{c.target}</div> : <span className="text-muted">–</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
