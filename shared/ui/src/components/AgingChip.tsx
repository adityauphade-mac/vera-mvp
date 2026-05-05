import type { AgingBucket } from '@vera/types';
import { cn } from '../lib/cn';
import { Tooltip } from './Tooltip';

const LABEL: Record<AgingBucket, string> = {
  'within-terms': 'Within terms',
  '1-30-past': '1–30 past',
  '31-60-past': '31–60 past',
  '60-plus-past': '60+ past',
};

const STYLE: Record<AgingBucket, string> = {
  'within-terms': 'text-text-muted bg-text-muted/10',
  '1-30-past': 'text-heat-warm bg-heat-warm/15',
  '31-60-past': 'text-heat-hot bg-heat-hot/15',
  '60-plus-past': 'text-heat-critical bg-heat-critical/15',
};

const TOOLTIP: Record<AgingBucket, string> = {
  'within-terms': 'Within payment terms — not late.',
  '1-30-past': '1–30 days past terms.',
  '31-60-past': '31–60 days past terms — escalation territory.',
  '60-plus-past': '60+ days past terms — likely needs executive intervention.',
};

export function AgingChip({ bucket, className }: { bucket: AgingBucket; className?: string }) {
  return (
    <Tooltip content={TOOLTIP[bucket]}>
      <span
        className={cn(
          'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium leading-none whitespace-nowrap',
          STYLE[bucket],
          className,
        )}
      >
        {LABEL[bucket]}
      </span>
    </Tooltip>
  );
}
