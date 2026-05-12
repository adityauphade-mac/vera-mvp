import 'server-only';
import { Client } from '@upstash/qstash';

/**
 * Publishes "next tick" messages to QStash. The tick worker calls
 * `publishNextTick` at the end of each successful tick to chain itself.
 *
 * Dev-mode fallback: if QSTASH_TOKEN is unset (i.e. local development), we
 * call the tick endpoint inline via fetch instead. That keeps the chained-
 * tick flow testable end-to-end on localhost without provisioning real
 * QStash credentials.
 *
 * In prod, QStash signs each delivery; the tick route verifies the signature
 * via `verifyCronAuth` (apps/web/lib/cron-auth.ts).
 */

const QSTASH_TOKEN = process.env.QSTASH_TOKEN;

let cachedClient: Client | null = null;
function getClient(): Client | null {
  if (!QSTASH_TOKEN) return null;
  if (!cachedClient) cachedClient = new Client({ token: QSTASH_TOKEN });
  return cachedClient;
}

export interface PublishNextTickInput {
  runId: number;
  /** Seconds to wait before the next tick fires. Defaults to 1s. */
  delaySec?: number;
  /** Absolute URL the tick should POST to. Set from request origin. */
  destinationUrl: string;
}

export async function publishNextTick(input: PublishNextTickInput): Promise<void> {
  const { runId, delaySec = 1, destinationUrl } = input;
  const body = JSON.stringify({ runId });

  const client = getClient();
  if (client) {
    // Production path — QStash signs + delivers.
    await client.publishJSON({
      url: destinationUrl,
      body: { runId },
      delay: delaySec,
      retries: 0, // idempotency comes from the claimedAt lock, not QStash retry
    });
    return;
  }

  // Dev path — kick off the tick locally without QStash. Don't await the
  // response (we want to return from the current tick quickly), but log
  // any error to the console so it isn't silent.
  //
  // Use an AbortController to cap the wait. A single tick should complete
  // in under 60s; we give it 2 min headroom. Without this, undici's
  // default 5-min headersTimeout silently strands the chain.
  setTimeout(() => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 120_000);
    fetch(destinationUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.CRON_SECRET ?? 'local-dev-cron-secret-not-for-prod'}`,
      },
      body,
      signal: controller.signal,
    })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[backfill/qstash] dev-mode tick fetch failed:', err);
      })
      .finally(() => clearTimeout(t));
  }, delaySec * 1000);
}

export function isQStashConfigured(): boolean {
  return Boolean(QSTASH_TOKEN);
}
