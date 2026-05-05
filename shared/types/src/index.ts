import { z } from 'zod';

/* =============================================================================
 * Source RoofLink shape (only the fields we actually use).
 * Everything tolerant — RoofLink exports vary in shape between records.
 * =========================================================================== */

const RoofLinkPersonSchema = z
  .object({
    id: z.number().nullish(),
    full_name: z.string().nullish(),
    email: z.string().nullish(),
    color: z.string().nullish(),
  })
  .partial();

const RoofLinkRegionSchema = z
  .object({
    id: z.number().nullish(),
    name: z.string().nullish(),
    color: z.string().nullish(),
  })
  .partial();

const RoofLinkLeadStatusSchema = z
  .object({
    label: z.string().nullish(),
    color: z.string().nullish(),
  })
  .partial();

const RoofLinkLeadSourceSchema = z
  .object({
    id: z.number().nullish(),
    name: z.string().nullish(),
  })
  .partial();

const RoofLinkEstimateSchema = z
  .object({
    id: z.number().nullish(),
    name: z.string().nullish(),
    gt_price: z.number().nullish(),
    payments: z.number().nullish(),
    balance: z.number().nullish(),
    is_primary: z.boolean().nullish(),
    is_archived: z.boolean().nullish(),
  })
  .partial();

const RoofLinkCustomStepSchema = z
  .object({
    date_completed: z.string().nullish(),
    completed_by: RoofLinkPersonSchema.nullish(),
  })
  .partial()
  .passthrough();

export const RoofLinkJobSchema = z
  .object({
    id: z.number(),
    number: z.number().nullish(),
    name: z.string().nullish(),
    job_type: z.string().nullish(),
    bid_type: z.string().nullish(),
    address: z.string().nullish(),
    city: z.string().nullish(),
    state: z.string().nullish(),
    zipcode: z.string().nullish(),
    full_address: z.string().nullish(),
    region: RoofLinkRegionSchema.nullish(),
    rep: RoofLinkPersonSchema.nullish(),
    customer: z
      .object({
        id: z.number().nullish(),
        name: z.string().nullish(),
        first_name: z.string().nullish(),
        last_name: z.string().nullish(),
        company_name: z.string().nullish(),
      })
      .partial()
      .nullish(),
    lead_source: RoofLinkLeadSourceSchema.nullish(),
    lead_status: RoofLinkLeadStatusSchema.nullish(),
    insurance_claim: z.unknown().nullish(),
    date_created: z.string().nullish(),
    date_signed: z.string().nullish(),
    date_completed: z.string().nullish(),
    date_last_edited: z.string().nullish(),
    primary_estimate: RoofLinkEstimateSchema.nullish(),
    estimates: z.array(RoofLinkEstimateSchema).nullish(),
    custom_steps: z.record(z.string(), RoofLinkCustomStepSchema).nullish(),
    exclude_from_qb: z.boolean().nullish(),
    warranty_voided: z.boolean().nullish(),
  })
  .passthrough();

export type RoofLinkJob = z.infer<typeof RoofLinkJobSchema>;

/* =============================================================================
 * Slim Vera shape — what gets shipped to the browser via /api/*.
 * =========================================================================== */

export const HeatBandSchema = z.enum(['cool', 'warm', 'hot', 'critical']);
export type HeatBand = z.infer<typeof HeatBandSchema>;

export const AgingBucketSchema = z.enum([
  'within-terms',
  '1-30-past',
  '31-60-past',
  '60-plus-past',
]);
export type AgingBucket = z.infer<typeof AgingBucketSchema>;

export const AnomalyFlagSchema = z.enum([
  'balance-exceeds-price',
  'no-cert-of-completion',
  'insurance-final-check-stuck',
  'retail-no-payment',
  'duplicate-address',
  'no-commission-request',
  'impossible-payments',
  'archived-with-balance',
  'warranty-voided-with-balance',
]);
export type AnomalyFlag = z.infer<typeof AnomalyFlagSchema>;

export const HeatBreakdownSchema = z.object({
  daysComponent: z.number(),
  dollarComponent: z.number(),
  silenceComponent: z.number(),
  anomalyComponent: z.number(),
});
export type HeatBreakdown = z.infer<typeof HeatBreakdownSchema>;

export const RepSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string().nullable(),
  color: z.string().nullable(),
});
export type Rep = z.infer<typeof RepSchema>;

export const ARJobSchema = z.object({
  id: z.number(),
  address: z.string(),
  fullAddress: z.string(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  region: z.string().nullable(),
  jobType: z.string().nullable(),
  customerName: z.string().nullable(),
  rep: RepSchema.nullable(),
  leadStatus: z.string().nullable(),
  leadSource: z.string().nullable(),
  isInsurance: z.boolean(),
  netTerms: z.number(),
  dateSigned: z.string().nullable(),
  dateCompleted: z.string(),
  dateLastEdited: z.string().nullable(),
  daysSinceInstall: z.number(),
  daysPastTerms: z.number(),
  agingBucket: AgingBucketSchema,
  gtPrice: z.number(),
  payments: z.number(),
  balance: z.number(),
  isArchived: z.boolean(),
  warrantyVoided: z.boolean(),
  excludeFromQB: z.boolean(),
  hasCertOfCompletion: z.boolean(),
  hasFirstCheckEndorsed: z.boolean(),
  hasFinalCheckEndorsed: z.boolean(),
  hasCommissionRequest: z.boolean(),
  daysSinceLastEdit: z.number(),
  missingMilestones: z.array(z.string()),
  heatScore: z.number(),
  heatBand: HeatBandSchema,
  heatBreakdown: HeatBreakdownSchema,
  anomalies: z.array(AnomalyFlagSchema),
  inPipeline: z.boolean(),
  fellThroughCracks: z.boolean(),
  fellThroughCracksReasons: z.array(z.string()),
});
export type ARJob = z.infer<typeof ARJobSchema>;

export const RepRollupSchema = z.object({
  rep: RepSchema,
  jobCount: z.number(),
  totalOutstanding: z.number(),
  oldestDaysPastTerms: z.number(),
  averageHeatScore: z.number(),
  hotJobs: z.number(),
  criticalJobs: z.number(),
});
export type RepRollup = z.infer<typeof RepRollupSchema>;

export const GeneratedDataSchema = z.object({
  generatedAt: z.string(),
  asOf: z.string(),
  jobCount: z.number(),
  totalAR: z.number(),
  jobs: z.array(ARJobSchema),
  reps: z.array(RepRollupSchema),
});
export type GeneratedData = z.infer<typeof GeneratedDataSchema>;
