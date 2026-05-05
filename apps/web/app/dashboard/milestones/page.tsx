import {
  AgingChip,
  Card,
  HeatMeter,
  MetricTile,
  MissingStepTag,
  Table,
  TableCell,
  TableHead,
  TableRow,
  TableShell,
  VeraQuote,
} from '@vera/ui';
import { formatUSD } from '@vera/utils';
import { getData } from '@/lib/data';

const COLUMNS = [
  { key: 'job', label: 'Job', tooltip: 'Address and job classification.' },
  {
    key: 'rep',
    label: 'Rep',
    width: '160px',
    tooltip: 'Sales rep responsible for the install.',
  },
  {
    key: 'missing',
    label: 'Missing milestones',
    tooltip: 'Cert of completion, final check, and commission request — whichever are missing.',
  },
  {
    key: 'balance',
    label: 'Balance',
    align: 'right' as const,
    width: '120px',
    tooltip: 'Outstanding amount on the primary estimate.',
  },
  {
    key: 'aging',
    label: 'Aging',
    width: '120px',
    tooltip: "Bucket relative to the customer's terms.",
  },
  {
    key: 'heat',
    label: 'Heat',
    align: 'right' as const,
    width: '220px',
    tooltip: 'Composite 0–100 score.',
  },
];

export default function MilestonesPage() {
  const { jobs } = getData();

  const sorted = [...jobs].sort((a, b) => {
    if (b.missingMilestones.length !== a.missingMilestones.length) {
      return b.missingMilestones.length - a.missingMilestones.length;
    }
    return b.daysSinceInstall - a.daysSinceInstall;
  });

  const noCert = jobs.filter((j) => !j.hasCertOfCompletion).length;
  const noFinalCheck = jobs.filter((j) => j.isInsurance && !j.hasFinalCheckEndorsed).length;
  const noCommission = jobs.filter((j) => !j.hasCommissionRequest).length;
  const allClear = jobs.filter((j) => j.missingMilestones.length === 0).length;

  const narrative = composeNarrative({
    total: jobs.length,
    allClear,
    noCert,
    noFinalCheck,
  });

  return (
    <div className="mx-auto max-w-7xl space-y-10">
      <header className="space-y-3 vera-rise">
        <p className="text-text-muted text-xs tracking-[0.2em] uppercase">
          Daily · job milestone tracking
        </p>
        <h1 className="font-display text-4xl tracking-tight md:text-5xl">
          Where each install actually stands
        </h1>
        <VeraQuote>{narrative}</VeraQuote>
      </header>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4 vera-rise-delay-1">
        <MetricTile
          label="Missing cert of completion"
          value={noCert}
          hint="Blocks the final check"
          emphasis={noCert > 0 ? 'critical' : 'default'}
        />
        <MetricTile
          label="Insurance — final check open"
          value={noFinalCheck}
          hint="Depreciation outstanding"
          emphasis="accent"
        />
        <MetricTile
          label="No commission requested"
          value={noCommission}
          hint="A behavioral tell from the rep"
        />
        <MetricTile label="Paperwork current" value={allClear} hint="Nothing to chase" />
      </section>

      <section className="space-y-3 vera-rise-delay-2">
        <h2 className="text-text-secondary text-sm tracking-[0.2em] uppercase">
          By job — most gaps first
        </h2>
        {sorted.length === 0 ? (
          <Card>
            <p className="text-text-secondary">No AR jobs to track milestones for today.</p>
          </Card>
        ) : (
          <TableShell maxHeight={720}>
            <Table>
              <TableHead columns={COLUMNS} />
              <tbody>
                {sorted.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>
                      <p className="text-text-primary font-medium">{job.address}</p>
                      <p className="text-text-muted mt-0.5 text-xs">
                        {job.region ?? '—'} · {job.isInsurance ? 'Insurance' : 'Retail'} ·{' '}
                        {job.daysSinceInstall} days post-install
                      </p>
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {job.rep?.name ?? 'Unassigned'}
                    </TableCell>
                    <TableCell>
                      {job.missingMilestones.length === 0 ? (
                        <span className="text-success inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
                          <span className="bg-success inline-block h-1.5 w-1.5 rounded-full" />
                          Paperwork current
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {job.missingMilestones.map((label) => (
                            <MissingStepTag key={label} label={label} />
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell align="right" className="tabular-nums">
                      {formatUSD(job.balance)}
                    </TableCell>
                    <TableCell>
                      <AgingChip bucket={job.agingBucket} />
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
        )}
      </section>
    </div>
  );
}

function composeNarrative({
  total,
  allClear,
  noCert,
  noFinalCheck,
}: {
  total: number;
  allClear: number;
  noCert: number;
  noFinalCheck: number;
}): string {
  if (allClear === total) {
    return "Every AR job has its paperwork current today. That's a clean board.";
  }
  const parts: string[] = [];
  if (noCert > 0) {
    parts.push(
      `${noCert} ${noCert === 1 ? 'install is' : 'installs are'} sitting without a certificate of completion`,
    );
  }
  if (noFinalCheck > 0) {
    parts.push(
      `${noFinalCheck} insurance ${noFinalCheck === 1 ? 'job is' : 'jobs are'} still waiting on the depreciation check`,
    );
  }
  const intro = parts.length === 0 ? 'A few jobs are missing milestone steps' : parts.join(' and ');
  return `${intro}. The table below is sorted by how many gaps each job has — anything I see, you can see.`;
}
