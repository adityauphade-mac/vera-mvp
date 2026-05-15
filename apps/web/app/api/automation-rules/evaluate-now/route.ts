import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-helpers';
import { evaluateRulesForTenant } from '@/lib/automation/evaluator';

export const runtime = 'nodejs';

/**
 * POST /api/automation-rules/evaluate-now
 *
 * Manual trigger for the rule evaluator. Runs against the currently-promoted
 * AR working set. Useful for:
 *   - Testing a rule before the next scheduled sync.
 *   - Flushing the pending queue after fixing a misconfigured schedule.
 *
 * Body is ignored.
 */
export async function POST() {
  return withAuth(async (audit) => {
    try {
      const result = await evaluateRulesForTenant({
        tenantId: audit.tenantId,
        trigger: 'manual',
      });
      return NextResponse.json({ result });
    } catch (err) {
      // Without explicit logging, Next.js returns an empty 500 and the only
      // signal in the operator's network tab is the status code — no body,
      // no stack. Log here so the Vercel function logs carry the real error.
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[automation] evaluate-now failed', {
        tenantId: audit.tenantId,
        message,
        stack: err instanceof Error ? err.stack : undefined,
      });
      return NextResponse.json(
        { error: { code: 'evaluator_failed', message } },
        { status: 500 },
      );
    }
  });
}
