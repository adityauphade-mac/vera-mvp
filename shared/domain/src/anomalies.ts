import { differenceInCalendarDays } from 'date-fns';
import type { AnomalyFlag, RoofLinkJob } from '@vera/types';
import { isInsurance } from './classification';
import {
  hasCertOfCompletion,
  hasFinalCheckEndorsed,
  hasCommissionRequest,
} from './milestones';

/** Q5: 9 anomaly rules. Returns the flags that fired for this job. */
export function detectAnomalies(
  job: RoofLinkJob,
  context: { addressCounts: Map<string, number>; now: Date },
): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];
  const est = job.primary_estimate;
  const balance = est?.balance ?? 0;
  const gtPrice = est?.gt_price ?? 0;
  const payments = est?.payments ?? 0;
  const completedAt = job.date_completed ? new Date(job.date_completed) : null;
  const daysSinceInstall = completedAt
    ? Math.max(0, differenceInCalendarDays(context.now, completedAt))
    : 0;

  // 1: math doesn't add up
  if (gtPrice > 0 && balance > gtPrice + 0.01) {
    flags.push('balance-exceeds-price');
  }

  // 2: installed but no certificate of completion after 14 days
  if (completedAt && daysSinceInstall > 14 && !hasCertOfCompletion(job)) {
    flags.push('no-cert-of-completion');
  }

  // 3: insurance + installed 60+ days ago + no final check
  if (
    completedAt &&
    isInsurance(job) &&
    daysSinceInstall > 60 &&
    !hasFinalCheckEndorsed(job) &&
    balance > 0
  ) {
    flags.push('insurance-final-check-stuck');
  }

  // 4: retail + installed 30+ days ago + zero payments
  if (
    completedAt &&
    !isInsurance(job) &&
    daysSinceInstall > 30 &&
    payments === 0 &&
    balance > 0
  ) {
    flags.push('retail-no-payment');
  }

  // 5: duplicate address
  const fullAddress = (job.full_address ?? job.address ?? '').trim().toLowerCase();
  if (fullAddress && (context.addressCounts.get(fullAddress) ?? 0) > 1) {
    flags.push('duplicate-address');
  }

  // 6: installed but no commission request after 14 days
  if (completedAt && daysSinceInstall > 14 && !hasCommissionRequest(job)) {
    flags.push('no-commission-request');
  }

  // 7: impossible payments
  if (payments < 0 || (gtPrice > 0 && payments > gtPrice + 0.01)) {
    flags.push('impossible-payments');
  }

  // 8: archived estimate but balance still > 0
  if (est?.is_archived === true && balance > 0) {
    flags.push('archived-with-balance');
  }

  // 9: warranty voided + balance > 0
  if (job.warranty_voided === true && balance > 0) {
    flags.push('warranty-voided-with-balance');
  }

  return flags;
}

const ANOMALY_LABELS: Record<AnomalyFlag, string> = {
  'balance-exceeds-price': 'Balance exceeds contract price',
  'no-cert-of-completion': 'No certificate of completion after 14 days',
  'insurance-final-check-stuck': 'Insurance final check stuck (60+ days post-install)',
  'retail-no-payment': 'Retail job — no payments after 30 days',
  'duplicate-address': 'Duplicate address detected',
  'no-commission-request': 'No commission request after 14 days',
  'impossible-payments': 'Impossible payment values (negative or exceeds price)',
  'archived-with-balance': 'Estimate archived but balance still owing',
  'warranty-voided-with-balance': 'Warranty voided but balance still owing',
};

export function anomalyLabel(flag: AnomalyFlag): string {
  return ANOMALY_LABELS[flag];
}
