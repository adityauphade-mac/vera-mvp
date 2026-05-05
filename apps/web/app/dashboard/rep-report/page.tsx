import Link from 'next/link';
import { BarChart, Card, MetricTile, VeraQuote } from '@vera/ui';
import { formatUSD } from '@vera/utils';
import { getData } from '@/lib/data';
import { Leaderboard } from './Leaderboard';

const SORT_OPTIONS = [
  { value: 'dollars', label: 'Dollars outstanding' },
  { value: 'count', label: 'Stuck job count' },
  { value: 'oldest', label: 'Oldest aging' },
  { value: 'heat', label: 'Average heat' },
] as const;

type SortKey = (typeof SORT_OPTIONS)[number]['value'];

export default async function RepReportPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; region?: string; jobType?: string }>;
}) {
  const params = await searchParams;
  const sort: SortKey = isSort(params.sort) ? params.sort : 'dollars';
  const { jobs, reps } = getData();

  let workingReps = reps;
  if (params.region || params.jobType) {
    const filteredJobs = jobs.filter((j) => {
      if (params.region && j.region !== params.region) return false;
      if (params.jobType && j.jobType !== params.jobType) return false;
      return true;
    });
    const byRep = new Map<number, (typeof reps)[number]>();
    for (const j of filteredJobs) {
      if (!j.rep) continue;
      let entry = byRep.get(j.rep.id);
      if (!entry) {
        entry = {
          rep: j.rep,
          jobCount: 0,
          totalOutstanding: 0,
          oldestDaysPastTerms: 0,
          averageHeatScore: 0,
          hotJobs: 0,
          criticalJobs: 0,
        };
        byRep.set(j.rep.id, entry);
      }
      entry.jobCount += 1;
      entry.totalOutstanding += j.balance;
      entry.oldestDaysPastTerms = Math.max(entry.oldestDaysPastTerms, j.daysPastTerms);
      entry.averageHeatScore += j.heatScore;
      if (j.heatBand === 'hot') entry.hotJobs += 1;
      if (j.heatBand === 'critical') entry.criticalJobs += 1;
    }
    workingReps = [...byRep.values()].map((r) => ({
      ...r,
      averageHeatScore: r.jobCount === 0 ? 0 : Math.round(r.averageHeatScore / r.jobCount),
    }));
  }

  const sorted = [...workingReps].sort((a, b) => {
    if (sort === 'dollars') return b.totalOutstanding - a.totalOutstanding;
    if (sort === 'count') return b.jobCount - a.jobCount;
    if (sort === 'oldest') return b.oldestDaysPastTerms - a.oldestDaysPastTerms;
    return b.averageHeatScore - a.averageHeatScore;
  });

  const totalAR = sorted.reduce((s, r) => s + r.totalOutstanding, 0);
  const top = sorted[0];
  const top10 = sorted.slice(0, 10);
  const regions = [...new Set(jobs.map((j) => j.region).filter(Boolean))].sort() as string[];
  const jobTypes = [...new Set(jobs.map((j) => j.jobType).filter(Boolean))].sort() as string[];

  const narrative = top
    ? `${top.rep.name} is sitting on the most outstanding right now — ${formatUSD(
        top.totalOutstanding,
      )} across ${top.jobCount} ${top.jobCount === 1 ? 'job' : 'jobs'}. The leaderboard is sorted by ${labelFor(sort)} — toggle the chips above the table to slice it differently.`
    : 'No reps in this view. Try clearing filters.';

  return (
    <div className="mx-auto max-w-7xl space-y-10">
      <header className="space-y-3 vera-rise">
        <p className="text-text-muted text-xs tracking-[0.2em] uppercase">
          Weekly · rep outstanding report
        </p>
        <h1 className="font-display text-4xl tracking-tight md:text-5xl">
          Where the money is by rep.
        </h1>
        <VeraQuote>{narrative}</VeraQuote>
      </header>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4 vera-rise-delay-1">
        <MetricTile label="Reps with AR" value={sorted.length} />
        <MetricTile label="Total outstanding" value={formatUSD(totalAR)} />
        <MetricTile label="Worst single rep" value={top ? formatUSD(top.totalOutstanding) : '—'} />
        <MetricTile
          label="Average per rep"
          value={sorted.length > 0 ? formatUSD(totalAR / sorted.length) : '—'}
        />
      </section>

      {/* Top-10 chart */}
      {top10.length > 0 && (
        <section className="space-y-3 vera-rise-delay-2">
          <h2 className="text-text-secondary text-sm tracking-[0.2em] uppercase">
            Top 10 reps by {labelFor(sort)}
          </h2>
          <Card>
            <BarChart
              data={top10.map((r) => ({
                label: r.rep.name,
                value:
                  sort === 'dollars'
                    ? Math.round(r.totalOutstanding)
                    : sort === 'count'
                      ? r.jobCount
                      : sort === 'oldest'
                        ? r.oldestDaysPastTerms
                        : r.averageHeatScore,
                hint:
                  sort === 'dollars'
                    ? `${r.jobCount} jobs`
                    : sort === 'count'
                      ? formatUSD(r.totalOutstanding)
                      : sort === 'oldest'
                        ? `${r.jobCount} jobs`
                        : `${r.jobCount} jobs`,
                tooltip: `${r.rep.name} — ${formatUSD(r.totalOutstanding)} across ${r.jobCount} jobs`,
              }))}
              format={
                sort === 'dollars'
                  ? (n: number) => formatUSD(n)
                  : sort === 'oldest'
                    ? (n: number) => `${n}d`
                    : (n: number) => n.toLocaleString()
              }
            />
          </Card>
        </section>
      )}

      {/* Filters */}
      <section className="space-y-3 vera-rise-delay-3">
        <Filters
          sort={sort}
          region={params.region}
          jobType={params.jobType}
          regions={regions}
          jobTypes={jobTypes}
        />
      </section>

      <section className="space-y-3 vera-rise-delay-3">
        <h2 className="text-text-secondary text-sm tracking-[0.2em] uppercase">
          Leaderboard
        </h2>
        {sorted.length === 0 ? (
          <Card>
            <p className="text-text-secondary">
              No reps match this filter. Try clearing region or job type.
            </p>
          </Card>
        ) : (
          <Leaderboard reps={sorted} totalAR={totalAR} />
        )}
      </section>
    </div>
  );
}

