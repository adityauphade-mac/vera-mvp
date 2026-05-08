'use client';

import { useState } from 'react';
import {
  AgingChip,
  HeatMeter,
  Table,
  TableCell,
  TableHead,
  TableRow,
  TableShell,
  Tooltip,
} from '@vera/ui';
import { formatUSD } from '@vera/utils';
import type { ARJob } from '@vera/types';
import { JobDetailSheet } from '../_components/JobDetailSheet';

const COLUMNS = [
  { key: 'job', label: 'Job', tooltip: 'Address and job classification.' },
  {
    key: 'rep',
    label: 'Rep',
    width: '160px',
    tooltip: 'Sales rep responsible for the install.',
  },
  {
    key: 'gaps',
    label: 'Why stuck',
    tooltip:
      'Each badge is a signal of activity that we did NOT find. Stuck jobs have all of them missing.',
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

const REASON_LABELS: Record<string, string> = {
  'no insurance check endorsed': 'No insurance check',
  'no certificate of completion': 'No cert of completion',
  'no commission request': 'No commission request',
};

const REASON_TOOLTIPS: Record<string, string> = {
  'No insurance check':
    'No first or final insurance check has been endorsed in the last 30 days.',
  'No cert of completion':
    'Certificate of completion has not been logged for this install.',
  'No commission request':
    "Rep has not requested commission for this job — often a tell that they're not chasing it.",
  'Untouched record':
    'The record itself has not been edited in the last 14 days. No one is even looking at it.',
};

function untouchedReason(reasons: string[]): string | null {
  const found = reasons.find((r) => r.startsWith('record untouched'));
  return found ? found : null;
}

export function ReconciliationList({
  jobs,
  footer,
}: {
  jobs: ARJob[];
  footer?: React.ReactNode;
}) {
  const [selected, setSelected] = useState<ARJob | null>(null);

  return (
    <>
      <TableShell maxHeight={720} footer={footer}>
        <Table>
          <TableHead columns={COLUMNS} />
          <tbody>
            {jobs.map((job) => {
              const reasons = job.fellThroughCracksReasons;
              const stillBadges: string[] = [];
              for (const r of reasons) {
                const label = REASON_LABELS[r];
                if (label) stillBadges.push(label);
              }
              const untouched = untouchedReason(reasons);
              const untouchedDays = untouched
                ? untouched.match(/\d+/)?.[0] ?? null
                : null;

              return (
                <TableRow
                  key={job.id}
                  onClick={() => setSelected(job)}
                  className="cursor-pointer vera-press"
                >
                  <TableCell>
                    <p className="text-text-primary font-medium">{job.address}</p>
                    <p className="text-text-muted mt-0.5 text-xs">
                      {job.region ?? '—'} · {job.isInsurance ? 'Insurance' : 'Retail'} ·
                      installed {job.daysSinceInstall} days ago
                    </p>
                  </TableCell>
                  <TableCell className="text-text-secondary">
                    {job.rep?.name ?? 'Unassigned'}
                  </TableCell>
                  <TableCell>
                    <div
                      className="flex flex-wrap gap-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {stillBadges.map((label) => (
                        <Tooltip key={label} content={REASON_TOOLTIPS[label]}>
                          <span className="border-border bg-bg-base text-text-secondary inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs leading-none whitespace-nowrap">
                            <span
                              className="bg-heat-hot inline-block h-1.5 w-1.5 rounded-full"
                              aria-hidden="true"
                            />
                            {label}
                          </span>
                        </Tooltip>
                      ))}
                      {untouchedDays ? (
                        <Tooltip content={REASON_TOOLTIPS['Untouched record']}>
                          <span className="border-border bg-bg-base text-text-secondary inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs leading-none whitespace-nowrap">
                            <span
                              className="bg-heat-critical inline-block h-1.5 w-1.5 rounded-full"
                              aria-hidden="true"
                            />
                            Untouched {untouchedDays}d
                          </span>
                        </Tooltip>
                      ) : null}
                    </div>
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
              );
            })}
          </tbody>
        </Table>
      </TableShell>

      <JobDetailSheet
        job={selected}
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </>
  );
}
