'use client';

import { useMemo } from 'react';
import {
  useQueryState,
  parseAsInteger,
  parseAsArrayOf,
  parseAsString,
  parseAsStringEnum,
} from 'nuqs';
import {
  BarChart,
  Card,
  FilterMenu,
  type FilterGroup,
  MetricTile,
  Table,
  TableCell,
  TableHead,
  TableRow,
  TablePagination,
  type PageSize,
  TableShell,
  TableToolbar,
  Tooltip,
  VeraQuote,
} from '@vera/ui';
import { formatUSD } from '@vera/utils';
import type { ARJob, Rep } from '@vera/types';

type MetricKey =
  | 'outstanding'
  | 'jobCount'
  | 'oldest'
  | 'avgHeat'
  | 'installValue'
  | 'commissions'
  | 'installCount';

type PeriodKey = 'mtd' | 'ytd' | 'lastMonth' | '30d' | '90d' | '12m' | 'all';

const METRIC_OPTIONS: Array<{
  value: MetricKey;
  label: string;
  hint: string;
  needsPeriod: boolean;
  unit: 'usd' | 'count' | 'days' | 'heat';
}> = [
  {
    value: 'outstanding',
    label: 'Total outstanding',
    hint: 'Sum of open balances across the rep\'s AR jobs',
    needsPeriod: false,
    unit: 'usd',
  },
  {
    value: 'jobCount',
    label: 'AR job count',
    hint: 'Number of AR jobs the rep owns',
    needsPeriod: false,
    unit: 'count',
  },
  {
    value: 'oldest',
    label: 'Oldest aging',
    hint: 'Days past terms on the rep\'s oldest job',
    needsPeriod: false,
    unit: 'days',
  },
  {
    value: 'avgHeat',
    label: 'Average heat',
    hint: 'Mean heat score across the rep\'s AR jobs',
    needsPeriod: false,
    unit: 'heat',
  },
  {
    value: 'installValue',
    label: 'Install value',
    hint: 'Sum of contract price (gt_price) for installs in the period',
    needsPeriod: true,
    unit: 'usd',
  },
  {
    value: 'commissions',
    label: 'Commissions earned',
    hint: 'Sum of commission amounts from the rep\'s installs in the period',
    needsPeriod: true,
    unit: 'usd',
  },
  {
    value: 'installCount',
    label: 'Installs completed',
    hint: 'Number of installs completed in the period',
    needsPeriod: true,
    unit: 'count',
  },
];

const PERIOD_OPTIONS: Array<{ value: PeriodKey; label: string }> = [
  { value: 'mtd', label: 'MTD' },
  { value: 'ytd', label: 'YTD' },
  { value: 'lastMonth', label: 'Last month' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '12m', label: 'Last 12 months' },
  { value: 'all', label: 'All time' },
];

function periodWindow(period: PeriodKey, asOf: Date): { start: Date; end: Date } {
  const end = new Date(asOf);
  const start = new Date(asOf);
  if (period === 'mtd') {
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
  } else if (period === 'ytd') {
    start.setUTCMonth(0, 1);
    start.setUTCHours(0, 0, 0, 0);
  } else if (period === 'lastMonth') {
    end.setUTCDate(1);
    end.setUTCHours(0, 0, 0, 0);
    start.setTime(end.getTime());
    start.setUTCMonth(start.getUTCMonth() - 1);
  } else if (period === '30d') {
    start.setUTCDate(start.getUTCDate() - 30);
  } else if (period === '90d') {
    start.setUTCDate(start.getUTCDate() - 90);
  } else if (period === '12m') {
    start.setUTCFullYear(start.getUTCFullYear() - 1);
  } else {
    start.setTime(0);
  }
  return { start, end };
}

interface RepRow {
  rep: Rep;
  outstanding: number;
  jobCount: number;
  oldest: number;
  avgHeat: number;
  hotJobs: number;
  criticalJobs: number;
  installValue: number;
  commissions: number;
  installCount: number;
}

function fmt(value: number, unit: 'usd' | 'count' | 'days' | 'heat'): string {
  if (unit === 'usd') return formatUSD(value);
  if (unit === 'days') return value === 0 ? '—' : `${value}d`;
  return value.toString();
}

