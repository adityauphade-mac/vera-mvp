# Vera — API reference

Every HTTP route in `apps/web/app/api/`, with the auth gate, request
shape, and response shape that's actually deployed today.

> Last updated: May 8, 2026.

---

## Quick map

| Route | Method | Auth | Purpose |
|---|---|---|---|
| [`/api/auth/[...nextauth]`](#authnextauth) | `*` | n/a | Auth.js handlers |
| [`/api/chat`](#chat) | POST | Session cookie | Streams chat responses |
| [`/api/jobs/aging`](#jobsaging) | GET | open | Aging buckets + anomaly side panel |
| [`/api/jobs/milestones`](#jobsmilestones) | GET | open | Milestone-gap report |
| [`/api/jobs/follow-ups`](#jobsfollow-ups) | GET | open | Hot queue + executive review queue |
| [`/api/jobs/reconciliation`](#jobsreconciliation) | GET | open | "Fell through cracks" list |
| [`/api/reps/outstanding`](#repsoutstanding) | GET | open | Per-rep leaderboard |
| [`/api/briefings/regenerate`](#briefingsregenerate) | POST | open (TODO: session) | Generate a fresh AI dashboard briefing |
| [`/api/briefings/preview`](#briefingspreview) | GET | open | DB-free smoke check |
| [`/api/schedules`](#schedules) | GET / POST | Session cookie | Read or create a recurring schedule |
| [`/api/brief/send`](#briefsend) | POST | open | One-shot Send Now |
| [`/api/cron/dispatch-briefs`](#croncron-dispatch-briefs) | POST | Bearer `CRON_SECRET` | Cron worker — fires due schedules |
| [`/api/cron/generate-briefings`](#croncron-generate-briefings) | POST | Bearer `CRON_SECRET` | Cron worker — daily AI briefing per tenant |

**Auth legend:**
- **open** — no auth check at the route level. Some routes still resolve
  tenant from session if a cookie is present, but anonymous calls work.
- **Session cookie** — `auth()` middleware. Returns 401 without a valid
  Auth.js JWT cookie.
- **Bearer `CRON_SECRET`** — `Authorization: Bearer <secret>` header.
  Anything else returns 401.

---

## `/api/auth/[...nextauth]`

Auth.js handlers (sign-in, callback, sign-out, CSRF, session). Catch-all
route — exposes the standard endpoints documented at
https://authjs.dev/getting-started/installation.

Source: `apps/web/app/api/auth/[...nextauth]/route.ts`.

---

## `/api/chat`

`POST /api/chat`

Streams gpt-4o-mini responses for the Ask Me chat panel. Tool-using:
the model can call `listJobs`, `getJobDetails`, etc. to ground answers
in real data. Implementation uses the Vercel AI SDK's `streamText` +
tool-call loop.

**Auth:** session cookie required.

**Body:**
```ts
{ messages: Array<{ role: 'user' | 'assistant'; content: string }> }
```

**Response:** `text/event-stream` — Vercel AI SDK protocol. Use
`useChat()` on the client.

Source: `apps/web/app/api/chat/route.ts`.

---

## `/api/jobs/aging`

`GET /api/jobs/aging`

Aging-bucket distribution + anomaly flags for the current AR working
set.

**Query params** (all optional):
- `bucket` — one of `within-terms | 1-30-past | 31-60-past | 60-plus-past`
- `rep` — rep ID
- `region` — region string
- `jobType` — `insurance | retail`

**Response:**
```ts
{
  asOf: string;                             // ISO timestamp
  totalCount: number;
  bucketSummary: Record<bucket, { count: number; total: number }>;
  jobs: ARJob[];                            // filtered set
  anomalies: { ruleId: string; jobIds: number[]; label: string }[];
}
```

Filtering and aggregation delegate to `shared/domain/aging.ts` so the
API matches the dashboard's client-side filters exactly.

---

## `/api/jobs/milestones`

`GET /api/jobs/milestones`

Per-job missing-milestone report. Used by the milestones page.

**Query params:**
- `rep` — rep ID

**Response:**
```ts
{
  asOf: string;
  totalCount: number;
  jobs: Array<ARJob & { missingMilestones: string[] }>;
}
```

---

## `/api/jobs/follow-ups`

`GET /api/jobs/follow-ups`

Splits the AR set into two queues:
- `followUps` — `heatBand === 'hot'` (Vera drafts an email to the rep)
- `executiveQueue` — `heatBand === 'critical'` (skips the rep, goes to
  exec review)

**Query params:**
- `band` — `hot | critical`
- `rep` — rep ID

**Response:**
```ts
{
  asOf: string;
  followUps: ARJob[];
  executiveQueue: ARJob[];
}
```

---

## `/api/jobs/reconciliation`

`GET /api/jobs/reconciliation`

Jobs that "fell through cracks" — completed installs with no recent
activity. Per `shared/domain/reconciliation.ts`: no cert of completion,
no commission request, no final check (insurance), no edits in 14 days.

**Response:**
```ts
{
  asOf: string;
  jobs: Array<ARJob & { staleSince: string }>;
}
```

---

## `/api/reps/outstanding`

`GET /api/reps/outstanding`

Per-rep AR leaderboard.

**Query params:**
- `sort` — `dollars | count | oldest | avgHeat | installValue | commissions | installsCompleted`
- `region` — region string
- `jobType` — `insurance | retail`

**Response:**
```ts
{
  asOf: string;
  reps: Array<{
    id: string;
    name: string;
    totalOutstanding: number;
    jobCount: number;
    oldestDays: number;
    avgHeat: number;
    criticalCount: number;
    // ...
  }>;
}
```

---

## `/api/briefings/regenerate`

`POST /api/briefings/regenerate`

Generates a fresh AI dashboard briefing for the (single, hardcoded)
tenant and persists it as a `Briefing` row. The dashboard renders the
most recent row.

> **Auth status:** currently uses a hardcoded `TENANT_ID_FALLBACK = 1`
> with a `// TODO` comment. The session-based auth lift is a known
> followup tracked in `RELEASE.md`. The route is reachable from
> the gated `/dashboard` page only, so practically it's session-gated.

**Body:** none.

**Response:**
```ts
{
  ok: true;
  briefing: {
    headline: string;
    bodyMd: string;
    sources: Array<{ type: 'nws' | 'news'; label: string; detail?: string; url?: string }>;
    generatedAt: string;
    model: 'gpt-4o';
  };
}
```

Or on error:
```ts
{ ok: false; error: string }
```

Source: `apps/web/app/api/briefings/regenerate/route.ts`.

---

## `/api/briefings/preview`

`GET /api/briefings/preview`

Generates a briefing **without** writing it to the DB. Used for local
smoke checks when the database isn't yet provisioned.

**Response:** same shape as `/api/briefings/regenerate`, minus the
`briefingId`.

---

## `/api/schedules`

### `GET /api/schedules`

Lists schedules for the signed-in user's tenant.

**Auth:** session cookie required → 401 otherwise.

**Response:**
```ts
{
  schedules: Schedule[];
}
```

### `POST /api/schedules`

Creates a new `Schedule` row. Server-side snaps `timeLocal` to the
nearest 15-minute slot before persisting.

**Auth:** session cookie required → 401 otherwise.

**Body:**
```ts
{
  cadence: 'daily' | 'weekly' | 'monthly';
  dayOfWeek?: number | null;       // 0–6, weekly only
  dayOfMonth?: string | null;      // '1'..'28' or 'last' or 'last-business', monthly only
  timeLocal: string;               // 'HH:mm' 24h
  timezone: string;                // IANA, e.g. 'America/Chicago'
  recipient: string;               // email
  enabled?: boolean;               // default true
}
```

**Response:** `201 Created`
```ts
{ schedule: Schedule }
```

**Validation:** Zod-validated. 400 with field-level issues on bad input.

Source: `apps/web/app/api/schedules/route.ts`.

---

## `/api/brief/send`

`POST /api/brief/send`

Renders a brief PDF and emails it via Resend. Used by the **Send now**
button in the Scheduler UI.

**Auth:** open. The route doesn't check auth — it relies on being
called from the gated UI. The dispatcher (`/api/cron/dispatch-briefs`)
calls `sendBrief()` in-process, not through this HTTP route.

**Body:**
```ts
{
  to: string;                                  // email
  cadence?: 'daily' | 'weekly' | 'monthly';   // default 'daily'
  sendAt?: string;                             // ISO 8601 UTC, future only — Resend schedules
}
```

**Response:**
```ts
{
  id: string;            // Resend message id
  scheduledFor: string | null;
  subject: string;
  pdfBytes: number;
  to: string;
}
```

Or on error: `{ error: { code: string; message: string } }` with
appropriate status.

Source: `apps/web/app/api/brief/send/route.ts`. Also exports
`sendBrief()` — the internal function the dispatcher calls.

---

## `/api/cron/dispatch-briefs`

`POST /api/cron/dispatch-briefs`

The cron worker. Triggered every 15 minutes by the
`cron-dispatch-briefs.yml` GitHub Actions workflow. Finds due
`Schedule` rows, atomically claims each via an optimistic lock on
`nextRunAt`, fires the email via in-process `sendBrief()`, writes
`SendLog`, advances `nextRunAt`.

**Auth:** `Authorization: Bearer <CRON_SECRET>`. Anything else → 401.

**Body:** none.

**Response:**
```ts
{
  dispatched: number;          // count where status='sent'
  failed: number;
  skipped: number;             // count claimed by a concurrent dispatch
  total: number;
  results: Array<
    | { scheduleId: number; status: 'sent'; resendId?: string }
    | { scheduleId: number; status: 'failed'; error: string }
    | { scheduleId: number; status: 'skipped'; reason: 'already_claimed' }
  >;
  at: string;                  // ISO timestamp
}
```

**Concurrency guarantee:** at-most-once delivery per scheduled slot.
Two parallel invocations will only cause one send. Verified via
`tests/e2e/cron-dispatch-race.spec.ts` (opt-in with `RUN_RACE_TEST=1`).

Source: `apps/web/app/api/cron/dispatch-briefs/route.ts`.

---

## `/api/cron/generate-briefings`

`POST /api/cron/generate-briefings`

Cron worker, runs on weekday at 7am Central via the
`cron-generate-briefings.yml` workflow. For each tenant: generates a
fresh AI briefing, writes a `Briefing` row. So the dashboard always has
something fresh to render in the morning without anyone clicking
"Fetch latest news".

**Auth:** `Authorization: Bearer <CRON_SECRET>`. 401 otherwise.

**Body:** none.

**Response:**
```ts
{
  generated: number;
  failed: number;
  results: Array<{
    tenantId: number;
    status: 'ok' | 'failed';
    briefingId?: number;
    error?: string;
  }>;
  at: string;
}
```

Per-tenant errors are caught — one tenant failing doesn't starve the
others.

Source: `apps/web/app/api/cron/generate-briefings/route.ts`.

---

## Calling the bearer-gated routes manually

For debugging or to fire a cron tick without waiting for GitHub:

```bash
CRON_SECRET="$(grep '^CRON_SECRET=' apps/web/.env.local | cut -d= -f2- | tr -d '"')"

# fire the dispatch loop right now
curl -X POST https://vera-mvp.vercel.app/api/cron/dispatch-briefs \
  -H "Authorization: Bearer $CRON_SECRET"

# regenerate today's AI briefing
curl -X POST https://vera-mvp.vercel.app/api/cron/generate-briefings \
  -H "Authorization: Bearer $CRON_SECRET"
```

Or via `gh` if the workflow is on `main`:

```bash
gh workflow run cron-dispatch-briefs.yml --repo adityauphade-mac/vera-mvp
```

Same code path; same outcome.
