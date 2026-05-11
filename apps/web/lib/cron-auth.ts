import 'server-only';
import { Receiver } from '@upstash/qstash';

/**
 * Authentication for cron endpoints. Accepts two paths, in order of
 * preference:
 *
 *   1. **QStash signature (preferred).** Upstash QStash signs every
 *      outbound request with a JWT in the `upstash-signature` header.
 *      We verify it with the public signing keys from the Upstash
 *      dashboard. This is what the scheduled runs use in production
 *      and is robust to a leaked `CRON_SECRET` — an attacker can't
 *      forge a valid signature without the rotated signing keys.
 *
 *   2. **Legacy `Authorization: Bearer $CRON_SECRET` (fallback).** Kept
 *      for: (a) manual `curl` from a developer machine, (b) the
 *      `workflow_dispatch` button in GitHub Actions if we ever need
 *      an emergency manual fire, and (c) local dev where running QStash
 *      verification is awkward. Off by default in deployments where
 *      `CRON_SECRET` is not set.
 *
 * Returns `{ ok: true }` on success or `{ ok: false, status, error }`
 * on rejection so the caller can shape the HTTP response itself.
 *
 * Reads the body via `req.text()` because QStash verification operates
 * on the raw bytes. Returns the body so the caller doesn't have to
 * re-read the stream (Request bodies can only be consumed once).
 */
export type CronAuthResult =
  | { ok: true; via: 'qstash' | 'bearer'; rawBody: string }
  | { ok: false; status: number; error: string };

export async function verifyCronAuth(req: Request): Promise<CronAuthResult> {
  // Body must be read once and held — both verification paths and the
  // route handler need the same bytes.
  const rawBody = await req.text();

  // Path 1: QStash signature.
  const signature = req.headers.get('upstash-signature');
  if (signature) {
    const currentKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
    const nextKey = process.env.QSTASH_NEXT_SIGNING_KEY;
    if (!currentKey || !nextKey) {
      return {
        ok: false,
        status: 500,
        error: 'qstash_keys_not_configured',
      };
    }
    const receiver = new Receiver({
      currentSigningKey: currentKey,
      nextSigningKey: nextKey,
    });
    try {
      const isValid = await receiver.verify({
        signature,
        body: rawBody,
        // Verify against the full URL the request landed on. QStash
        // signs the full destination URL it was configured with.
        url: req.url,
      });
      if (isValid) return { ok: true, via: 'qstash', rawBody };
      return { ok: false, status: 401, error: 'invalid_qstash_signature' };
    } catch (e) {
      return {
        ok: false,
        status: 401,
        error: e instanceof Error ? e.message : 'qstash_verify_error',
      };
    }
  }

  // Path 2: legacy Bearer.
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return {
      ok: false,
      status: 500,
      error: 'no_auth_method_configured',
    };
  }
  const auth = req.headers.get('authorization') ?? '';
  if (auth === `Bearer ${expected}`) {
    return { ok: true, via: 'bearer', rawBody };
  }
  return { ok: false, status: 401, error: 'unauthorized' };
}
