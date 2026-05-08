'use client';

import { useState } from 'react';
import {
  AgingChip,
  HeatMeter,
  MissingStepTag,
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
    key: 'missing',
    label: 'Missing milestones',
    tooltip:
      'Cert of completion, final check, and commission request — whichever are missing.',
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

export function MilestonesTable({
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
            {jobs.map((job) => (
              <TableRow
                key={job.id}
                onClick={() => setSelected(job)}
                className="cursor-pointer vera-press"
              >
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
                    <div className="flex flex-wrap items-center gap-1.5">
                      {job.missingMilestones.slice(0, 2).map((label) => (
                        <MissingStepTag key={label} label={label} />
                      ))}
                      {job.missingMilestones.length > 2 ? (
                        <Tooltip
                          content={
                            <span className="block">
                              <span className="block font-semibold">Also missing:</span>
                              <span className="mt-1 block">
                                {job.missingMilestones.slice(2).map((label) => (
                                  <span key={label} className="mt-0.5 block">
                                    · {label}
                                  </span>
                                ))}
                              </span>
                            </span>
                          }
                        >
                          <span
                            onClick={(e) => e.stopPropagation()}
                            className="border-border bg-bg-base text-text-secondary inline-flex cursor-help items-center rounded-full border px-2.5 py-1 text-xs leading-none whitespace-nowrap"
                          >
                            +{job.missingMilestones.length - 2} more
                          </span>
                        </Tooltip>
                      ) : null}
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
