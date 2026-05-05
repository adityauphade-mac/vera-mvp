import {
  Table,
  TableCell,
  TableHead,
  TableRow,
  TableShell,
} from '@vera/ui';
import { formatUSD } from '@vera/utils';
import type { RepRollup } from '@vera/types';

type SortKey = 'dollars' | 'count' | 'oldest' | 'heat';

const COLUMNS = [
  { key: 'rank', label: '#', width: '52px', tooltip: 'Rank in the current sort.' },
  { key: 'rep', label: 'Rep', tooltip: 'Sales rep name and email if known.' },
  {
    key: 'outstanding',
    label: 'Outstanding',
    align: 'right' as const,
    tooltip: "Sum of all open balances on this rep's installs.",
  },
  {
    key: 'jobs',
    label: 'Jobs',
    align: 'right' as const,
    tooltip: 'Number of AR jobs assigned to this rep.',
  },
  {
    key: 'heat',
    label: 'Hot · Crit',
    align: 'right' as const,
    tooltip: "Hot (51–75) and Critical (76+) jobs in this rep's book.",
  },
  {
    key: 'oldest',
    label: 'Oldest',
    align: 'right' as const,
    tooltip: "Oldest job's days past terms across this rep's book.",
  },
  {
    key: 'avg',
    label: 'Avg heat',
    align: 'right' as const,
    tooltip: "Mean of every job's heat score for this rep.",
  },
];

export function Leaderboard({
  reps,
  totalAR,
  sort,
}: {
  reps: RepRollup[];
  totalAR: number;
  sort: SortKey;
}) {
  return (
    <TableShell maxHeight={640}>
      <Table>
        <TableHead columns={COLUMNS} />
        <tbody>
          {reps.map((r, idx) => {
            const sharePct =
              totalAR > 0 ? Math.round((r.totalOutstanding / totalAR) * 100) : 0;
            return (
              <TableRow key={r.rep.id}>
                <TableCell className="text-text-muted tabular-nums">{idx + 1}</TableCell>
                <TableCell>
                  <p className="text-text-primary font-medium">{r.rep.name}</p>
                  {r.rep.email ? (
                    <p className="text-text-muted text-xs">{r.rep.email}</p>
                  ) : null}
                </TableCell>
                <TableCell align="right" className="tabular-nums">
                  <p className="font-medium">{formatUSD(r.totalOutstanding)}</p>
                  {sort === 'dollars' && (
                    <p className="text-text-muted text-xs">{sharePct}% of total</p>
                  )}
                </TableCell>
                <TableCell align="right" className="tabular-nums">
                  {r.jobCount}
                </TableCell>
                <TableCell align="right" className="tabular-nums">
                  <span className="text-heat-hot">{r.hotJobs}</span>
                  <span className="text-text-muted"> · </span>
                  <span className="text-heat-critical">{r.criticalJobs}</span>
                </TableCell>
                <TableCell align="right" className="tabular-nums">
                  {r.oldestDaysPastTerms === 0 ? (
                    <span className="text-text-muted">—</span>
                  ) : (
                    `${r.oldestDaysPastTerms}d`
                  )}
                </TableCell>
                <TableCell align="right" className="tabular-nums">
                  {r.averageHeatScore}
                </TableCell>
              </TableRow>
            );
          })}
        </tbody>
      </Table>
    </TableShell>
  );
}
