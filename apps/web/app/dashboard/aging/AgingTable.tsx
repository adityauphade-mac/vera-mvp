import { AgingChip, AnomalyTag, HeatMeter } from '@vera/ui';
import { formatUSD } from '@vera/utils';
import type { ARJob } from '@vera/types';

const HEADERS: Array<{ key: string; label: string; align?: 'right'; tooltip: string }> = [
  { key: 'job', label: 'Job', tooltip: 'Address and job classification (insurance vs retail).' },
  { key: 'rep', label: 'Rep', tooltip: 'Sales rep responsible for the install.' },
  { key: 'balance', label: 'Balance', align: 'right', tooltip: 'Outstanding amount on the primary estimate.' },
  { key: 'aging', label: 'Aging', tooltip: 'Bucket relative to the customer\'s payment terms.' },
  { key: 'days', label: 'Days past', align: 'right', tooltip: 'Number of days past the agreed terms (Net 30 retail, Net 60 insurance).' },
  { key: 'heat', label: 'Heat', align: 'right', tooltip: 'Composite 0–100 score: 40% days past terms · 25% balance · 20% rep silence · 15% anomalies.' },
];

export function AgingTable({ jobs }: { jobs: ARJob[] }) {
  if (jobs.length === 0) {
    return (
      <div className="border-border bg-bg-card rounded-[var(--radius-card)] border p-8">
        <p className="text-text-secondary">
          Nothing matches the current filter. Clear it to see the full list.
        </p>
      </div>
    );
  }

  return (
    <div className="border-border bg-bg-card overflow-hidden rounded-[var(--radius-card)] border">
      <div className="max-h-[640px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-bg-card sticky top-0 z-10">
            <tr className="border-border text-text-muted border-b text-left text-[0.65rem] tracking-[0.15em] uppercase">
              {HEADERS.map((h) => (
                <th
                  key={h.key}
                  title={h.tooltip}
                  className={`px-5 py-3 font-medium ${h.align === 'right' ? 'text-right' : ''}`}
                >
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr
                key={job.id}
                className="border-border last:border-b-0 border-b align-top transition-colors hover:bg-[color:var(--color-bg-base)]"
              >
                <td className="px-5 py-4 align-top">
                  <p className="text-text-primary font-medium">{job.address}</p>
                  <p className="text-text-muted mt-0.5 text-xs">
                    {job.region ?? '—'} · {job.isInsurance ? 'Insurance' : 'Retail'}
                  </p>
                  {job.anomalies.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {job.anomalies.slice(0, 3).map((flag) => (
                        <AnomalyTag key={flag} flag={flag} />
                      ))}
                    </div>
                  ) : null}
                </td>
                <td className="text-text-secondary px-5 py-4 align-top">
                  {job.rep?.name ?? 'Unassigned'}
                </td>
                <td className="px-5 py-4 text-right align-top tabular-nums">
                  {formatUSD(job.balance)}
                </td>
                <td className="px-5 py-4 align-top">
                  <AgingChip bucket={job.agingBucket} />
                </td>
                <td className="px-5 py-4 text-right align-top tabular-nums">
                  {job.daysPastTerms === 0 ? (
                    <span className="text-text-muted">—</span>
                  ) : (
                    job.daysPastTerms
                  )}
                </td>
                <td className="px-5 py-4 align-top">
                  <div className="flex justify-end">
                    <HeatMeter
                      score={job.heatScore}
                      band={job.heatBand}
                      breakdown={job.heatBreakdown}
                      variant="compact"
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
