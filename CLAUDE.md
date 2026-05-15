# CLAUDE.md — Project Constitution

This file is the source of truth for how code is written in this repository. Every Claude session reads this first. If any instruction here conflicts with a one-off user request, ask before deviating.

---

## Project context

**What this is.** An MVP of "Vera Calloway," an AI Accounts Receivable specialist for a roofing company (Priority Roofs). The brief, the five focused requirements, and all 19 product decisions are documented in `SPEC.md` and `DISCUSSION.md`. Read those before writing code.

**Architecture.** Monorepo (pnpm workspaces + Turborepo), one Next.js 16 app, all shared code in `shared/`, deployed to Vercel. Full architecture in `docs/ARCHITECTURE.md`.

**You are read-only on Rooflink.** Rooflink is the system of record. Vera fetches via their REST API, writes raw payloads to our Postgres, and never writes back. The legacy `data/jobs_dedup.jsonl` export is also read-only and predates the live backfill pipeline (now dormant).

**Production runs on the DB read path** (`USE_DB_DATA_SOURCE=1` on Vercel) against GCP Cloud SQL `vera_prod`. The bundled JSON snapshots in `apps/web/data/` are dormant fallback artifacts kept for emergency rollback only.

---

## Hard rules — never violate

1. **No `any` in TypeScript.** If a type is unclear, infer it from the data, define it in `shared/types`, or use `unknown` and narrow.
2. **No business logic in components.** Components consume; `shared/domain/*` computes. Heat score, aging, anomaly detection — all in `shared/domain/`.
3. **The dashboard never fetches the raw 188 MB JSONL or the full ~250 MB JSONB population at runtime.** The hot read path goes through the `LiveJob` Postgres materialized view (definition lives in `apps/web/prisma/migrations/20260515000000_add_livejob_materialized_view/migration.sql`) — one deduplicated row per `(tenantId, rooflinkId)` with the AR/write-offs filter fields and `addressDupCount` extracted as proper indexed columns. Reads are a partial-index lookup (~1 ms); **no JSONB parsing on the request path.** `RawRooflinkJob` remains the source of truth; the view is refreshed by `REFRESH MATERIALIZED VIEW CONCURRENTLY "LiveJob"` inside `tick-worker.promote()` after each non-empty `rooflink_jobs` promote. Read helpers live in `apps/web/lib/backfill/merge-view.ts`. The legacy JSON snapshots in `apps/web/data/*.json` are dormant rollback artifacts, not part of the read path.
4. **Outbound email only via the audited send pipeline.** All sends go through `apps/web/lib/email.ts` → Resend. Every send requires explicit user action and a confirmation step in the UI. The Resend domain is verified, so emails can be sent to any recipient. Both daily AR briefs and follow-up emails ride this pipeline; both land in `AuditLog` with full recipient/cc/subject/body detail. Supersedes Q9 of the original spec — see `DISCUSSION.md` §6.7.
5. **No autosend without explicit human intent.** Scheduled sends use Resend's `scheduled_at` field — they require a user to compose, preview, and confirm a specific email targeted at a specific time. The cron dispatcher (`dispatch-briefs`) fires *user-configured* schedules at the user-specified time. No silent recurring sends without a human-authored configuration.
6. **No new top-level packages without updating this file.** Tech stack is pinned (see below).
7. **Every new route gets a Playwright spec before it merges.** No exceptions.
8. **Every default behavior must be visible in the UI** (tooltip / footnote) so users can spot and challenge it. Per the SPEC.md philosophy.
9. **Local dev DB ≠ production DB. Both can hold real data; never let one be the test target without an explicit guard.** Local runs against `postgres://localhost/vera_dev`; production runs against GCP Cloud SQL `vera_prod`. There is no staging DB. Any script that `DELETE`s or `UPDATE`s more than a single row on either DB is production-data-loss-in-the-making — get explicit user ACK before running. Read-only queries don't need ACK. **Playwright global-setup wipes 8 tables every run**; it has a hard guard refusing to run against any DB with a `promoted=true` `BackfillRun`. Don't disable that guard without thinking very hard about it. (Learned 2026-05-14 the hard way — see `docs/TROUBLESHOOTING_HISTORY.md`.)
10. **Server (DB) is the source of truth for UI state.** Fetch from the DB on mount; `localStorage` is only a draft buffer for unsaved form input. Never trust the local cached value to match what the cron worker, another tab, or another user is seeing.
11. **No native browser dialogs, no inline transient banners.** `window.alert()`, `window.confirm()`, and `window.prompt()` are forbidden — they look broken, can't be styled, and can't be tested without intercepting `page.on('dialog')`. Use `useConfirm()` from `@vera/ui` for confirmations and `toast()` from `@vera/ui` (sonner-backed) for success/error/loading feedback. Transient status (sent / saved / paused / cancel-confirmation / API error) goes through toasts, NOT inline `<div>` banners inside the page. Persistent state (a card's "last run failed" history line) stays on-page because it's informational, not transient. Long-running operations (backfill runs, multi-second jobs) use a persistent `toast.loading()` with a stable id and update-in-place — the toast IS the progress UI, no separate progress bar on the page. If you find yourself reaching for `setError` + a conditionally-rendered red div, that's a toast.
    - **Modal flavors** — two patterns, share the same visual chrome (centered, `bg-bg-card`, `rounded-[var(--radius-card)]`, `p-7`, `shadow-2xl`) AND the same display-serif title typography (`font-display text-2xl tracking-tight`). They differ only in what surrounds the title and in default behavior:
      - **`<Modal>` — content surface, no icon.** Body owns the layout. Default close X top-right. Use for chat (Ask Vera), info dialogs, custom forms.
      - **`<ConfirmDialog>` + `useConfirm()` — action confirmation, with icon.** Same display-serif title. Adds a tinted icon block to the left (accent or heat-critical) which is what visually signals "this is a confirmation." Title is an **imperative, not a question**: "Cancel this run", not "Cancel this run?". Description is the body, left-aligned to the modal edge. Close X hidden — user must pick a button. Right-aligned button row: `secondary` cancel + `primary`/`destructive` confirm. Use whenever the user must pick between two paths.
    - **Toast icons** — five distinct silhouettes (circle / octagon / triangle / rounded square / arc) so info ≠ error even ignoring color. Info uses the `--color-info` slate-blue token — the one cool tone in the otherwise warm palette.

12. **User-facing strings never expose internal identifiers.** No `rooflink_lineitems` in an email subject; the user reads "Rooflink estimate line items". Snake_case, kebab-case, and camelCase belong in code, not in copy. Maintain a friendly-label map alongside any enum.

13. **Shared UI primitives live in `@vera/ui`, not in page files.** If you're about to write a small headless component (tabs, modal, dropdown) inline in a page, stop and add it to `shared/ui/src/components/` first, then import from `@vera/ui`. Page-local one-offs accumulate into N copies of slightly different tab buttons. The design system page at `/design` is the inventory of what already exists — check there before adding anything new.

14. **Every production deploy gets an entry in [`docs/RELEASE.md`](docs/RELEASE.md), in the same change set.** When you ship to production — whether via `vercel --prod --yes` after a merge, an env-var flip + redeploy, or any other path that lands new behavior on `vera-mvp.vercel.app` — add a release-log entry **before** running the deploy. The entry includes: date, merge SHA(s), the user-visible change, and the rollback path if non-obvious. The point isn't bureaucracy; it's that "what's live right now?" should always have an answer in `RELEASE.md` without having to dig through commits. Treat it like the audit log for prod itself.

---

## Tech stack — pinned

If you find yourself reaching for something outside this list, stop and propose it before installing.

| Layer | Pinned choice |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript (strict mode) |
| Styling | Tailwind CSS |
| UI components | shadcn/ui + Lucide icons |
| Tables | TanStack Table v8 |
| Charts | Recharts (via Tremor wrappers) |
| Forms | React Hook Form |
| Validation | Zod |
| URL state | nuqs |
| Dates | date-fns |
| Theming | next-themes |
| AI | Vercel AI SDK + `@ai-sdk/anthropic` (Claude Sonnet 4.6) |
| Email | Resend (one-shot scheduled sends via `scheduled_at`) |
| PDF generation | `@react-pdf/renderer` (in-process, serverless-safe) |
| Tests | Playwright (E2E only for MVP) |
| Lint / format | ESLint + Prettier |
| Pre-commit | Husky + lint-staged |
| Package mgr | pnpm |
| Build orchestration | Turborepo |
| Deploy | Vercel |

**Forbidden in MVP:** Redux/Zustand/Jotai, axios (use native fetch), CSS-in-JS libs, Material UI / Chakra, Express in a separate service.

---

## Monorepo conventions

### Layout

```
apps/web/                  Next.js app (pages + API routes)
shared/types/              TS types + Zod schemas
shared/ui/                 shadcn components, design tokens
shared/domain/             Pure business logic (no React, no I/O)
shared/utils/              Date math, formatting helpers
scripts/                   Build-time tools
tests/e2e/                 Playwright specs
data/                      gitignored — source + generated artifacts
```

### Workspace rules

- **`apps/*`** are deployable units. Today there's only `apps/web`.
- **`shared/*`** are libraries consumed by apps. They never import from `apps/*` (one-way dependency).
- **`shared/domain/*`** is the strictest: pure functions only. No React imports. No `fetch`. No `Date.now()` in pure functions — pass dates in. This is the part that gets unit tested most easily, and reused by both build script and runtime API.
- **`shared/ui/*`** owns the design system. App-level pages compose UI components — they don't redefine them.

### Imports

- Within a workspace: relative paths (`./button`).
- Across workspaces: package name (`@vera/shared-domain`, `@vera/shared-ui`, etc.).
- No deep imports across packages — only from each package's `index.ts`.

---

## Worktrees

- **Name worktrees by function**, not by adjective. `worktrees/scheduler-natural-key`, `worktrees/qstash-migration` — yes. `claude/festive-burnell-293408` (the auto-generated `claude/<adjective>-<surname>-<digits>` form) — no. The name should describe what's in the worktree, the same way branch names do.
- **Keep active worktrees minimal.** One per in-flight piece of work. Remove with `git worktree remove <path>` when the work merges. Don't let them accumulate — every worktree duplicates gitignored data (notably the 187 MB `data/jobs_dedup.jsonl` and the per-worktree `node_modules`) and adds deploy footguns.
- **Bootstrap a fresh worktree with `scripts/setup-worktree.sh <path>`.** It copies the gitignored-but-required files (`apps/web/.env.local`, `data/jobs_dedup.jsonl`, `apps/web/data/generated.json`) from the canonical main repo, runs `pnpm install`, and runs `prisma generate`. Doing this by hand has cost us time twice — don't.
- **Never deploy from a worktree.** Worktrees carry their own copies of gitignored data, and `vercel --prod` from one will upload the wrong tree (we hit Vercel's 100 MB single-file limit because of this). Deploy from `/Users/aditya-levich/Build/israil_mvp` only.

---

## Shipping a change

- **Vercel git auto-deploy is not working today** — the Vercel team is owned by the `hexabytecode` GitHub account, the repo is owned by `adityauphade-mac`, and Vercel can't see this namespace. Pushes to `main` do not trigger a deploy. After merging to `main`, run `vercel --prod --yes` from the canonical main repo root every time. (Once the identity mismatch is resolved, this becomes automatic — see memory S1620 for the full diagnosis.)
- **Modifying `.github/workflows/*` needs the `workflow` OAuth scope** which the default `gh` and OAuth tokens here don't have. You'll get a misleading 404 on the Contents API or a workflow-scope rejection from `git push`. Two paths: use the GitHub web UI (your browser session has full owner permissions) for one-off edits, or refresh CLI access once with `gh auth refresh -h github.com -s workflow`.
- **One commit, one logical change.** Bundling a refactor with an infrastructure migration in the same PR (we did this with PR #13) works but makes review harder. Default to separate PRs unless the changes are inseparable.
- **Add the `docs/RELEASE.md` entry before you deploy, not after.** Per rule #14. A deploy without a release-log entry is incomplete. Format: date, merge SHA(s) on `main`, the user-visible change in plain English, rollback path if non-obvious. Newest entry on top.

---

## File and naming conventions

### Files

- React components: `PascalCase.tsx` (e.g., `HeatScoreBadge.tsx`)
- Hooks: `useCamelCase.ts`
- Pure functions / domain: `kebab-case.ts` (e.g., `heat-score.ts`, `aging.ts`)
- Routes (Next.js): lowercase folder names — already enforced by App Router
- Tests: `<module>.spec.ts` for Playwright, colocated under `tests/e2e/`

### Naming

- Booleans: `isFoo`, `hasFoo`, `shouldFoo`
- Event handlers: `onFoo` (props), `handleFoo` (local)
- Functions return what they say: `computeHeatScore(...)`, not `getHeatScore(...)` if it does math
- Avoid abbreviations except: `id`, `url`, `db`, `ar` (for Accounts Receivable in this codebase)

### Comments

- Default to none. Code reads itself.
- Exception: domain logic that encodes a decision from `SPEC.md` — short comment with the question number, e.g. `// Q3: Net 60 for insurance jobs`.

---

## Loading states: skeleton-first

Client components that fetch from the API on mount MUST render a skeleton — never default/empty state — until the first server response lands. Rendering "Not scheduled" or empty form fields for the 200-2000 ms before the fetch resolves produces a visible state jump when real data swaps in. Operators read that flash as a bug, even when it's "just" the loading window.

### The rule

If a client component issues a `fetch` from a `useEffect` on mount and the page's UI depends on the response, you need a separate `loaded: boolean` (or equivalent) flag that flips true exactly once when the first response settles. Render a `*Skeleton` variant of the layout until that flag flips. Subsequent refetches (filter changes, manual refresh) keep the previous data on-screen with a refresh-spinner affordance — no flash.

### What the skeleton looks like

- Same Card chrome, same vertical rhythm, same column widths as the real component. The skeleton's job is "show the structure of what's about to load" so the page doesn't shift when real data arrives.
- Composed from `<Skeleton>` and `<SkeletonText>` in `@vera/ui`. `<SkeletonText width="w-32" />` for single-line text shimmers; raw `<Skeleton className="..." />` for icons / pills / buttons / non-text shapes.
- Page-local: each component defines its own `*Skeleton` function colocated with the real one (`ReportRowSkeleton` next to `ReportRow`, `BackfillCardSkeleton` next to `BackfillCard`, etc.). The shared primitives keep the visual rhythm consistent without coercing every page into one shape.

### Code shape

```tsx
const [loaded, setLoaded] = useState(false);
const [data, setData] = useState<Server | null>(null);

useEffect(() => {
  (async () => {
    try {
      const res = await fetch('/api/...');
      if (res.ok) setData(await res.json());
    } finally {
      setLoaded(true); // flip exactly once, even if the fetch failed,
                      // so the page doesn't sit on skeletons forever
    }
  })();
}, []);

return loaded ? <RealCard data={data} /> : <RealCardSkeleton />;
```

### When SSR is a better answer

If the page is on a server component whose route already touches the DB, SSR the data and pass it as a prop instead — no client fetch, no skeleton needed. We prefer skeleton-first when the client component is reused across multiple parent contexts, when it polls, or when the fetch is auth-dependent in a way that's awkward to thread from the server. Default to skeleton-first; reach for SSR when the wiring is naturally there.

### Out of scope

- One-shot fetches triggered by user action (e.g. "Send now") — those use button-level pending state, not skeleton rows.
- Refetches that reuse already-rendered data (filter changes on `/dashboard/audit-logs`) — show a spinner on the refresh button, not a skeleton.

---

## Components — shadcn + RHF + Zod pattern

All form-bearing components follow this pattern:

```ts
// 1. Schema in shared/types
export const filterSchema = z.object({
  rep: z.string().optional(),
  region: z.string().optional(),
  bucket: z.enum(['within', '1-30', '31-60', '60+']).optional(),
});
export type FilterInput = z.infer<typeof filterSchema>;

// 2. Component in apps/web uses RHF + zodResolver
const form = useForm<FilterInput>({
  resolver: zodResolver(filterSchema),
  defaultValues: { ... },
});

// 3. UI built from shared/ui shadcn components
<Form {...form}> ... </Form>
```

**Never define ad-hoc form state with `useState` for fields.** RHF for everything.

---

## Domain logic rules (`shared/domain/*`)

- **Pure functions only.** Input → output. No side effects.
- **`now: Date` is a parameter**, not `new Date()` inside the function. Tests pass deterministic dates.
- **Each rule from SPEC.md is its own function.** Example:

```
shared/domain/
  heat-score.ts          computeHeatScore(job, context, now)
  anomalies.ts           detectAnomalies(job, allJobs)
  aging.ts               computeAgingBucket(job, now)
  reconciliation.ts      isInPipeline(job, now), didFallThroughCracks(job, now)
  classification.ts      isInsurance(job), isInARWorkingSet(job)
```

- **Each function has a doc comment naming the spec question** it implements (`// Implements Q7: heat score model.`).

---

## Audit logging

Every meaningful action lands in the `AuditLog` table. The integration is mostly automatic — adding a new feature usually inherits logging without any code in the route itself. Two paths:

### Auto path — DB mutations on auditable models

A Prisma client extension at `apps/web/lib/db.ts` intercepts every `create/update/upsert/delete/updateMany/deleteMany` on models listed in `AUDITABLE_MODELS` (defined in `apps/web/lib/audit.ts`). It writes a row to `AuditLog` with a generic summary like *"Schedule #23 updated"*, attributed to whoever owns the AsyncLocalStorage audit context.

**`AUDITABLE_MODELS` is currently empty by design.** Every V1 surface already emits explicit audit rows via the path below so they can carry pretty human-readable summaries. Opting a model INTO auto-audit would just produce a duplicate generic row alongside the pretty one. The extension stays wired in so a future model that doesn't need a custom summary can opt in with a one-line change to that set.

**Adding a new auditable model is one line.** Add the model name to `AUDITABLE_MODELS` and (optionally) a `MODEL_CATEGORY` entry so the category column reads correctly. New feature inherits logging.

The default behavior is **no audit** — only models you add to the set are tracked. This keeps noise low and avoids the duplicate-row problem.

### Explicit path — non-DB events and pretty summaries

For events that don't touch Prisma (auth callbacks, chat queries, external-API responses) call `recordAudit(db, { category, action, summary, details? })` directly. The category MUST exist in `shared/types/audit.ts`; the action SHOULD exist in `AUDIT_ACTIONS_BY_CATEGORY[category]` for that category (the API's Zod validator accepts arbitrary action strings to allow forward-compat, but UI filters only surface known actions).

For DB mutations where the generic summary would be ugly (*"Schedule #23 updated"* vs *"Daily AR brief paused"*), wrap the mutation in `withSuppressedAutoAudit(() => ...)` and follow it with an explicit `recordAudit(...)`. One row per action, prettily phrased.

### Hard requirements

- **User-gated routes use `withAuth(handler)`.** That helper populates the audit context. Without it, DB mutations from the route skip audit (silent failure). Non-negotiable.
- **System tasks (cron handlers, scripts) use `withSystemAuditContext({ tenantId }, fn)`.** Same pattern, `userId = null`. Cron loops wrap their per-tenant work with this.
- **Adding a category/action means updating `shared/types/audit.ts`.** UI filters and the API's Zod schema read from that catalog at build time.
- **Models opting INTO audit go in `AUDITABLE_MODELS`.** Default is no-audit. We choose to surface what's meaningful rather than auto-log everything.
- **`AuditLog` itself is NOT auditable.** That would recurse infinitely. It's already excluded.

### Every new mutation surface MUST land in the audit log

When you add a new feature with a mutating route, terminal state transition, or cron-triggered action, the PR is not complete until it emits an audit row. **This is a merge gate, not a polish item.** The two-question test:

1. *"If an operator opens `/dashboard/audit-logs` after this action happens, will they see a row that describes it?"* If no, you need a `recordAudit` call.
2. *"If a future-me has to reconstruct what happened from this row alone, do `summary` + `details` carry enough?"* If no, enrich the payload (before/after snapshot, recipient, run id, error, model — whatever the category warrants).

Practical checklist when shipping a new module:

- Add the category to `AUDIT_CATEGORIES` and the actions to `AUDIT_ACTIONS_BY_CATEGORY` in `shared/types/audit.ts`. Add a `humanizeAction` entry per action; otherwise the table label falls back to title-cased snake_case (acceptable but uglier).
- Call `recordAudit(db, {...})` after every successful mutation in user-gated routes (already wrapped by `withAuth`).
- For cron loops or worker jobs that drive state machines, emit at terminal transitions only (e.g. `run_completed`, `run_failed`) — not per-tick. Per-tick events would drown out the signal.
- Add a `*Body` renderer to the `AuditDetailSheet` in `apps/web/app/dashboard/audit-logs/AuditLogsView.tsx` so the new category gets a formatted detail view, not raw JSON.
- Cover at least one happy-path action of the new category in a Playwright spec so the integration can't silently regress.

If the category-action catalog and the route's `recordAudit` call disagree, the API still accepts the row (the action column is a plain string), but UI filter dropdowns won't surface the new action. So: catalog first, then the route call.

### Summaries are plain text

The `summary` column is rendered as plain text in the audit-log table AND inside the detail sheet header. Source data that happens to be markdown (AI-generated briefing headlines with `**bold**`, list items, etc.) will show literal asterisks if interpolated raw. **Strip markdown before storing** — use `toPlainSummary(s)` from `lib/audit.ts`. Same applies to any markdown-bearing field copied into `details` that the per-category renderer surfaces directly (e.g. the headline callout in `BriefingBody`). Audit storage is a display surface, not a content store.

### Privacy note

Chat audit entries capture the user's question text in `details.messages` (within-tenant only, gated by session). Mutation entries capture before/after row snapshots. Don't audit anything you wouldn't want a tenant admin to see.

---

## API routes (`apps/web/app/api/*`)

- Each route validates its input with Zod (request body, query params).
- Return JSON with consistent shapes; no naked strings.
- Errors return `{ error: { code, message } }` with appropriate HTTP status.
- Never log secrets. Never echo `ANTHROPIC_API_KEY`.
- **Auth-gated routes use `withAuth(handler)`** from `lib/auth-helpers.ts`. That helper authenticates, returns 401 if needed, and sets the AsyncLocalStorage audit context so DB mutations inside the route auto-log. System tasks (cron handlers, scripts) use `withSystemAuditContext({ tenantId }, fn)` from `lib/audit-context.ts`. See [Audit logging](#audit-logging) for the full pattern.

### Routes in MVP

| Route | Method | Purpose |
|---|---|---|
| `/api/jobs/aging` | GET | Aging report with anomaly flags. Query params: `bucket`, `rep`, `region`, `jobType` |
| `/api/jobs/milestones` | GET | Milestone gaps per AR job. Query params: `rep` |
| `/api/jobs/follow-ups` | GET | Heat-scored follow-up queue. Query params: `band`, `rep` |
| `/api/jobs/reconciliation` | GET | "Fell through cracks" list (weekly sweep) |
| `/api/reps/outstanding` | GET | Weekly leaderboard. Query params: `sort`, `region`, `jobType` |
| `/api/chat` | POST | Streams Claude responses via Vercel AI SDK |
| `/api/brief/send` | POST | Generates daily AR brief + PDF, sends via Resend (immediate or `scheduled_at`). Body: `{ to, sendAt? }` |

Every route validates request input with Zod and returns Zod-validated JSON. Dashboard routes read from Postgres at request time via `lib/data.ts` → `merge-view.ts`, which queries the `LiveJob` materialized view (deduplicated, indexed columns — AR filter and write-offs filter are partial-index lookups, ~1 ms). The `@vera/domain` transforms (`toARJob`, `toWriteOffRecord`, heat score, anomalies, reconciliation) run in Node on the filtered set. Same domain code paths the legacy `scripts/preprocess.ts` used, so JSON-path and DB-path produce equivalent results.

---

## Environment variables

| Var | Where | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | server only | Never expose. Lives in Vercel project settings + `.env.local`. |
| `OPENAI_API_KEY` | server only | Used by `/api/chat` until the Anthropic migration. |
| `RESEND_API_KEY` | server only | Used by `/api/brief/send` and `/api/follow-ups/send`. Without it, the routes return 503. Domain is verified — emails are sent from `EMAIL_FROM` (default `Vera <onboarding@resend.dev>`; production uses the verified Priority Roofs domain). No recipient restrictions. |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | server only | GCP Cloud SQL `vera_prod` at `34.56.121.151:5432`. Stored in Vercel as **Sensitive** — the dashboard "Reveal" button is greyed out and `vercel env pull` returns an empty string. Recovery copy lives in `.env.prod` (see below). |
| `NEXT_PUBLIC_*` | client OK | Reserved for genuinely public values; avoid for now. |

`.env.local` (local dev) and `.env.prod` (production recovery) are both gitignored. `.env.example` is checked in with empty values.

### Production environment — single source of truth + recovery

The **deployed runtime reads its env from Vercel.** Vercel is authoritative for production. Local processes never connect to prod env vars.

But Vercel's "Sensitive" env type is write-only — once saved, you cannot read the value back through the dashboard, the CLI (`vercel env pull` returns empty), or the API. Anything that looks like a credential (`DATABASE_URL`, `AUTH_SECRET`, `GOOGLE_CLIENT_SECRET`, signing keys, API tokens) ends up Sensitive. If we ever lose those values — project recreated, vendor lockout, migration — Vercel cannot restore them for us.

`/.env.prod` is the **manual recovery copy**. It mirrors every production env var, gitignored and vercelignored. **Not used at runtime by any process.** Its only job is to make Vercel's Sensitive lockout recoverable.

**Hard rules for `.env.prod`:**

1. **Never commit it.** Listed in `.gitignore` line 26.
2. **Never deploy it.** Listed in `.vercelignore`.
3. **When you change a prod env var in the Vercel dashboard, update `.env.prod` in the same sitting.** The two surfaces drift = the recovery copy is worthless.
4. **Not used at build/runtime.** Nothing reads it. Vercel deploys read from Vercel runtime env; local dev reads from `apps/web/.env.local`. The `.env.prod` file is for human-led recovery only.
5. **Treat it like the password manager entry it effectively is.** Don't paste contents into chat, don't share over Slack, don't cat it in CI logs. If you need to inspect, `grep` for the specific key.

**Recovery flow if Vercel loses an env var (or the project is recreated):**

```bash
# Restore everything from .env.prod to Vercel production env:
while IFS='=' read -r KEY VAL; do
  [[ -z "$KEY" || "$KEY" =~ ^# ]] && continue
  # strip surrounding quotes if present
  VAL="${VAL%\"}"; VAL="${VAL#\"}"
  printf '%s' "$VAL" | vercel env add "$KEY" production
done < .env.prod
vercel --prod --yes
```

**When migrating a credential** (new DB password, rotated API key, etc.) the sequence is: update `.env.prod` → update Vercel dashboard → update local `apps/web/.env.local` if dev uses the same value → redeploy.

Stale env vars (the old Neon `POSTGRES_*` / `PG*` / `NEON_PROJECT_ID` set from the Vercel Marketplace Neon integration before the GCP cutover) have been removed from Vercel as of 2026-05-14. If you see a stale credential reappear, the integration may have been re-installed — check **Vercel → Project → Integrations**.

---

## Testing — Playwright

### Required coverage

Every route under `/dashboard/*` and `/` has at least one spec at `tests/e2e/<module>.spec.ts`. The chat side panel has its own spec.

### What each spec must cover

1. **Render** — page loads without errors, key elements visible.
2. **Interaction** — at least one user action (filter, sort, click) works as expected.
3. **Data correctness** — at least one assertion against the data shown matches a known fixture value.

### Fixture

A deterministic snapshot of `generated.json` lives at `tests/fixtures/generated.fixture.json`. Tests load the app pointing at this fixture (via env var or a test mode). This means tests don't depend on the real preprocess output.

### AI in tests

`/api/chat` is mocked in CI (returns a canned streaming response). One smoke test runs against the real API in local dev only, gated behind `RUN_LIVE_AI=1`.

`/api/brief/send` is mocked in CI (Resend SDK is not called for real). One smoke test runs against the real Resend API in local dev only, gated behind `RUN_LIVE_EMAIL=1`. Without `RESEND_API_KEY` set, the live test skips automatically.

### Commands

```
pnpm test:e2e              # full headless suite
pnpm test:e2e:ui           # interactive Playwright UI
pnpm test:e2e -- aging     # single spec
```

### Failing tests block merges

If you change a module, run its spec. If it fails, fix the spec or the code — don't disable.

---

## Git & commits

- **Author identity (mandatory).** This repo is owned by the
  `adityauphade-mac` GitHub user. Every commit must be authored by:
  - **Name:** `adityauphade-mac`
  - **Email:** `adityauphade@makanalytics.org`

  Before committing in a fresh worktree or environment, verify with:
  ```bash
  git config user.name   # must print: adityauphade-mac
  git config user.email  # must print: adityauphade@makanalytics.org
  ```
  If either is wrong (e.g. shows `aditya.uphade@levich.co`), fix locally:
  ```bash
  git config user.name "adityauphade-mac"
  git config user.email "adityauphade@makanalytics.org"
  ```
  The `levich.co` identity belongs to a different account and must NEVER
  appear as commit author on this repo.

- Branch names: `feat/<short>`, `fix/<short>`, `chore/<short>`.
- Commit messages: short imperative ("add aging bucket logic"). No emojis. No "Co-Authored-By" unless explicitly asked.
- Each commit should leave the repo in a building, type-checking, lint-clean state.
- Pre-commit hook runs lint + typecheck + format.
- PRs must include any new Playwright specs for new routes.

---

## When in doubt

1. **Re-read `SPEC.md` and `DISCUSSION.md`** — most ambiguities are answered there.
2. **Default to the simplest thing that satisfies the spec.** This is an MVP, not a platform.
3. **Surface the assumption in the UI** rather than hiding it. Tooltip + question number from SPEC.md.
4. **Ask before adding a new dependency.** The pinned stack is intentional.
5. **Ask before touching shared data sources.** `data/jobs_dedup.jsonl` is read-only and dormant. `vera_prod` (GCP) is production — never run destructive SQL without explicit user ACK. `vera_dev` (local) has been seeded with production-shape data — the Playwright guard now refuses to wipe it, but anything you write yourself should be equally cautious.

---

## Out of scope reminders

These are explicitly NOT in the MVP — don't sneak them in:

- Per-rep authentication / logins
- Real outbound email sending
- QuickBooks integration
- Trend analysis (monthly task #7)
- Departed rep audits (monthly task #8)
- End-of-month close (monthly task #9)
- Database / persistence
- Editing data inside Vera (Vera is read-only — RoofLink is source of truth)
- Mobile-optimized layouts (desktop dashboard first)