export function RepLeaderboardView({
  jobs,
  asOf,
}: {
  jobs: ARJob[];
  reps: unknown[]; // unused — we recompute below
  asOf: string;
}) {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [pageSize, setPageSize] = useQueryState(
    'pageSize',
    parseAsInteger.withDefault(25),
  );
  const [metric, setMetric] = useQueryState(
    'metric',
    parseAsStringEnum<MetricKey>([
      'outstanding',
      'jobCount',
      'oldest',
      'avgHeat',
      'installValue',
      'commissions',
      'installCount',
    ]).withDefault('outstanding'),
  );
  const [period, setPeriod] = useQueryState(
    'period',
    parseAsStringEnum<PeriodKey>([
      'mtd',
      'ytd',
      'lastMonth',
      '30d',
      '90d',
      '12m',
      'all',
    ]).withDefault('all'),
  );
  const [regionFilter, setRegionFilter] = useQueryState(
    'regions',
    parseAsArrayOf(parseAsString).withDefault([]),
  );
  const [jobTypeFilter, setJobTypeFilter] = useQueryState(
    'jobTypes',
    parseAsArrayOf(parseAsString).withDefault([]),
  );

  const filterGroups: FilterGroup[] = useMemo(() => {
    const regionCounts = new Map<string, number>();
    const jobTypeCounts = new Map<string, number>();
    for (const j of jobs) {
      if (j.region) regionCounts.set(j.region, (regionCounts.get(j.region) ?? 0) + 1);
      if (j.jobType)
        jobTypeCounts.set(j.jobType, (jobTypeCounts.get(j.jobType) ?? 0) + 1);
    }
    return [
      {
        key: 'regions',
        label: 'Region',
        options: [...regionCounts.entries()]
          .sort()
          .map(([r, c]) => ({ value: r, label: r, count: c })),
      },
      {
        key: 'jobTypes',
        label: 'Job type',
        options: [...jobTypeCounts.entries()].map(([t, c]) => ({
          value: t,
          label: t === 'r' ? 'Residential' : t === 'c' ? 'Commercial' : t,
          count: c,
        })),
      },
    ];
  }, [jobs]);

  const asOfDate = new Date(asOf);
  const { start, end } = periodWindow(period as PeriodKey, asOfDate);

  // Apply filters at the JOB level first
  const filteredJobs = useMemo(() => {
    return jobs.filter((j) => {
      if (regionFilter.length > 0 && !regionFilter.includes(j.region ?? '')) return false;
      if (jobTypeFilter.length > 0 && !jobTypeFilter.includes(j.jobType ?? ''))
        return false;
      return true;
    });
  }, [jobs, regionFilter, jobTypeFilter]);

  // Build rep rows using filtered jobs + period for period-sensitive metrics.
  const repRows: RepRow[] = useMemo(() => {
    const byRep = new Map<number, RepRow>();
    for (const j of filteredJobs) {
      if (!j.rep) continue;
      let row = byRep.get(j.rep.id);
      if (!row) {
        row = {
          rep: j.rep,
          outstanding: 0,
          jobCount: 0,
          oldest: 0,
          avgHeat: 0,
          hotJobs: 0,
          criticalJobs: 0,
          installValue: 0,
          commissions: 0,
          installCount: 0,
        };
        byRep.set(j.rep.id, row);
      }
      row.outstanding += j.balance;
      row.jobCount += 1;
      row.oldest = Math.max(row.oldest, j.daysPastTerms);
      row.avgHeat += j.heatScore;
      if (j.heatBand === 'hot') row.hotJobs += 1;
      if (j.heatBand === 'critical') row.criticalJobs += 1;

      // Period-sensitive metrics (use install date)
      const installAt = new Date(j.dateCompleted);
      if (installAt >= start && installAt < end) {
        row.installValue += j.gtPrice;
        row.commissions += j.commissions;
        row.installCount += 1;
      }
    }
    for (const r of byRep.values()) {
      r.avgHeat = r.jobCount === 0 ? 0 : Math.round(r.avgHeat / r.jobCount);
    }
    return [...byRep.values()];
  }, [filteredJobs, start, end]);

  const sortedRows = useMemo(
    () => [...repRows].sort((a, b) => (b[metric as keyof RepRow] as number) - (a[metric as keyof RepRow] as number)),
    [repRows, metric],
  );

  const activeMetric = METRIC_OPTIONS.find((m) => m.value === metric)!;
  const top10 = sortedRows.slice(0, 10);
  const top = sortedRows[0];
  const totalAR = sortedRows.reduce((s, r) => s + r.outstanding, 0);
  const totalInstalls = sortedRows.reduce((s, r) => s + r.installCount, 0);
  const totalCommissions = sortedRows.reduce((s, r) => s + r.commissions, 0);
  const totalInstallValue = sortedRows.reduce((s, r) => s + r.installValue, 0);
  const totalJobCount = sortedRows.reduce((s, r) => s + r.jobCount, 0);
  const avgHeat =
    sortedRows.length === 0
      ? 0
      : Math.round(sortedRows.reduce((s, r) => s + r.avgHeat, 0) / sortedRows.length);
  const avgOldest =
    sortedRows.length === 0
      ? 0
      : Math.round(sortedRows.reduce((s, r) => s + r.oldest, 0) / sortedRows.length);

  // Second KPI tile swaps with the selected metric. Tooltip carries the same
  // language as the metric option's `hint`, just rephrased at the company level.
  const periodLabel = PERIOD_OPTIONS.find((p) => p.value === period)!.label;
  const secondaryByMetric: Record<MetricKey, { label: string; value: string | number; tooltip: string }> = {
    outstanding: {
      label: 'Total outstanding',
      value: formatUSD(totalAR),
      tooltip: 'Sum of outstanding balances across all reps in the current view.',
    },
    jobCount: {
      label: 'Total AR jobs',
      value: totalJobCount,
      tooltip: 'Total AR jobs across all reps in the current view.',
    },
    oldest: {
      label: 'Avg oldest aging',
      value: `${avgOldest}d`,
      tooltip: 'Average of each rep\'s oldest-job days-past-terms across the current view.',
    },
    avgHeat: {
      label: 'Company avg heat',
      value: avgHeat,
      tooltip: 'Mean heat score averaged across reps in the current view.',
    },
    installValue: {
      label: `Total install value · ${periodLabel}`,
      value: formatUSD(totalInstallValue),
      tooltip: `Sum of install contract value across all reps for ${periodLabel.toLowerCase()}.`,
    },
    commissions: {
      label: `Total commissions · ${periodLabel}`,
      value: formatUSD(totalCommissions),
      tooltip: `Sum of commissions across all reps for ${periodLabel.toLowerCase()}.`,
    },
    installCount: {
      label: `Total installs · ${periodLabel}`,
      value: totalInstalls,
      tooltip: `Total installs completed across all reps for ${periodLabel.toLowerCase()}.`,
    },
  };
  const secondaryKpi = secondaryByMetric[metric as MetricKey];

  const safePageSize = pageSize as PageSize;
  const pagedRows = sortedRows.slice((page - 1) * safePageSize, page * safePageSize);
  const filterCount = regionFilter.length + jobTypeFilter.length;

  const COLUMNS = [
    { key: 'rank', label: '#', width: '52px', tooltip: 'Rank in the current sort.' },
    { key: 'rep', label: 'Rep', tooltip: 'Sales rep name and email if known.' },
    {
      key: 'metric',
      label: activeMetric.label,
      align: 'right' as const,
      tooltip: activeMetric.hint,
    },
    { key: 'outstanding', label: 'Outstanding', align: 'right' as const, width: '140px', tooltip: 'Sum of open balances on AR jobs.' },
    { key: 'jobs', label: 'Jobs', align: 'right' as const, width: '80px', tooltip: 'AR job count.' },
    {
      key: 'heat',
      label: 'Hot · Crit',
      align: 'right' as const,
      width: '130px',
      tooltip: 'Hot (51–75) and Critical (76+) jobs in this rep\'s book.',
    },
    {
      key: 'avg',
      label: 'Avg heat',
      align: 'right' as const,
      width: '110px',
      tooltip: 'Mean heat score across the rep\'s jobs.',
    },
  ];

  const narrative = top
    ? `${top.rep.name} leads on ${activeMetric.label.toLowerCase()} — ${fmt(top[metric as keyof RepRow] as number, activeMetric.unit)}${
        activeMetric.needsPeriod
          ? ` over ${PERIOD_OPTIONS.find((p) => p.value === period)!.label.toLowerCase()}`
          : ''
      }. The leaderboard re-orders by whichever metric you pick above.`
    : 'No reps in this view.';

  return (
    <div className="mx-auto max-w-7xl space-y-10">
      <header className="space-y-3 vera-rise">
        <p className="text-text-muted text-xs tracking-[0.2em] uppercase">
          Weekly · rep leaderboard
        </p>
        <h1 className="font-display text-4xl tracking-tight md:text-5xl">
          Where the money is by rep.
        </h1>
        <VeraQuote>{narrative}</VeraQuote>
      </header>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4 vera-rise-delay-1">
        <MetricTile
          label="Reps with AR"
          value={sortedRows.length}
          tooltip="Number of distinct reps owning at least one AR job in the current view."
        />
        <MetricTile
          label={secondaryKpi.label}
          value={secondaryKpi.value}
          tooltip={secondaryKpi.tooltip}
        />
        <MetricTile
          label={`Installs · ${periodLabel}`}
          value={totalInstalls}
          tooltip="Number of installs completed in the selected period."
        />
        <MetricTile
          label={`Commissions · ${periodLabel}`}
          value={formatUSD(totalCommissions)}
          tooltip="Sum of commission amounts on installs completed in the selected period."
        />
      </section>

      {/* Metric + period selectors */}
      <section className="space-y-4 vera-rise-delay-2">
        <Card>
          <div className="space-y-1">
            <h2 className="text-text-secondary text-sm tracking-[0.2em] uppercase">
              Slice the leaderboard
            </h2>
            <p className="text-text-muted text-xs">
              Pick a metric, then a window. The chart, leaderboard, and tiles all respond.
            </p>
          </div>
          <div className="mt-6 space-y-4">
            <ChipRow label="Metric">
              {METRIC_OPTIONS.map((opt) => (
                <Chip
                  key={opt.value}
                  active={metric === opt.value}
                  onClick={() => {
                    setMetric(opt.value);
                    setPage(1);
                  }}
                >
                  {opt.label}
                </Chip>
              ))}
            </ChipRow>
            <ChipRow label="Period">
              {PERIOD_OPTIONS.map((opt) => (
                <Chip
                  key={opt.value}
                  active={period === opt.value}
                  disabled={!activeMetric.needsPeriod && opt.value !== 'all' && opt.value !== period}
                  onClick={() => {
                    setPeriod(opt.value);
                    setPage(1);
                  }}
                >
                  {opt.label}
                </Chip>
              ))}
            </ChipRow>
          </div>
        </Card>
      </section>

      {/* Top 10 chart */}
      {top10.length > 0 ? (
        <section className="vera-rise-delay-2">
          <Card>
            <div className="space-y-1">
              <h2 className="text-text-secondary text-sm tracking-[0.2em] uppercase">
                Top 10 reps by {activeMetric.label.toLowerCase()}
              </h2>
              <p className="text-text-muted text-xs">{activeMetric.hint}.</p>
            </div>
            <div className="mt-6">
              <BarChart
                data={top10.map((r) => ({
                  label: r.rep.name,
                  value: r[metric as keyof RepRow] as number,
                  hint: `${r.jobCount} ${r.jobCount === 1 ? 'AR job' : 'AR jobs'}`,
                }))}
                format={(n) => fmt(n, activeMetric.unit)}
              />
            </div>
          </Card>
        </section>
      ) : null}

      {/* Leaderboard table */}
      <section className="space-y-3 vera-rise-delay-3">
        <TableToolbar
          title={`Leaderboard — ${sortedRows.length} ${sortedRows.length === 1 ? 'rep' : 'reps'}`}
          subtitle={
            filterCount > 0
              ? `${filterCount} ${filterCount === 1 ? 'filter' : 'filters'} applied`
              : `Sorted by ${activeMetric.label.toLowerCase()}`
          }
        >
          <FilterMenu
            groups={filterGroups}
            selected={{ regions: regionFilter, jobTypes: jobTypeFilter }}
            onSelectedChange={(next) => {
              setRegionFilter(next.regions ?? []);
              setJobTypeFilter(next.jobTypes ?? []);
              setPage(1);
            }}
          />
        </TableToolbar>
        {sortedRows.length === 0 ? (
          <Card>
            <p className="text-text-secondary">No reps match the current filters.</p>
          </Card>
        ) : (
          <TableShell
            maxHeight={640}
            footer={
              <TablePagination
                total={sortedRows.length}
                page={page}
                pageSize={safePageSize}
                onPageChange={setPage}
                onPageSizeChange={(s) => {
                  setPageSize(s);
                  setPage(1);
                }}
                standalone
              />
            }
          >
            <Table>
              <TableHead columns={COLUMNS} />
              <tbody>
                {pagedRows.map((r, idx) => {
                  const offset = (page - 1) * safePageSize;
                  return (
                    <TableRow key={r.rep.id}>
                      <TableCell className="text-text-muted tabular-nums">
                        {offset + idx + 1}
                      </TableCell>
                      <TableCell>
                        <p className="text-text-primary font-medium">{r.rep.name}</p>
                        {r.rep.email ? (
                          <p className="text-text-muted text-xs">{r.rep.email}</p>
                        ) : null}
                      </TableCell>
                      <TableCell align="right" className="tabular-nums">
                        <span className="text-accent font-semibold">
                          {fmt(r[metric as keyof RepRow] as number, activeMetric.unit)}
                        </span>
                      </TableCell>
                      <TableCell align="right" className="tabular-nums">
                        {formatUSD(r.outstanding)}
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
                        {r.avgHeat}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </tbody>
            </Table>
          </TableShell>
        )}
      </section>
    </div>
  );
}

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-text-muted w-20 shrink-0 text-[0.65rem] font-semibold tracking-[0.18em] uppercase">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Chip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        active
          ? 'bg-accent inline-flex h-8 items-center rounded-full border border-transparent px-3.5 text-xs font-medium text-white shadow-[0_2px_6px_-2px_rgba(200,133,78,0.4)]'
          : disabled
            ? 'border-border text-text-muted inline-flex h-8 cursor-not-allowed items-center rounded-full border bg-transparent px-3.5 text-xs opacity-50'
            : 'border-border text-text-secondary hover:border-accent/40 hover:bg-bg-base inline-flex h-8 items-center rounded-full border bg-transparent px-3.5 text-xs font-medium transition-colors'
      }
    >
      {children}
    </button>
  );
}
