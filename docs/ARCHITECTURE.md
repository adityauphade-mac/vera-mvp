# Vera MVP — Architecture & Tech Stack

> Last updated: 2026-05-15

## At a glance

- **Monorepo** managed by **pnpm workspaces** + **Turborepo**.
- **One Next.js 16 app** (`apps/web`) — UI + API routes deployed as Vercel Functions in the same project.
- **Shared code** under `shared/` — types/schemas, UI components, pure domain logic, utilities.
- **Postgres on GCP Cloud SQL** (`vera_prod` database, scoped `vera_app` role). 11-table schema covering app state (Tenant, User, Schedule, Briefing, SendLog, AuditLog, FailureNotificationSetting) and the backfill pipeline (BackfillSchedule, BackfillRun, RawRooflinkJob, RawRooflinkLineItems). Plus one **materialized view** (`LiveJob`) that's the dashboard's read projection — see below. One tenant onboarded today (Priority Roofs · Dallas).
- **Live data via materialized view.** Dashboards read from the `LiveJob` materialized view in Postgres, defined in [apps/web/prisma/migrations/20260515000000_add_livejob_materialized_view](../apps/web/prisma/migrations/20260515000000_add_livejob_materialized_view/migration.sql). LiveJob holds one deduplicated row per `(tenantId, rooflinkId)` with the AR/write-offs filter fields and the duplicate-address count extracted as proper indexed columns — no JSONB parsing on the hot read path. AR query is now ~1 ms (partial-index lookup), down from ~1200 ms when reading `RawRooflinkJob` directly. The view refreshes via `REFRESH MATERIALIZED VIEW CONCURRENTLY "LiveJob"` inside `tick-worker.promote()` after each non-empty `rooflink_jobs` promote; CONCURRENTLY keeps readers unblocked. Domain transforms (heat score, anomalies, reconciliation) still run in TypeScript on the filtered set returned by [apps/web/lib/backfill/merge-view.ts](../apps/web/lib/backfill/merge-view.ts).
- **Auth**: Auth.js v5 + Google OAuth, JWT session strategy, `/dashboard/*` gated by middleware.
- **AI**: Anthropic Claude Sonnet 4.6 — daily briefing + the Ask Vera chat panel.
- **Email**: Resend, verified sender domain `makanalytics.org`. PDFs (daily AR brief + backfill sync-complete report) generated in-process with `@react-pdf/renderer`.
- **Cron**: two engines. **GitHub Actions** runs the every-15-min sweep that polls `BackfillSchedule` and `Schedule` for due rows, plus the daily AI briefing generator. **Upstash QStash** drives per-tick backfill chains — each `/api/cron/backfill-tick` invocation fetches one Rooflink page and publishes the next tick. QStash requests are JWT-signed and verified via `lib/cron-auth.ts`.
- **Backfill pipeline**: `BackfillRun` is append-only with a `dataVersion` tag. The `LiveJob` materialized view projects the latest payload per natural key across all `promoted=true` runs. Atomic promote + `REFRESH MATERIALIZED VIEW CONCURRENTLY` = zero-downtime data swap. Empty-incremental runs (zero new rows) short-circuit: they complete without promoting, so no refresh or cache bust fires for syncs that found nothing.
- **End-to-end tests** via Playwright — 112+ specs, JWT-cookie helper for auth-gated specs, hard guard that refuses to wipe a DB with promoted runs.
- **Deployed** to Vercel (`vera-mvp.vercel.app`). Auto-deploy is broken pending identity reconciliation — manual `vercel --prod --yes` from the canonical repo until then.

For the topology diagram, table-by-table walkthrough, and routes
reference, see [`INFRASTRUCTURE.md`](./INFRASTRUCTURE.md). For
full route documentation see [`API.md`](./API.md). For a working
local environment, see [`ONBOARDING.md`](./ONBOARDING.md).

---

## Repository layout