function Filters({
  sort,
  region,
  jobType,
  regions,
  jobTypes,
}: {
  sort: SortKey;
  region?: string;
  jobType?: string;
  regions: string[];
  jobTypes: string[];
}) {
  function buildHref(updates: Record<string, string | undefined>) {
    const sp = new URLSearchParams();
    const next = { sort, region, jobType, ...updates };
    if (next.sort && next.sort !== 'dollars') sp.set('sort', next.sort);
    if (next.region) sp.set('region', next.region);
    if (next.jobType) sp.set('jobType', next.jobType);
    const qs = sp.toString();
    return qs ? `/dashboard/rep-report?${qs}` : '/dashboard/rep-report';
  }

  return (
    <div className="flex flex-col gap-4">
      <FilterRow label="Sort by">
        {SORT_OPTIONS.map((opt) => (
          <ChipLink
            key={opt.value}
            href={buildHref({ sort: opt.value })}
            active={sort === opt.value}
          >
            {opt.label}
          </ChipLink>
        ))}
      </FilterRow>
      <FilterRow label="Region">
        <ChipLink href={buildHref({ region: undefined })} active={!region}>
          All
        </ChipLink>
        {regions.map((r) => (
          <ChipLink key={r} href={buildHref({ region: r })} active={region === r}>
            {r}
          </ChipLink>
        ))}
      </FilterRow>
      <FilterRow label="Job type">
        <ChipLink href={buildHref({ jobType: undefined })} active={!jobType}>
          All
        </ChipLink>
        {jobTypes.map((t) => (
          <ChipLink key={t} href={buildHref({ jobType: t })} active={jobType === t}>
            {t === 'r' ? 'Residential' : t === 'c' ? 'Commercial' : t}
          </ChipLink>
        ))}
      </FilterRow>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-text-muted w-24 text-[0.65rem] tracking-[0.15em] uppercase">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function ChipLink({
  href,
  active,
  children,
}: {
  href: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      className={
        active
          ? 'bg-accent inline-flex items-center rounded-full border border-transparent px-3 py-1 text-xs font-medium text-white shadow-[0_2px_6px_-2px_rgba(200,133,78,0.4)]'
          : 'border-border text-text-secondary hover:border-accent/40 hover:bg-bg-card inline-flex items-center rounded-full border bg-transparent px-3 py-1 text-xs font-medium transition-colors'
      }
    >
      {children}
    </Link>
  );
}

function isSort(v: string | undefined): v is SortKey {
  return v === 'dollars' || v === 'count' || v === 'oldest' || v === 'heat';
}

function labelFor(sort: SortKey): string {
  return SORT_OPTIONS.find((o) => o.value === sort)?.label.toLowerCase() ?? sort;
}
