import { formatUSD } from '@vera/utils';
import type { RepRollup } from '@vera/types';

const HEADERS: Array<{ label: string; align?: 'right'; tooltip: string }> = [
  { label: '#', tooltip: 'Rank in the current sort.' },
  { label: 'Rep', tooltip: 'Sales rep name and email if known.' },
  { label: 'Outstanding', align: 'right', tooltip: 'Sum of all open balances on this rep\'s installs.' },
  { label: '', tooltip: 'Visual share of the leader.' },
  { label: 'Jobs', align: 'right', tooltip: 'Number of AR jobs assigned to this rep.' },
  { label: 'Hot · Crit', align: 'right', tooltip: 'Hot (51–75) and Critical (76+) jobs in this rep\'s book.' },
  { label: 'Oldest', align: 'right', tooltip: 'Oldest job\'s days past terms across this rep\'s book.' },
  { label: 'Avg heat', align: 'right', tooltip: 'Mean of every job\'s heat score for this rep.' },
];

export function Leaderboard({ reps, totalAR }: { reps: RepRollup[]; totalAR: number }) {
  const max = reps[0]?.totalOutstanding ?? 0;
  return (
    <div className="border-border bg-bg-card overflow-hidden rounded-[var(--radius-card)] border">
      <div className="max-h-[640px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-bg-card sticky top-0 z-10">
            <tr className="border-border text-text-muted border-b text-left text-[0.65rem] tracking-[0.15em] uppercase">
              {HEADERS.map((h, i) => (
                <th
                  key={i}
                  title={h.tooltip}
                  className={`px-5 py-3 font-medium ${h.align === 'right' ? 'text-right' : ''}`}
                >
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {reps.map((r, idx) => {
              const pct = max > 0 ? Math.round((r.totalOutstanding / max) * 100) : 0;
              const sharePct =
                totalAR > 0 ? Math.round((r.totalOutstanding / totalAR) * 100) : 0;
              return (
                <tr
                  key={r.rep.id}
                  className="border-border last:border-b-0 border-b transition-colors hover:bg-[color:var(--color-bg-base)]"
                >
                  <td className="text-text-muted px-5 py-4 tabular-nums">{idx + 1}</td>
                  <td className="px-5 py-4">
                    <p className="text-text-primary font-medium">{r.rep.name}</p>
                    {r.rep.email ? (
                      <p className="text-text-muted text-xs">{r.rep.email}</p>
                    ) : null}
                  </td>
                  <td className="px-5 py-4 text-right tabular-nums">
                    <p className="font-medium">{formatUSD(r.totalOutstanding)}</p>
                    <p className="text-text-muted text-xs">{sharePct}% of total</p>
                  </td>
                  <td className="hidden px-5 py-4 md:table-cell">
                    <div className="bg-bg-base h-1.5 w-full rounded-full">
                      <div
                        className="bg-accent h-full rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-5 py-4 text-right tabular-nums">{r.jobCount}</td>
                  <td className="px-5 py-4 text-right tabular-nums">
                    <span className="text-heat-hot">{r.hotJobs}</span>
                    <span className="text-text-muted"> · </span>
                    <span className="text-heat-critical">{r.criticalJobs}</span>
                  </td>
                  <td className="px-5 py-4 text-right tabular-nums">
                    {r.oldestDaysPastTerms === 0 ? (
                      <span className="text-text-muted">—</span>
                    ) : (
                      `${r.oldestDaysPastTerms}d`
                    )}
                  </td>
                  <td className="px-5 py-4 text-right tabular-nums">{r.averageHeatScore}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
