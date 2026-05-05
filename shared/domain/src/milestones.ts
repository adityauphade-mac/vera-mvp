import type { RoofLinkJob } from '@vera/types';

/**
 * RoofLink's `custom_steps` keys vary in casing/spelling between records.
 * We accept any of these aliases for each milestone.
 */
const ALIASES = {
  certOfCompletion: ['certificate_of_completion'],
  firstCheck: ['first_check_endorsed'],
  finalCheck: ['final_check_endorsed'],
  commission: [
    'residential_commission_request',
    'commercial_commission_request',
    'commission_request',
  ],
} as const;

function hasStep(job: RoofLinkJob, names: readonly string[]): boolean {
  const steps = job.custom_steps ?? {};
  return names.some((n) => {
    const v = steps[n];
    return v != null && v.date_completed != null;
  });
}

export function hasCertOfCompletion(job: RoofLinkJob): boolean {
  return hasStep(job, ALIASES.certOfCompletion);
}
export function hasFirstCheckEndorsed(job: RoofLinkJob): boolean {
  return hasStep(job, ALIASES.firstCheck);
}
export function hasFinalCheckEndorsed(job: RoofLinkJob): boolean {
  return hasStep(job, ALIASES.finalCheck);
}
export function hasCommissionRequest(job: RoofLinkJob): boolean {
  return hasStep(job, ALIASES.commission);
}

/** Friendly labels for the missing-step tag chips on the milestone view. */
export function missingMilestones(job: RoofLinkJob): string[] {
  const out: string[] = [];
  if (!hasCertOfCompletion(job)) out.push('cert of completion');
  if (!hasFinalCheckEndorsed(job)) out.push('final check');
  if (!hasCommissionRequest(job)) out.push('commission request');
  return out;
}
