import {
  AgingChip,
  Card,
  HeatScoreBadge,
  MetricTile,
  VeraQuote,
} from '@vera/ui';
import { formatUSD } from '@vera/utils';
import { getData } from '@/lib/data';

export default function ReconciliationPage() {
  const { jobs } = getData();
  const fellThrough = jobs
    .filter((j) => j.fellThroughCracks)
    .sort((a, b) => b.daysPastTerms - a.daysPastTerms);

  const totalStuck = fellThrough.reduce((s, j) => s + j.balance, 0);
  const oldest = fellThrough[0]?.daysSinceInstall ?? 0;
  const distinctReps = new Set(fellThrough.map((j) => j.rep?.id).filter(Boolean)).size;

  const narrative =
    fellThrough.length === 0
      ? "Nothing fell through this week. Every completed install has at least one fresh signal — paperwork, an endorsed check, a commission request, or a recent edit. I'll keep watching."
      : `${fellThrough.length} ${
          fellThrough.length === 1 ? 'install has' : 'installs have'
        } gone quiet — no insurance check endorsement, no certificate of completion, no commission request, and no edits in the last two weeks. That&apos;s ${formatUSD(
          totalStuck,
        )} sitting somewhere unattended, across ${distinctReps} ${
          distinctReps === 1 ? 'rep' : 'reps'
        }. The oldest one was installed ${oldest} days ago.`;

  return (
    <div className="mx-auto max-w-6xl space-y-10">
      <header className="space-y-3">
        <p className="text-text-muted text-xs tracking-[0.2em] uppercase">
          Weekly · unpaid job reconciliation
        </p>
        <h1 className="font-display text-4xl tracking-tight md:text-5xl">
          Fell through cracks
        </h1>
        <VeraQuote>{narrative}</VeraQuote>
      </header>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricTile
          label="Stuck jobs"
          value={fellThrough.length}
          emphasis={fellThrough.length > 0 ? 'critical' : 'default'}
        />
        <MetricTile label="Locked up" value={formatUSD(totalStuck)} />
        <MetricTile label="Reps affected" value={distinctReps} />
        <MetricTile
          label="Oldest install"
          value={oldest > 0 ? `${oldest} days` : '—'}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-text-secondary text-sm tracking-[0.2em] uppercase">
          The list — oldest first
        </h2>
        {fellThrough.length === 0 ? (
          <Card>
            <p className="text-text-secondary">
              Nothing to reconcile this morning. Open the aging report to keep an eye on
              what&apos;s drifting toward stuck.
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {fellThrough.map((job) => (
              <Card key={job.id} className="!py-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="font-display truncate text-xl tracking-tight">
                      {job.address}
                    </p>
                    <p className="text-text-secondary text-sm">
                      {job.rep?.name ?? 'Unassigned'} · {job.region ?? '—'} ·{' '}
                      {job.isInsurance ? 'Insurance' : 'Retail'} · installed{' '}
                      {job.daysSinceInstall} days ago
                    </p>
                    {job.fellThroughCracksReasons.length > 0 ? (
                      <ul className="text-text-muted mt-3 space-y-1 text-sm">
                        {job.fellThroughCracksReasons.map((reason) => (
                          <li key={reason}>· {reason}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <p className="font-display text-2xl tracking-tight tabular-nums">
                      {formatUSD(job.balance)}
                    </p>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <AgingChip bucket={job.agingBucket} />
                      <HeatScoreBadge
                        score={job.heatScore}
                        band={job.heatBand}
                        breakdown={job.heatBreakdown}
                        size="sm"
                      />
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
