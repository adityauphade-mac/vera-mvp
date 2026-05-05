import { differenceInCalendarDays } from 'date-fns';
import type { AgingBucket, RoofLinkJob } from '@vera/types';
import { getNetTerms } from './classification';

/** Days from install date to `now`. Returns 0 if no install date. */
export function daysSinceInstall(job: RoofLinkJob, now: Date): number {
  if (!job.date_completed) return 0;
  return Math.max(0, differenceInCalendarDays(now, new Date(job.date_completed)));
}

/** Q3: how many days past the customer's terms. 0 means within terms. */
export function daysPastTerms(job: RoofLinkJob, now: Date): number {
  const since = daysSinceInstall(job, now);
  const terms = getNetTerms(job);
  return Math.max(0, since - terms);
}

/** Q4: terms-relative bucket — never absolute calendar buckets. */
export function agingBucket(job: RoofLinkJob, now: Date): AgingBucket {
  const past = daysPastTerms(job, now);
  if (past === 0) return 'within-terms';
  if (past <= 30) return '1-30-past';
  if (past <= 60) return '31-60-past';
  return '60-plus-past';
}
