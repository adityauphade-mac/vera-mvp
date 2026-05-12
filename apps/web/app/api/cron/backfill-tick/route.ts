import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyCronAuth } from '@/lib/cron-auth';
import { runTick } from '@/lib/backfill/tick-worker';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * QStash-signed entry point for backfill ticks. Body: { runId: number }.
 *
 * Auth: QStash signature (production) or Bearer CRON_SECRET (local dev).
 * verifyCronAuth handles both.
 */

const BodySchema = z.object({
  runId: z.number().int().positive(),
});

export async function POST(req: Request) {
  const authResult = await verifyCronAuth(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  let body: unknown;
  try {
    body = JSON.parse(authResult.rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_error', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const destinationUrl = new URL(req.url).toString();
  const result = await runTick(parsed.data.runId, destinationUrl);
  return NextResponse.json(result);
}
