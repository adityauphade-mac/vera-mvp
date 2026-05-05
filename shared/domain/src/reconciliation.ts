import { differenceInCalendarDays } from 'date-fns';
import type { RoofLinkJob } from '@vera/types';
import {
  hasCertOfCompletion,
  hasFirstCheckEndorsed,
  hasFinalCheckEndorsed,
  hasCommissionRequest,
} from './milestones';

function daysSince(dateString: string | null | undefined, now: Date): number {
  if (!dateString) return Infinity;
  return Math.max(0, differenceInCalendarDays(now, new Date(dateString)));
}

function checkEndorsedRecently(job: RoofLinkJob, now: Date): boolean {
  const steps = job.custom_steps ?? {};
  for (const key of ['first_check_endorsed', 'final_check_endorsed']) {
    const d = steps[key]?.date_completed;
    if (d && daysSince(d, now) <= 30) return true;
  }
  return false;
}

/**
 * Q15: a job is "in the collection pipeline" if at least one of these is true:
 *  - any check endorsed in last 30 days
 *  - certificate of completion logged
 *  - commission request logged
 *  - record edited within the last 14 days
 */
export function isInPipeline(job: RoofLinkJob, now: Date): boolean {
  if (checkEndorsedRecently(job, now)) return true;
  if (hasCertOfCompletion(job)) return true;
  if (hasCommissionRequest(job)) return true;
  if (daysSince(job.date_last_edited, now) <= 14) return true;
  return false;
}

export function fellThroughCracks(job: RoofLinkJob, now: Date): boolean {
  return !isInPipeline(job, now);
}

/** Human-readable list of reasons we believe this job fell through the cracks. */
export function fellThroughCracksReasons(job: RoofLinkJob, now: Date): string[] {
  const reasons: string[] = [];
  if (!checkEndorsedRecently(job, now) && !hasFirstCheckEndorsed(job) && !hasFinalCheckEndorsed(job)) {
    reasons.push('no insurance check endorsed');
  }
  if (!hasCertOfCompletion(job)) reasons.push('no certificate of completion');
  if (!hasCommissionRequest(job)) reasons.push('no commission request');
  const lastEditDays = daysSince(job.date_last_edited, now);
  if (Number.isFinite(lastEditDays) && lastEditDays > 14) {
    reasons.push(`record untouched for ${Math.round(lastEditDays)} days`);
  } else if (!Number.isFinite(lastEditDays)) {
    reasons.push('record never edited');
  }
  return reasons;
}