```
israil_mvp/
├── apps/
│   └── web/                              # Next.js 16 app (UI + API routes)
│       ├── app/
│       │   ├── page.tsx                  # / — landing (conditional CTA: "Sign in" anon, "Open the dashboard" signed-in)
│       │   ├── login/page.tsx            # /login — Google sign-in
│       │   ├── docs/page.tsx             # /docs — Vera handbook
│       │   ├── design/page.tsx           # /design — design system gallery
│       │   ├── dashboard/
│       │   │   ├── page.tsx              # /dashboard — today's briefing (BriefingCard) + metric tiles + top three
│       │   │   ├── layout.tsx            # gated chrome (sidebar + chat panel)
│       │   │   ├── _components/          # SidebarNav, MobileNav, ChatPanel, BriefingCard, JobDetailSheet
│       │   │   ├── aging/                # /dashboard/aging
│       │   │   ├── follow-ups/           # /dashboard/follow-ups
│       │   │   ├── milestones/           # /dashboard/milestones
│       │   │   ├── reconciliation/       # /dashboard/reconciliation
│       │   │   ├── rep-leaderboard/      # /dashboard/rep-leaderboard
│       │   │   └── scheduler/            # /dashboard/scheduler
│       │   ├── _actions/auth.ts          # server action: sign-out
│       │   └── api/
│       │       ├── auth/[...nextauth]/   # Auth.js handlers
│       │       ├── chat/                 # POST — Vercel AI SDK streaming
│       │       ├── jobs/{aging,milestones,follow-ups,reconciliation}/
│       │       ├── reps/outstanding/
│       │       ├── briefings/{regenerate,preview}/
│       │       ├── schedules/            # GET / POST — auth-gated
│       │       ├── brief/send/           # POST — Send Now (also exports sendBrief())
│       │       └── cron/{dispatch-briefs,generate-briefings}/
│       ├── lib/
│       │   ├── auth.ts                   # full Auth.js config (DB-aware)
│       │   ├── auth.config.ts            # edge-safe config (used by middleware)
│       │   ├── db.ts                     # Prisma client singleton
│       │   ├── briefing-generator.ts     # AI briefing builder
│       │   ├── cadence.ts                # DST-safe computeNextRun()
│       │   ├── email.ts                  # Resend wrapper
│       │   ├── daily-brief-pdf.ts        # PDF render via @react-pdf/renderer
│       │   └── news/{nws,newsapi}.ts     # external context fetchers
│       ├── middleware.ts                 # /dashboard/* auth gate
│       ├── prisma/
│       │   ├── schema.prisma
│       │   ├── migrations/
│       │   └── seed.ts
│       ├── types/next-auth.d.ts          # extends Session with userId/tenantId/role
│       └── eslint.config.mjs             # flat config
│
├── shared/
│   ├── types/                            # TS types + Zod schemas
│   ├── ui/src/components/                # Button, Card, Sheet, TimePicker, Tooltip, etc.
│   ├── domain/                           # pure business logic
│   │   ├── heat-score.ts
│   │   ├── anomalies.ts
│   │   ├── aging.ts
│   │   ├── reconciliation.ts
│   │   └── daily-brief.ts                # builds the brief data shape consumed by sendBrief()
│   └── utils/
│
├── scripts/
│   └── preprocess.ts                     # build-time: data/jobs_dedup.jsonl → data/generated.json
│
├── tests/
│   └── e2e/
│       ├── _helpers/                     # auth.ts (JWT cookie minter), global-setup.ts (DB reset)
│       ├── *.spec.ts                     # Playwright specs — see docs/TESTING.md for the coverage map
│       └── audit-screens/                # gitignored output of visual specs
│
├── data/                                 # gitignored — input + generated artifacts
│   ├── jobs_dedup.jsonl                  # source export (raw)
│   └── generated.json                    # output of preprocess
│
├── docs/                                 # operational documentation
│   ├── ARCHITECTURE.md                   # this file
│   ├── INFRASTRUCTURE.md
│   ├── OPERATIONS.md
│   ├── API.md
│   ├── DATA_MODEL.md
│   ├── ONBOARDING.md
│   ├── DEMO.md
│   ├── TESTING.md
│   ├── SECURITY.md
│   ├── RELEASE.md
│   └── TROUBLESHOOTING_HISTORY.md
│
├── pnpm-workspace.yaml
├── turbo.json
├── playwright.config.ts
├── CLAUDE.md                             # project constitution
├── SPEC.md
├── DISCUSSION.md
├── IMPROVEMENTS.md
├── IMPLEMENTATION_PLAN.md
└── package.json                          # workspace root
```

---

## Tech stack

### Application

