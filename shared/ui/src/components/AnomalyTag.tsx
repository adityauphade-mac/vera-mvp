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

const TOOLTIPS: Record<AnomalyFlag, string> = {
  'balance-exceeds-price': 'Outstanding balance is greater than the contract price — likely a data error or stale estimate.',
  'no-cert-of-completion': 'Job is installed but no certificate of completion has been logged after 14 days. Insurance final checks rely on this.',
  'insurance-final-check-stuck': 'Insurance job installed 60+ days ago without the final (depreciation) check endorsed.',
  'retail-no-payment': 'Retail/cash job installed 30+ days ago with zero payments received.',
  'duplicate-address': 'Multiple records exist at this address with overlapping dates. Could be a duplicate or warranty work.',
  'no-commission-request': 'No commission request has been logged after 14 days post-install. Often a tell that the rep believes something is off.',
  'impossible-payments': 'Payment values are inconsistent (negative or exceeding the contract price).',
  'archived-with-balance': 'The estimate is archived but a balance is still showing — a zombie record.',
  'warranty-voided-with-balance': 'Warranty has been voided yet balance remains owing — disputed work.',
};

export function AnomalyTag({ flag, className }: { flag: AnomalyFlag; className?: string }) {
  return (
    <span
      title={TOOLTIPS[flag]}
      className={cn(
        'border-border bg-bg-base text-text-secondary inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs leading-none whitespace-nowrap',
        className,
      )}
    >
      <AlertTriangle className="text-heat-hot h-3 w-3 shrink-0" aria-hidden="true" />
      <span>{LABELS[flag]}</span>
    </span>
  );
}
