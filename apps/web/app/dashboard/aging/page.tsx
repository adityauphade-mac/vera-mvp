import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { BarChart, Card, MetricTile, VeraQuote } from '@vera/ui';
import { formatUSD } from '@vera/utils';
import type { ARJob, AgingBucket, AnomalyFlag } from '@vera/types';
import { getData } from '@/lib/data';
import { AgingTable } from './AgingTable';

const BUCKET_LABEL: Record<AgingBucket, string> = {
  'within-terms': 'Within terms',
  '1-30-past': '1–30 past',
  '31-60-past': '31–60 past',
  '60-plus-past': '60+ past',
};

const BUCKET_ORDER: AgingBucket[] = [
  'within-terms',
  '1-30-past',
  '31-60-past',
  '60-plus-past',
];

const BUCKET_COLOR: Record<AgingBucket, string> = {
  'within-terms': 'var(--color-text-muted)',
  '1-30-past': 'var(--color-heat-warm)',
  '31-60-past': 'var(--color-heat-hot)',
  '60-plus-past': 'var(--color-heat-critical)',
};

const ANOMALY_LABELS: Record<AnomalyFlag, string> = {
  'balance-exceeds-price': 'Balance exceeds price',
  'no-cert-of-completion': 'No cert of completion',
  'insurance-final-check-stuck': 'Insurance final check stuck',
  'retail-no-payment': 'Retail — no payments',
  'duplicate-address': 'Duplicate address',
  'no-commission-request': 'No commission request',
  'impossible-payments': 'Impossible payments',
  'archived-with-balance': 'Archived but owing',
  'warranty-voided-with-balance': 'Warranty voided',
};

