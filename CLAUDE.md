# CLAUDE.md — Project Constitution

This file is the source of truth for how code is written in this repository. Every Claude session reads this first. If any instruction here conflicts with a one-off user request, ask before deviating.

---

## Project context

**What this is.** An MVP of "Vera Calloway," an AI Accounts Receivable specialist for a roofing company (Priority Roofs). The brief, the five focused requirements, and all 19 product decisions are documented in `SPEC.md` and `DISCUSSION.md`. Read those before writing code.

**Architecture.** Monorepo (pnpm workspaces + Turborepo), one Next.js 16 app, all shared code in `shared/`, deployed to Vercel. Full architecture in `docs/ARCHITECTURE.md`.

**You are read-only on the source data.** `data/jobs_dedup.jsonl` is never modified. Derived artifacts (`data/generated.json`) are gitignored — they regenerate on build.

---

## Hard rules — never violate

1. **No `any` in TypeScript.** If a type is unclear, infer it from the data, define it in `shared/types`, or use `unknown` and narrow.
2. **No business logic in components.** Components consume; `shared/domain/*` computes. Heat score, aging, anomaly detection — all in `shared/domain/`.
3. **No fetching the raw 188 MB JSONL at runtime.** The browser only ever sees `generated.json`.
4. **Outbound email only via the audited send pipeline.** All sends go through `apps/web/lib/email.ts` → Resend. Every send requires explicit user action and a confirmation step in the UI. Audit trail lives in the Resend dashboard until V2 introduces in-app history. Follow-up "drafts" remain copy-to-clipboard / `mailto:` until they're migrated to the same pipeline. Supersedes Q9 of the original spec — see `DISCUSSION.md` §6.7.
5. **No autosend without explicit human intent.** Scheduled sends use Resend's `scheduled_at` field — they require a user to compose, preview, and confirm a specific email targeted at a specific time. No recurring cron-triggered sends in MVP. No DB writes (the reserved Neon slot remains reserved for V2). No destructive mutations of any kind.
6. **No new top-level packages without updating this file.** Tech stack is pinned (see below).
7. **Every new route gets a Playwright spec before it merges.** No exceptions.
8. **Every default behavior must be visible in the UI** (tooltip / footnote) so users can spot and challenge it. Per the SPEC.md philosophy.
9. **The Neon DB is shared between local dev and production — there is no staging DB.** Migrations applied locally are instantly live in prod. Treat any script that `DELETE`s or `UPDATE`s more than a single row as production-data-loss-in-the-making, and get explicit user ACK before running it. Read-only queries don't need ACK.
10. **Server (DB) is the source of truth for UI state.** Fetch from the DB on mount; `localStorage` is only a draft buffer for unsaved form input. Never trust the local cached value to match what the cron worker, another tab, or another user is seeing.
11. **No native browser dialogs, no inline transient banners.** `window.alert()`, `window.confirm()`, and `window.prompt()` are forbidden — they look broken, can't be styled, and can't be tested without intercepting `page.on('dialog')`. Use `useConfirm()` from `@vera/ui` for confirmations and `toast()` from `@vera/ui` (sonner-backed) for success/error/loading feedback. Transient status (sent / saved / paused / cancel-confirmation / API error) goes through toasts, NOT inline `<div>` banners inside the page. Persistent state (a card's "last run failed" history line) stays on-page because it's informational, not transient. Long-running operations (backfill runs, multi-second jobs) use a persistent `toast.loading()` with a stable id and update-in-place — the toast IS the progress UI, no separate progress bar on the page. If you find yourself reaching for `setError` + a conditionally-rendered red div, that's a toast.
    - **Modal flavors** — two patterns, share visual chrome (centered, `bg-bg-card`, `rounded-[var(--radius-card)]`, `p-7`, `shadow-2xl`) but differ in title typography and use case:
      - **`<Modal>` — content surface, no icon.** Big `font-display text-2xl` title, body owns the layout. Use for chat (Ask Vera), info dialogs, custom forms.
      - **`<ConfirmDialog>` + `useConfirm()` — action confirmation, with icon.** Title rendered in **uppercase eyebrow typography** (`text-[0.78rem] tracking-[0.18em] uppercase`) — **imperative, not a question**: "Cancel this run", not "Cancel this run?". Description is the body, left-aligned to the modal edge. Right-aligned button row: `secondary` cancel + `primary`/`destructive` confirm. Use whenever the user must pick between two paths.
    - **Toast icons** — five distinct silhouettes (circle / octagon / triangle / rounded square / arc) so info ≠ error even ignoring color. Info uses the `--color-info` slate-blue token — the one cool tone in the otherwise warm palette.

12. **User-facing strings never expose internal identifiers.** No `rooflink_lineitems` in an email subject; the user reads "Rooflink estimate line items". Snake_case, kebab-case, and camelCase belong in code, not in copy. Maintain a friendly-label map alongside any enum.

13. **Shared UI primitives live in `@vera/ui`, not in page files.** If you're about to write a small headless component (tabs, modal, dropdown) inline in a page, stop and add it to `shared/ui/src/components/` first, then import from `@vera/ui`. Page-local one-offs accumulate into N copies of slightly different tab buttons. The design system page at `/design` is the inventory of what already exists — check there before adding anything new.

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
- **Keep active worktrees minimal.** One per in-flight piece of work. Remove with `git worktree remove <path>` when the work merges. Don't let them accumulate — every worktree duplicates gitignored data (notably the 187 MB `data/jobs_dedup.jsonl`) and adds deploy footguns.
- **Bootstrap a fresh worktree with `scripts/setup-worktree.sh <path>`.** It copies the gitignored-but-required files (`apps/web/.env.local`, `data/jobs_dedup.jsonl`, `data/generated.json`) from the canonical main repo, runs `pnpm install`, and runs `prisma generate`. Doing this by hand has cost us time twice — don't.
- **Never deploy from a worktree.** Worktrees carry their own copies of gitignored data, and `vercel --prod` from one will upload the wrong tree (we hit Vercel's 100 MB single-file limit because of this). Deploy from `/Users/aditya-levich/Build/israil_mvp` only.

---

## Shipping a change

- **Vercel git auto-deploy is not working today** — the Vercel team is owned by the `hexabytecode` GitHub account, the repo is owned by `adityauphade-mac`, and Vercel can't see this namespace. Pushes to `main` do not trigger a deploy. After merging to `main`, run `vercel --prod --yes` from the canonical main repo root every time. (Once the identity mismatch is resolved, this becomes automatic — see memory S1620 for the full diagnosis.)
- **Modifying `.github/workflows/*` needs the `workflow` OAuth scope** which the default `gh` and OAuth tokens here don't have. You'll get a misleading 404 on the Contents API or a workflow-scope rejection from `git push`. Two paths: use the GitHub web UI (your browser session has full owner permissions) for one-off edits, or refresh CLI access once with `gh auth refresh -h github.com -s workflow`.
- **One commit, one logical change.** Bundling a refactor with an infrastructure migration in the same PR (we did this with PR #13) works but makes review harder. Default to separate PRs unless the changes are inseparable.

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

## API routes (`apps/web/app/api/*`)

- Each route validates its input with Zod (request body, query params).
- Return JSON with consistent shapes; no naked strings.
- Errors return `{ error: { code, message } }` with appropriate HTTP status.
- Never log secrets. Never echo `ANTHROPIC_API_KEY`.

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

Every route validates request input with Zod and returns Zod-validated JSON. No route reads `jobs_dedup.jsonl` directly — only the cached `generated.json`. All filtering/aggregation delegates to `shared/domain/*` so behavior matches the build-time preprocess.

---

## Environment variables

| Var | Where | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | server only | Never expose. Lives in Vercel project settings + `.env.local`. |
| `OPENAI_API_KEY` | server only | Used by `/api/chat` until the Anthropic migration. |
| `RESEND_API_KEY` | server only | Used by `/api/brief/send`. Without it, the route returns 503. Domain verification still pending — dev uses `onboarding@resend.dev` and can only send to the Resend account holder's email. |
| `NEXT_PUBLIC_*` | client OK | Reserved for genuinely public values; avoid for now. |

`.env.local` is gitignored. `.env.example` is checked in with empty values.

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
5. **Ask before touching `data/jobs_dedup.jsonl`.** It's read-only.

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
