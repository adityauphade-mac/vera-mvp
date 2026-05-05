import type { RoofLinkJob } from '@vera/types';

const INSURANCE_STATUS_HINTS = [
  'claim filed',
  'roof approved',
  'roof denied',
  'inspection - damage found',
];

const INSURANCE_SOURCE_HINTS = [
  'hail',
  'storm',
  'insurance',
  'claim',
  'adjuster',
];

/** Q3: insurance jobs run on Net 60; everything else on Net 30. */
export function isInsurance(job: RoofLinkJob): boolean {
  if (job.insurance_claim != null && job.insurance_claim !== false) return true;

  const sourceName = (job.lead_source?.name ?? '').toLowerCase();
  if (INSURANCE_SOURCE_HINTS.some((h) => sourceName.includes(h))) return true;

  const statusLabel = (job.lead_status?.label ?? '').toLowerCase();
  if (INSURANCE_STATUS_HINTS.some((h) => statusLabel.includes(h))) return true;

  return false;
}

/** Q3: net terms in days. */
export function getNetTerms(job: RoofLinkJob): number {
  return isInsurance(job) ? 60 : 30;
}

/** Q1 + Q16: AR working set rule. */
export function isInARWorkingSet(job: RoofLinkJob): boolean {
  if (job.exclude_from_qb === true) return false;
  if (!job.date_completed) return false;
  const balance = job.primary_estimate?.balance ?? 0;
  return balance > 0;
}
