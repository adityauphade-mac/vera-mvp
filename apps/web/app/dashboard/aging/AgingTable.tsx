import {
  AgingChip,
  AnomalyTag,
  Card,
  HeatMeter,
  Table,
  TableCell,
  TableHead,
  TableRow,
  TableShell,
} from '@vera/ui';
import { formatUSD } from '@vera/utils';
import type { ARJob } from '@vera/types';

const COLUMNS = [
  { key: 'job', label: 'Job', tooltip: 'Address and job classification.' },
  { key: 'rep', label: 'Rep', tooltip: 'Sales rep responsible for the install.', width: '160px' },
  {
    key: 'balance',
    label: 'Balance',
    align: 'right' as const,
    tooltip: 'Outstanding amount on the primary estimate.',
    width: '120px',
  },
  { key: 'aging', label: 'Aging', tooltip: 'Bucket relative to terms.', width: '120px' },
  {
    key: 'days',
    label: 'Days past',
    align: 'right' as const,
    tooltip: 'Days past the agreed terms (Net 30 retail, Net 60 insurance).',
    width: '90px',
  },
  {
    key: 'heat',
    label: 'Heat',
    align: 'right' as const,
    tooltip:
      'Composite 0–100 score: 40% days past terms · 25% balance · 20% rep silence · 15% anomalies.',
    width: '220px',
  },
];

export function AgingTable({ jobs }: { jobs: ARJob[] }) {
  if (jobs.length === 0) {
    return (
      <Card>
        <p className="text-text-secondary">
          Nothing matches the current filter. Clear it to see the full list.
        </p>
      </Card>
    );
  }

  return (
    <TableShell maxHeight={640}>
      <Table>
        <TableHead columns={COLUMNS} />
        <tbody>
          {jobs.map((job) => (
            <TableRow key={job.id}>
              <TableCell>
                <p className="text-text-primary font-medium">{job.address}</p>
                <p className="text-text-muted mt-0.5 text-xs">
                  {job.region ?? '—'} · {job.isInsurance ? 'Insurance' : 'Retail'}
                </p>
                {job.anomalies.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {job.anomalies.slice(0, 2).map((flag) => (
                      <AnomalyTag key={flag} flag={flag} />
                    ))}
                    {job.anomalies.length > 2 ? (
                      <span
                        title={`${job.anomalies.length - 2} more anomalies on this job`}
                        className="text-text-muted inline-flex items-center rounded-full px-2 text-xs"
                      >
                        +{job.anomalies.length - 2}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </TableCell>
              <TableCell className="text-text-secondary">
                {job.rep?.name ?? 'Unassigned'}
              </TableCell>
              <TableCell align="right" className="tabular-nums">
                {formatUSD(job.balance)}
              </TableCell>
              <TableCell>
                <AgingChip bucket={job.agingBucket} />
              </TableCell>
              <TableCell align="right" className="tabular-nums">
                {job.daysPastTerms === 0 ? (
                  <span className="text-text-muted">—</span>
                ) : (
                  job.daysPastTerms
                )}
              </TableCell>
              <TableCell align="right">
                <div className="flex justify-end">
                  <HeatMeter
                    score={job.heatScore}
                    band={job.heatBand}
                    breakdown={job.heatBreakdown}
                    variant="compact"
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </tbody>
      </Table>
    </TableShell>
  );
}
