import type { ARJob, AnomalyFlag, RoofLinkJob } from '@vera/types';
import { agingBucket, daysPastTerms, daysSinceInstall } from './aging';
import { detectAnomalies } from './anomalies';
import { getNetTerms, isInsurance } from './classification';
import { computeHeatScore, daysSinceLastEdit } from './heat-score';
import {
  hasCertOfCompletion,
  hasCommissionRequest,
  hasFinalCheckEndorsed,
  hasFirstCheckEndorsed,
  missingMilestones,
} from './milestones';
import {
  fellThroughCracks,
  fellThroughCracksReasons,
  isInPipeline,
} from './reconciliation';

/** Project a RoofLink record + anomaly flags into the slim ARJob shape. */
export function toARJob(
  source: RoofLinkJob,
  context: { addressCounts: Map<string, number>; now: Date },
): ARJob {
  if (!source.date_completed) {
    throw new Error(`toARJob called on a job without date_completed: ${source.id}`);
  }
  const est = source.primary_estimate;
  const balance = est?.balance ?? 0;
  const gtPrice = est?.gt_price ?? 0;
  const payments = est?.payments ?? 0;

  const anomalies: AnomalyFlag[] = detectAnomalies(source, context);
  const heat = computeHeatScore(source, { now: context.now, anomalyCount: anomalies.length });

  const customerObj = source.customer ?? null;
  const customerName =
    customerObj?.name ||
    [customerObj?.first_name, customerObj?.last_name].filter(Boolean).join(' ') ||
    customerObj?.company_name ||
    null;

  return {
    id: source.id,
    address: source.address ?? source.full_address ?? `Job #${source.id}`,
    fullAddress: source.full_address ?? source.address ?? '',
    city: source.city ?? null,
    state: source.state ?? null,
    region: source.region?.name ?? null,
    jobType: source.job_type ?? null,
    customerName: customerName || null,
    rep: source.rep?.id
      ? {
          id: source.rep.id,
          name: source.rep.full_name ?? 'Unknown',
          email: source.rep.email ?? null,
          color: source.rep.color ?? null,
        }
      : null,
    leadStatus: source.lead_status?.label ?? null,
    leadSource: source.lead_source?.name ?? null,
    isInsurance: isInsurance(source),
    netTerms: getNetTerms(source),
    dateSigned: source.date_signed ?? null,
    dateCompleted: source.date_completed,
    dateLastEdited: source.date_last_edited ?? null,
    daysSinceInstall: daysSinceInstall(source, context.now),
    daysPastTerms: daysPastTerms(source, context.now),
    agingBucket: agingBucket(source, context.now),
    gtPrice,
    payments,
    balance,
    isArchived: est?.is_archived === true,
    warrantyVoided: source.warranty_voided === true,
    excludeFromQB: source.exclude_from_qb === true,
    hasCertOfCompletion: hasCertOfCompletion(source),
    hasFirstCheckEndorsed: hasFirstCheckEndorsed(source),
    hasFinalCheckEndorsed: hasFinalCheckEndorsed(source),
    hasCommissionRequest: hasCommissionRequest(source),
    daysSinceLastEdit: daysSinceLastEdit(source, context.now),
    missingMilestones: missingMilestones(source),
    heatScore: heat.score,
    heatBand: heat.band,
    heatBreakdown: heat.breakdown,
    anomalies,
    inPipeline: isInPipeline(source, context.now),
    fellThroughCracks: fellThroughCracks(source, context.now),
    fellThroughCracksReasons: fellThroughCracks(source, context.now)
      ? fellThroughCracksReasons(source, context.now)
      : [],
  };
}
