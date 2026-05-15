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
    const result = await evaluateRulesForTenant({
      tenantId: audit.tenantId,
      trigger: 'manual',
    });
    return NextResponse.json({ result });
  });
}
