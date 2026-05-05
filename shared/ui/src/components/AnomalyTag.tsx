import { AlertTriangle } from 'lucide-react';
import type { AnomalyFlag } from '@vera/types';
import { cn } from '../lib/cn';

const LABELS: Record<AnomalyFlag, string> = {
  'balance-exceeds-price': 'Balance exceeds price',
  'no-cert-of-completion': 'No cert of completion',
  'insurance-final-check-stuck': 'Final check stuck',
  'retail-no-payment': 'No payments yet',
  'duplicate-address': 'Duplicate address',
  'no-commission-request': 'No commission request',
  'impossible-payments': 'Impossible payments',
  'archived-with-balance': 'Archived but owing',
  'warranty-voided-with-balance': 'Warranty voided',
};

export function AnomalyTag({ flag, className }: { flag: AnomalyFlag; className?: string }) {
  return (
    <span
      className={cn(
        'border-border bg-bg-base text-text-secondary inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
        className,
      )}
    >
      <AlertTriangle className="text-heat-hot h-3 w-3" />
      {LABELS[flag]}
    </span>
  );
}