export default async function AgingPage({
  searchParams,
}: {
  searchParams: Promise<{ bucket?: string; rep?: string }>;
}) {
  const params = await searchParams;
  const { jobs } = getData();

  const bucketSummary: Record<AgingBucket, { count: number; total: number }> = {
    'within-terms': { count: 0, total: 0 },
    '1-30-past': { count: 0, total: 0 },
    '31-60-past': { count: 0, total: 0 },
    '60-plus-past': { count: 0, total: 0 },
  };
  for (const j of jobs) {
    bucketSummary[j.agingBucket].count += 1;
    bucketSummary[j.agingBucket].total += j.balance;
  }

  let visible: ARJob[] = jobs;
  const bucketFilter = isAgingBucket(params.bucket) ? params.bucket : undefined;
  if (bucketFilter) visible = visible.filter((j) => j.agingBucket === bucketFilter);
  if (params.rep) visible = visible.filter((j) => j.rep?.id?.toString() === params.rep);
  visible = [...visible].sort((a, b) => b.daysPastTerms - a.daysPastTerms);

  const byAnomaly: Record<string, ARJob[]> = {};
  for (const j of jobs) {
    for (const flag of j.anomalies) {
      if (!byAnomaly[flag]) byAnomaly[flag] = [];
      byAnomaly[flag]!.push(j);
    }
  }
  const anomalyEntries = Object.entries(byAnomaly).sort((a, b) => b[1].length - a[1].length);

  const totalOver =
    bucketSummary['1-30-past'].total +
    bucketSummary['31-60-past'].total +
    bucketSummary['60-plus-past'].total;

  return (
    <div className="mx-auto max-w-7xl space-y-10">
      <header className="space-y-3 vera-rise">
        <p className="text-text-muted text-xs tracking-[0.2em] uppercase">
          Daily · AR aging & anomaly check
        </p>
        <h1 className="font-display text-4xl tracking-tight md:text-5xl">
          What&apos;s late, and what&apos;s strange.
        </h1>
        <VeraQuote>
          {bucketSummary['60-plus-past'].count > 0
            ? `${bucketSummary['60-plus-past'].count} ${
                bucketSummary['60-plus-past'].count === 1 ? 'job is' : 'jobs are'
              } more than 60 days past their terms — that's where I'd focus first. Total past terms: ${formatUSD(totalOver)}.`
            : "Nothing's deeply overdue today. The buckets below show where things stand relative to each customer's terms."}
        </VeraQuote>
      </header>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4 vera-rise-delay-1">
        {BUCKET_ORDER.map((b) => (
          <BucketTile
            key={b}
            label={BUCKET_LABEL[b]}
            count={bucketSummary[b].count}
            total={bucketSummary[b].total}
            bucket={b}
            isActive={bucketFilter === b}
          />
        ))}
      </section>

      {/* Distribution + anomalies, side by side */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2 vera-rise-delay-2">
        <Card>
          <div className="space-y-1">
            <h2 className="text-text-secondary text-sm tracking-[0.2em] uppercase">
              Past-terms distribution
            </h2>
            <p className="text-text-muted text-xs">
              How the {jobs.length} active AR jobs split across the four buckets.
            </p>
          </div>
          <div className="mt-6">
            <BarChart
              data={BUCKET_ORDER.map((b) => ({
                label: BUCKET_LABEL[b],
                value: bucketSummary[b].count,
                color: BUCKET_COLOR[b],
                hint: formatUSD(bucketSummary[b].total),
                tooltip: `${BUCKET_LABEL[b]}: ${bucketSummary[b].count} jobs · ${formatUSD(bucketSummary[b].total)}`,
              }))}
              format={(n) => `${n} ${n === 1 ? 'job' : 'jobs'}`}
            />
          </div>
        </Card>

        <Card>
          <div className="space-y-1">
            <h2 className="text-text-secondary text-sm tracking-[0.2em] uppercase">
              What looks strange
            </h2>
            <p className="text-text-muted text-xs">
              {anomalyEntries.length === 0
                ? 'Nothing tripped today.'
                : `${anomalyEntries.length} anomaly ${anomalyEntries.length === 1 ? 'rule has' : 'rules have'} flagged jobs.`}
            </p>
          </div>
          {anomalyEntries.length === 0 ? (
            <p className="text-text-secondary mt-6 text-sm">
              I&apos;ll keep watching.
            </p>
          ) : (
            <ul className="mt-6 space-y-2.5">
              {anomalyEntries.map(([flag, list]) => (
                <li
                  key={flag}
                  title={`${ANOMALY_LABELS[flag as AnomalyFlag]} — ${list.length} ${
                    list.length === 1 ? 'job' : 'jobs'
                  }`}
                  className="border-border/60 flex items-center justify-between gap-3 border-b pb-2.5 last:border-b-0 last:pb-0"
                >
                  <span className="flex items-center gap-2.5 text-sm">
                    <AlertTriangle
                      className="text-heat-hot h-3.5 w-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    <span className="text-text-primary">
                      {ANOMALY_LABELS[flag as AnomalyFlag]}
                    </span>
                  </span>
                  <span className="text-text-primary tabular-nums font-semibold">
                    {list.length}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {/* Table */}
      <section className="space-y-3 vera-rise-delay-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-text-secondary text-sm tracking-[0.2em] uppercase">
            By job — {visible.length} {visible.length === 1 ? 'row' : 'rows'}
          </h2>
          {(bucketFilter || params.rep) && (
            <Link
              href="/dashboard/aging"
              scroll={false}
              className="text-accent text-sm hover:underline"
            >
              Clear filters
            </Link>
          )}
        </div>
        <AgingTable jobs={visible} />
      </section>
    </div>
  );
}

function BucketTile({
  label,
  count,
  total,
  bucket,
  isActive,
}: {
  label: string;
  count: number;
  total: number;
  bucket: AgingBucket;
  isActive: boolean;
}) {
  const href = isActive ? '/dashboard/aging' : `/dashboard/aging?bucket=${bucket}`;
  const emphasis: 'default' | 'accent' | 'critical' =
    bucket === '60-plus-past' ? 'critical' : bucket === '31-60-past' ? 'accent' : 'default';
  return (
    <Link
      href={href}
      scroll={false}
      className={
        isActive
          ? 'ring-accent block rounded-[var(--radius-card)] ring-2 transition-all'
          : 'hover:ring-accent/30 block rounded-[var(--radius-card)] ring-1 ring-transparent transition-all'
      }
      title={`${label}: ${count} jobs · ${formatUSD(total)}`}
    >
      <MetricTile
        label={label}
        value={count}
        hint={formatUSD(total)}
        emphasis={emphasis}
      />
    </Link>
  );
}

function isAgingBucket(value: string | undefined): value is AgingBucket {
  return (
    value === 'within-terms' ||
    value === '1-30-past' ||
    value === '31-60-past' ||
    value === '60-plus-past'
  );
}