| Item | Version | Purpose |
|---|---|---|
| Next.js | 16.2.4 (App Router) | UI + API routes, deployed as Vercel Functions |
| React | 19.2.4 | Server + client components |
| TypeScript | 5.7.x (strict) | Language |
| Tailwind CSS | 4.x | Styling |
| `@vera/ui` | workspace | shadcn-style components: Button, Card, Sheet, Tabs, ConfirmDialog, Toaster, TimePicker, Tooltip, etc. See full inventory in the "Design system" section below. |
| Sonner | 2.x | Toast notifications (re-exported from `@vera/ui`, themed via Vera CSS variables) |
| Lucide Icons | 0.469 | Iconography |
| Recharts (Tremor) | — | Charts |
| React Hook Form | 7.x | Form state |
| Zod | 3.24 | Schemas + validation |
| nuqs | 2.x | URL search-param state |
| date-fns | — | Date math |

### Auth + DB

| Item | Version | Purpose |
|---|---|---|
| Auth.js (`next-auth`) | 5.0.0-beta.31 | Google OAuth, JWT sessions |
| Prisma | 6.19.x | ORM + migrations |
| GCP Cloud SQL Postgres 16 | — | Database (`vera_prod`, accessed via scoped `vera_app` role) |

### AI + email

| Item | Where used |
|---|---|
| Vercel AI SDK (`ai` + `@ai-sdk/openai`) | `/api/chat` — streamed chat with tool use |
| Anthropic Claude Sonnet 4.6 | Daily AI briefing + Ask Vera chat |
| `openai` SDK | Briefing generator (direct, not via AI SDK) |
| NWS API (free) | Storm-alert context for briefings |
| NewsAPI | Roofing-industry headlines for briefings |
| Resend (`resend` SDK) | Email + PDF delivery |
| `@react-pdf/renderer` | PDF rendering for the daily brief |

### Build / lint / test

| Item | Purpose |
|---|---|
| pnpm 10.x | Monorepo package manager |
| Turborepo | Task runner |
| Playwright | End-to-end tests |
| ESLint 9 (flat config) | Lint — `apps/web/eslint.config.mjs` |
| Prettier | Format |
| Husky + lint-staged | Pre-commit hooks |

### Deployment + ops

| Item | Purpose |
|---|---|
| Vercel | Hosting + CI/CD; auto-deploys on push to `main` |
| GitHub Actions cron | 15-min sweep for due `Schedule` / `BackfillSchedule` rows; daily AI briefing trigger |
| Upstash QStash | Per-tick backfill delivery (chains `backfill-tick` invocations) |

---

## Data flow

### Backfill (Rooflink → DB)

```
Operator clicks "Run now" or cron fires
   │
   ▼
POST /api/backfills/[source]/runs
   │ creates BackfillRun row (status=running, promoted=false)
   ▼
QStash publishes first tick
   │
   ▼
POST /api/cron/backfill-tick   ◄────────┐
   │ fetches next page from Rooflink    │
   │ INSERTs rows with dataVersion=run.id│
   │ advances cursor                     │
   │ publishes next tick ────────────────┘
   ▼
Last tick: promote()
   │ status='completed', promoted=true
   │ updates BackfillSchedule.lastSyncedAt
   │ invalidateDataSnapshot + invalidateWriteOffsSnapshot
   ▼
notifySuccess: render PDF + send Resend email
```

### Dashboard read (request time)

```
Browser GET /dashboard/aging
   ▼
Next.js server component / API route
   ▼
withAuth → getData(tenantId)
   ▼
Cache key probe (SELECT id FROM BackfillRun WHERE promoted=true)
   ├─ hit → return cached GeneratedData
   └─ miss:
      ├─ getLiveARJobsWithContext(tenantId)
      │   └─ ONE SQL query against the LiveJob materialized view:
      │      partial-index lookup on (tenantId, dateCompleted, balance)
      │      filtered to AR-eligible (dateCompleted IS NOT NULL,
      │      balance > 0, excludeFromQb = false)
      │      → ~130 rows × ~5 KB = ~650 KB transferred, ~1 ms in Postgres
      ├─ Zod parse + toARJob() per row (uses the `payload` JSONB column
      │   retained on LiveJob — the structured columns gate the WHERE,
      │   the JSONB carries the full Rooflink shape to the domain layer)
      └─ cache + return
```

Heat-score / aging / anomaly logic lives in `shared/domain` — the same
code paths used by both the legacy `scripts/preprocess.ts` (built-time
JSON generation, now dormant) and the live DB path. Same input → same
output regardless of which side you ran it from.

