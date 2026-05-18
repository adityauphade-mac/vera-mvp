import { z } from 'zod';
import type { RoofLinkJob, WriteOffRecord } from '@vera/types';

/**
 * Write-off detection — extract an Amount Withheld discount from a Rooflink
 * line-items payload, if present, and project it into a `WriteOffRecord`.
 *
 * Used by `apps/web/lib/write-offs-data.ts` (request-time DB reader that
 * joins `RawRooflinkLineItems` against the AR working set) and by the
 * test-seed regenerator at `scripts/generate-vera-test-seed.ts`.
 *
 * The shape and field semantics here MUST stay in lockstep with the
 * `WriteOffRecord` type in `@vera/types`. If a field changes, update both.
 */

/** Rooflink product id for the Amount Withheld discount line. */
export const AMOUNT_WITHHELD_PRODUCT_ID = 71493;

/**
 * Narrow schema for the bits of the line-items payload that drive the
 * calculation. We `safeParse` defensively — the full payload comes from the
 * DB as `unknown` (Postgres jsonb), so we can't assume structure.
 *
 * Note: this schema only validates the fields we read. The full payload is
 * preserved on the output record as `lineItems` for downstream use, so the
 * outer schema (`WriteOffLineItemsSchema` in `@vera/types`) is intentionally
 * loose / passthrough.
 */
const DiscountLineSchema = z.object({
  id: z.number(),
  product_id: z.number(),
  product_name: z.string().optional().nullable(),
  price: z.number(),
  trade_name: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
});

const WorkDoingLineSchema = z
  .object({
    rcv: z.number().optional().nullable(),
    price: z.number().optional().nullable(),
  })
  .passthrough();

const LineItemsPayloadSchema = z
  .object({
    work_doing: z.array(WorkDoingLineSchema).optional(),
    discounts: z.array(DiscountLineSchema).optional(),
  })
  .passthrough();

type ParsedLineItems = z.infer<typeof LineItemsPayloadSchema>;

/**
 * Sum the insurance RCV figure from `work_doing[]`. Returns null if the array
 * is missing or empty so the UI can distinguish "no signal" from "$0".
 */
export function sumWorkDoingRcv(payload: ParsedLineItems): number | null {
  const items = payload.work_doing;
  if (!Array.isArray(items) || items.length === 0) return null;
  return items.reduce(
    (sum, item) => sum + (typeof item.rcv === 'number' ? item.rcv : 0),
    0,
  );
}

/**
 * Find the Amount Withheld discount line in a parsed payload, if present.
 * Returns the absolute price (Rooflink stores discounts as negative numbers,
 * but the dashboard reads them as positive write-off amounts).
 */
function findAmountWithheld(payload: ParsedLineItems): number | null {
  const discounts = payload.discounts;
  if (!Array.isArray(discounts)) return null;
  const withheld = discounts.find((d) => d.product_id === AMOUNT_WITHHELD_PRODUCT_ID);
  if (!withheld) return null;
  return Math.abs(withheld.price);
}

/**
 * Project a `(job, lineItemsPayload)` pair into a `WriteOffRecord` if the
 * payload contains an Amount Withheld discount; otherwise return null.
 *
 * The caller is responsible for filtering to the AR working set
 * (`isInARWorkingSet`) and ensuring `job.primary_estimate.id` matches the
 * estimate the payload was fetched for.
 */
export function toWriteOffRecord(
  job: RoofLinkJob,
  lineItemsPayload: unknown,
): WriteOffRecord | null {
  const parsed = LineItemsPayloadSchema.safeParse(lineItemsPayload);
  if (!parsed.success) return null;

  const amountWithheld = findAmountWithheld(parsed.data);
  if (amountWithheld === null) return null;

  const estimateId = job.primary_estimate?.id;
  if (estimateId == null) return null;

  return {
    jobId: job.id,
    estimateId: Number(estimateId),
    customerName: job.customer?.name ?? '',
    address: job.full_address ?? job.address ?? '',
    installDate: job.date_completed ?? null,
    repName: job.rep?.full_name ?? null,
    region: job.region?.name ?? null,
    amountWithheld,
    contractPrice: job.primary_estimate?.gt_price ?? 0,
    balance: job.primary_estimate?.balance ?? 0,
    insuranceRcv: sumWorkDoingRcv(parsed.data),
    // Preserve the full payload as-is — the detail sheet uses it for the
    // line-item breakdown view.
    lineItems: parsed.data,
  };
}
