'use client';

import { useState } from 'react';
import {
  AgingChip,
  Card,
  HeatMeter,
  MissingStepTag,
  Tooltip,
} from '@vera/ui';
import { formatUSD } from '@vera/utils';
import { generateFollowUpDraft } from '@vera/domain';
import type { ARJob } from '@vera/types';
import { JobDetailSheet } from '../_components/JobDetailSheet';
import { DraftEmailButton } from './DraftEmailButton';

export function FollowUpsList({ jobs }: { jobs: ARJob[] }) {
  const [selected, setSelected] = useState<ARJob | null>(null);

  return (
    <>
      <div className="max-h-[720px] space-y-3 overflow-y-auto pr-1">
        {jobs.map((job) => (
          <FollowUpRow key={job.id} job={job} onOpen={() => setSelected(job)} />
        ))}
      </div>

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

function FollowUpRow({ job, onOpen }: { job: ARJob; onOpen: () => void }) {
  const draft = generateFollowUpDraft(job);
  return (
    <Card
      className="!py-5 min-h-[200px] cursor-pointer vera-press transition-shadow hover:shadow-[0_4px_16px_-6px_rgba(31,27,22,0.08)]"
      onClick={onOpen}
    >
      <div className="flex h-full flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-display truncate text-lg tracking-tight sm:text-xl">{job.address}</p>
          <p className="text-text-secondary text-sm">
            {job.rep?.name ?? 'Unassigned'} · {job.region ?? '—'} ·{' '}
            {job.isInsurance ? 'Insurance' : 'Retail'} · {job.daysSinceInstall} days post-install
          </p>
          {job.missingMilestones.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
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
          ) : null}
        </div>
        <div
          className="flex flex-row flex-wrap items-center justify-between gap-3 sm:flex-col sm:items-end"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="font-display text-2xl tracking-tight tabular-nums">
            {formatUSD(job.balance)}
          </p>
          <AgingChip bucket={job.agingBucket} />
          <HeatMeter
            score={job.heatScore}
            band={job.heatBand}
            breakdown={job.heatBreakdown}
            variant="compact"
          />
          {job.rep?.email ? (
            <DraftEmailButton
              repName={job.rep.name}
              repEmail={job.rep.email}
              subject={draft.subject}
              body={draft.body}
            />
          ) : (
            <span className="text-text-muted text-xs italic">No rep email on file</span>
          )}
        </div>
      </div>
    </Card>
  );
}