The legacy `data/jobs_dedup.jsonl` (196 MB) is kept on developer
machines only — gitignored, vercelignored, useful for cold-starting a
fresh local Postgres via `scripts/load-jsonl-into-local.mjs`. The
in-app JSON snapshot path was retired in the 2026-05-18 JSON-removal
change (see `JSON_REMOVAL_PLAN.md`); production reads exclusively from
Postgres.

---

## Auth model

- Single tenant (`tenantId=1`, Priority Roofs Dallas) — schema is
  multi-tenant, only one row exists.
- Google OAuth via Auth.js v5. JWT session strategy (cookie-based, no
  server-side session table).
- On first sign-in the `signIn` callback creates a `User` row and binds
  it to `tenantId=1`. Subsequent sign-ins find the existing row.
- The session callback stamps `userId`, `tenantId`, `role` onto the
  session so middleware + API routes can use them.
- Middleware (`apps/web/middleware.ts`) imports the **edge-safe**
  config from `lib/auth.config.ts` only. The full config in `lib/auth.ts`
  imports Prisma — pulling that into the middleware bundle exceeds
  Vercel's 1 MB Edge limit. See `docs/TROUBLESHOOTING_HISTORY.md` for
  the full story.

---

## Cron & scheduling

Two Upstash QStash schedules, configured in the Upstash dashboard:

| QStash schedule | Cron | Calls |
|---|---|---|
| `dispatch-briefs` | `*/5 * * * *` (UTC) | `POST /api/cron/dispatch-briefs` |
| `generate-briefings` | `0 12 * * 1-5` (UTC, ≈7am Central) | `POST /api/cron/generate-briefings` |

QStash signs each request with a JWT in the `upstash-signature` header.
`apps/web/lib/cron-auth.ts` verifies it against
`QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY` (both must be
set so QStash can rotate keys without an outage). For manual testing,
the helper also accepts a legacy `Authorization: Bearer $CRON_SECRET`
fallback.

**The dispatcher is at-most-once.** It claims due `Schedule` rows via
an atomic Postgres UPDATE guarded by the original `nextRunAt`. Two
concurrent dispatches will only cause one send. Verified by
`tests/e2e/cron-dispatch-race.spec.ts`. See `docs/OPERATIONS.md` for the
sequence diagram and the QStash management runbook.

---

## Design system

A warm fintech aesthetic — premium, intelligent, not cold. Inspired by
CRED's editorial composure, reinterpreted softer.

**Deliberately rejected:** pure black on pure white, loud accent colors,
dense data grids, massive stat numbers, sharp 90° corners, cool grays.

### Color palette

| Token | Hex | Use |
|---|---|---|
| `bg-base` | `#F5EFE6` | Page background — warm parchment |
| `bg-card` | `#FFFCF7` | Card surfaces — soft cream |
| `bg-elevated` | `#FFFFFF` | Modals, popovers |
| `text-primary` | `#1F1B16` | Body text — deep warm brown |
| `text-secondary` | `#6E6258` | Labels — warm gray |
| `text-muted` | `#9C8E80` | Helper text — warm taupe |
| `border` | `#E8DECF` | Hairlines — soft tan |
| `accent` | `#C8854E` | Primary CTAs, Vera's voice — terracotta brass |
| `accent-soft` | `#E8C5A0` | Highlights |
| `success` | `#7A8F6F` | Positive signals — sage moss |

### Heat score bands

| Band | Heat | Hex | Feel |
|---|---|---|---|
| Cool | 0–25 | `#7A8F6F` | Sage — calm |
| Warm | 26–50 | `#C9A05F` | Mellow mustard — keep an eye |
| Hot | 51–75 | `#C8714C` | Warm terracotta — needs attention |
| Critical | 76+ | `#A14535` | Muted brick — has presence without screaming |

### Aging buckets

| Bucket | Hex |
|---|---|
| Within terms | `#9C8E80` |
| 1–30 past | `#C9A05F` |
| 31–60 past | `#C8714C` |
| 60+ past | `#A14535` |

### Typography

| Use | Font |
|---|---|
| Display / headings | **Fraunces** (variable serif) |
| Body / UI | **Inter** (variable sans) |
| Numerics in tables | Inter with `font-variant-numeric: tabular-nums` |

