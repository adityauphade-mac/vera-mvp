import 'server-only';

/**
 * Convert internal backfill errors (Prisma stack traces, fetch failures,
 * filesystem paths) into short, user-facing strings that don't leak internals.
 *
 * Why this exists: CLAUDE.md hard rule #12 — "user-facing strings never
 * expose internal identifiers." The scheduler page renders `BackfillRun
 * .lastError` directly in a failure banner. If we store the raw
 * `Error.message`, the user sees things like:
 *
 *   Invalid `tx.rawRooflinkJob.upsert()` invocation in
 *   /Users/.../.next/dev/server/chunks/[root-of-the-server]__038t_9c._.js:2751:45
 *   Transaction API error: Transaction not found...
 *
 * That leaks the Prisma client method name, the on-disk build path, and a
 * line:col into bundled code. None of it is meaningful to an operator. This
 * module collapses each known pattern into a one-sentence explanation, and
 * generically scrubs the rest as a fallback.
 *
 * Detail is not lost — the raw stack still lives in stdout / Sentry / the
 * cron-tick `console.error`. Operators who need it can grep logs. The UI
 * surface gets the readable summary.
 */

/** Catalog of known patterns mapped to a friendly summary. Order matters —
 *  patterns earlier in the list win when multiple match. */
interface ErrorMatcher {
  test: RegExp;
  summary: string;
}

const MATCHERS: ErrorMatcher[] = [
  {
    // Prisma P2028 — interactive transaction timed out or closed early.
    test: /Transaction not found|Transaction API error|interactive transaction/i,
    summary:
      'Database transaction timed out while writing this batch. The run will retry; if it keeps failing, increase the transaction timeout.',
  },
  {
    // Prisma P1001 — server unreachable.
    test: /P1001|Can't reach database server/i,
    summary:
      'The database was unreachable during this tick. Likely a transient network blip; the run will retry.',
  },
  {
    // Prisma P1008 — operations timed out.
    test: /P1008|Operations timed out/i,
    summary: 'The database took too long to respond. The run will retry.',
  },
  {
    // Prisma P2034 — write conflict / serialization failure.
    test: /P2034|serialization failure|write conflict/i,
    summary:
      'Database write conflict — another writer touched the same rows at the same time. The run will retry.',
  },
  {
    // Connection lost mid-statement (Neon pooler / dev hot-reload).
    test: /Connection lost|disconnect(?:ing|ed)|ECONNRESET/i,
    summary: 'Lost the database connection mid-batch. The run will retry.',
  },
  {
    // Rooflink auth.
    test: /HTTP 401|HTTP 403|Unauthorized|Forbidden|check RL_KEY/i,
    summary:
      'Rooflink rejected the request (auth). Check that RL_KEY is set and still valid.',
  },
  {
    // Rooflink rate-limit / WAF.
    test: /HTTP 429|Too Many Requests|rate limit/i,
    summary: 'Rooflink rate-limited the fetch. The run will retry with backoff.',
  },
  {
    // Generic upstream HTTP error.
    test: /HTTP 5\d\d/i,
    summary: 'Rooflink returned a server error. The run will retry.',
  },
  {
    // Abort / timeout on the fetch.
    test: /AbortError|fetch failed|ETIMEDOUT/i,
    summary:
      'The fetch to Rooflink timed out or was aborted. The run will retry.',
  },
];

/** Length cap on the final summary — fits within a single failure-banner row. */
const MAX_LEN = 160;

/**
 * Strip the most common internal-leakage patterns from an error string when
 * no matcher fires. Removes absolute filesystem paths, line:col pairs inside
 * bundled chunks, and the `tx.modelName.methodName()` Prisma artifact.
 */
function genericScrub(raw: string): string {
  let s = raw;
  // Drop "Invalid `tx.foo.bar()` invocation in ... " entirely.
  s = s.replace(/Invalid `[^`]+` invocation in [^\s]+(?::\d+:\d+)?/g, '');
  // Drop any remaining absolute paths.
  s = s.replace(/\/[A-Za-z0-9_.\-/]+(?:\.[A-Za-z0-9]+)(?::\d+:\d+)?/g, '');
  // Drop the chunk-name artefact even if it slipped through.
  s = s.replace(/\[root-of-the-server\][^\s]*/g, '');
  // Collapse whitespace.
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Project an arbitrary error into a short, user-safe summary string. Always
 * returns something non-empty — even unknown errors get a generic fallback.
 */
export function sanitizeBackfillError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? '');
  const text = raw.trim();
  if (!text) return 'An unknown error occurred.';

  for (const matcher of MATCHERS) {
    if (matcher.test.test(text)) return matcher.summary;
  }

  const scrubbed = genericScrub(text);
  if (scrubbed.length === 0) return 'An unknown error occurred.';
  return scrubbed.length > MAX_LEN ? scrubbed.slice(0, MAX_LEN - 1) + '…' : scrubbed;
}