### Density & rhythm

- Page max-width: 1200px, centered. Never edge-to-edge.
- Section vertical rhythm: 64px between major sections.
- Card padding: 32px desktop, 24px mobile.
- Table row height: 56px (reads as a list, not a grid).
- Border radii: 16–20px on cards, 12px on inputs, full on pills/badges.
- Shadows: subtle, warm-tinted (brown undertones).

### Component inventory (`@vera/ui`)

Every shared component lives in `shared/ui/src/components/` and is re-exported
from `@vera/ui`. Page files import from there; **no inline one-off UI primitives**
(per CLAUDE.md rule #13). The live design-system page at `/design` is the
canonical inventory — open it before adding anything new.

| Primitive | Surface | Notes |
|---|---|---|
| `Button` | shared | 5 variants (primary, secondary, ghost, link, destructive), 4 sizes |
| `Card` | shared | Default surface for grouping |
| `Tabs / TabsList / Tab / TabsContent` | shared | Underline-style. Controlled or uncontrolled. ARIA-correct. |
| `ConfirmDialog` + `useConfirm()` | shared | Promise-based replacement for `window.confirm()`. Mount `<ConfirmProvider>` once at root. |
| `Toaster` + `toast` (re-exported from sonner) | shared | Themed via `globals.css` `[data-sonner-toaster]` block to use Vera tokens. Loading toasts with a stable id update in place — ideal for long-running operations. |
| `Sheet` | shared | Right-side drawer with portal + animations |
| `Select`, `Popover`, `Switch`, `TimePicker`, `Calendar`, `DateTimePicker` | shared | Form primitives (mostly Radix-backed) |
| `Table`, `TableShell`, `TablePagination`, `TableToolbar` | shared | Composable table parts |
| `FilterMenu` | shared | Multi-select chip+dropdown filter |
| `MetricTile`, `HeatScoreBadge`, `HeatMeter`, `AgingChip`, `AnomalyTag`, `MissingStepTag` | shared | AR-domain visualizations |
| `Tooltip`, `Skeleton`, `Ticker`, `VeraAvatar`, `VeraQuote` | shared | Misc affordances |

### Feedback patterns

- **Confirmations** (Remove, Cancel run, etc.) → `useConfirm()` returns
  `Promise<boolean>`. Never `window.confirm()`.
- **Transient status** (saved, sent, paused, network error) → `toast.success()` /
  `toast.error()`. Never inline `<div>` banners that conditionally render.
- **Long-running progress** (backfill runs, multi-second jobs) →
  `toast.loading()` with a stable string id, replaced in-place on update,
  promoted to `toast.success()` / `toast.error()` on completion. Persists across
  page navigations because `<Toaster>` lives in the root layout.
- **Persistent informational state** (a card showing "last run failed at X
  rows") → stays on-card. That's history, not transient.

### Voice and tone

Vera speaks like a thoughtful colleague, not an assistant. Numbers come
with context, not dumped.

> *"Good morning. I'm watching three jobs more closely than usual today
> — Mike Ahrend's McMackin install crossed into the Hot band overnight."*

Not:

> ~~"🚨 3 CRITICAL ALERTS — IMMEDIATE ACTION REQUIRED"~~

This shapes button copy, empty states, error messages, email drafts,
and chat tone.

---

## Testing

Playwright end-to-end only — see [`TESTING.md`](./TESTING.md)
for the full coverage map. ~96 specs in the default suite, JWT cookie
helper for auth-gated specs, opt-in env flags for live-network tests.

### Common commands

```bash
PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm exec playwright test
pnpm exec playwright test landing            # one spec
pnpm exec playwright test --ui               # interactive
RUN_RACE_TEST=1 pnpm exec playwright test cron-dispatch-race
```

There's no GitHub Actions CI workflow that runs the full Playwright
suite today. Tests are run manually before merging.

---

## Development workflow

```bash
pnpm install                       # install workspaces
pnpm --filter @vera/web exec prisma generate
pnpm preprocess                    # generate data/generated.json
pnpm --filter @vera/web dev        # apps/web on :3000
pnpm --filter @vera/web typecheck
pnpm --filter @vera/web lint
pnpm --filter @vera/web build      # production build (auto-runs prisma generate)
```

For a 15-minute "first run" walkthrough see [`ONBOARDING.md`](./ONBOARDING.md).
