# Vera Calloway MVP — Spec & Assumptions

**Brief.** Build an MVP of "Vera," an AI Accounts Receivable specialist for a roofing company (Priority Roofs), based on the persona PDF and the `jobs_dedup.jsonl` export from RoofLink (103,440 records). Focus on the first five of nine assigned tasks: three daily, two weekly. No QuickBooks data is available; everything is inferred from RoofLink.

**Approach.** Hybrid product — a detailed dashboard for the executive, with an AR-scoped chat interface alongside it. Vera surfaces findings, drafts follow-ups, and routes critical issues to an Executive Review Queue.

---

## What counts as AR

A job is "in AR" only if **both**:
- `date_completed` is set (the roof is actually on the house), AND
- `primary_estimate.balance > 0` (money is still owed)

Of 103,440 records, this filter yields **~130 active AR jobs**. Everything else — leads, canvassing attempts, signed-but-not-installed contracts — is out of scope for AR (though some may surface elsewhere as "pipeline watch" in v2).

**Excluded from AR:**
- Jobs where `exclude_from_qb = true` (deliberately not billed)
- Jobs where `warranty_voided = true` are kept visible but tagged

---

## How "overdue" is measured

There is no `invoice_sent_at` field in the data. The clock for AR aging starts at **`date_completed`** (install date). No fallback if install isn't recorded — the job isn't AR.

**Net terms by job type:**
- Retail / cash jobs: **Net 30** from install
- Insurance jobs: **Net 60** from install (depreciation/RCV checks take longer)

Insurance vs. retail is detected via `lead_source` (e.g., "hail max"), `insurance_claim` field presence, or `lead_status` like "Claim Filed."

**Aging buckets are terms-relative**, not arbitrary calendar buckets:

| Bucket | Meaning |
|---|---|
| Within terms | Payment isn't due yet |
| 1–30 past terms | Just slipped overdue |
| 31–60 past terms | Stale — escalation territory |
| 60+ past terms | Stuck — likely needs executive intervention |

Each row also displays raw "days since install" for context.

---

## The five reports

### 1. AR Aging & Anomaly Check (daily)
Aging table grouped into the four terms-relative buckets above. Plus an anomaly panel that flags the following patterns when found:

| # | Anomaly | Why it matters |
|---|---|---|
| 1 | `balance > gt_price` | Math doesn't add up — data error or stale estimate |
| 2 | Installed but no `certificate_of_completion` after 14 days | Blocks the final insurance check |
| 3 | Insurance job, installed 60+ days ago, no `final_check_endorsed` | Depreciation check stuck |
| 4 | Retail job, installed 30+ days ago, `payments = 0` | No customer payment activity |
| 5 | Duplicate addresses with overlapping dates | Possible double-billing or warranty work |
| 6 | Installed but no `commission_request` after 14 days | Rep's tell that something's off |
| 7 | `payments < 0` or `payments > gt_price` | Refund/credit mishandling |
| 8 | `is_archived = true` and `balance > 0` | Zombie estimate — leak risk |
| 9 | `warranty_voided = true` and `balance > 0` | Disputed job, don't chase blindly |

### 2. Job Milestone Tracking (daily)
Cross-references `date_completed` against the milestone trail in `custom_steps`. Each AR job displays which steps are missing as tags (`cert of completion`, `final check`, `commission request`, etc.) — these *are* the milestone gaps. One row per job; insurance ACV/RCV are not tracked as separate aging dimensions because, in our AR working set, the install has already happened, so ACV is almost always already collected.

### 3. Rep Follow-up & Escalation (daily)
Every AR job gets a 0–100 **heat score**:

| Component | Weight | How |
|---|---|---|
| Days past terms | 40% | 0 within terms; capped at 60+ days |
| Balance size | 25% | Log-scaled — $1k ≈ 30%, $10k ≈ 70%, $50k+ ≈ 100% |
| Rep silence | 20% | 0 if any custom_step or edit in last 14 days; 100% if 30+ days quiet |
| Anomaly flags | 15% | Each anomaly adds 33%, capped at 3 |

| Score | Band | Action |
|---|---|---|
| 0–25 | Cool | No action |
| 26–50 | Warm | Visible, no nudge |
| 51–75 | Hot | Vera generates weekly email draft to the rep |
| 76–100 | **Critical** | **Auto-flow to Executive Review Queue** |

**Email behavior:** Vera produces drafts only — never sends. Brandon copies/sends manually. Cadence is flat (same nudge per stale job, weekly). Heat score, not email count, governs escalation.

**Executive recipient:** "Brandon" in the PDF is treated as a placeholder. The MVP routes critical jobs to an abstract **Executive Review Queue** — a tab in the dashboard, not a named individual.

### 4. Rep Outstanding Report (weekly)
Leaderboard grouped by sales rep. Default sort: total outstanding $ descending. Toggleable sorts: count of stuck jobs, oldest job age, average heat score. Filterable by `region` and `job_type`. Output: dashboard tab + "Generate weekly digest" button producing an email draft.

### 5. Unpaid Job Reconciliation (weekly)
Sweeps every completed-but-unpaid job. A job is considered "in the collection pipeline" if **any** of:
- `first_check_endorsed` or `final_check_endorsed` logged in last 30 days
- `certificate_of_completion` logged
- Residential or commercial `commission_request` logged
- `date_last_edited` within last 14 days

Jobs missing **all four** signals are flagged as **"Fell through cracks"** — the report's headline output.

---

## Open questions for Brandon

These are decisions where the requirements were ambiguous and an MVP default was used. Each default is shown alongside the assumption.

| # | Question | MVP default | Source of doubt |
|---|---|---|---|
| 1 | What counts as AR? | `date_completed` set + balance > 0 | Three plausible cuts (any balance / completed only / signed 30+ days ago) yield 2,947 / 130 / 561 jobs |
| 2 | What's the invoice-sent date? | Install date (`date_completed`); no fallback | No `invoice_sent_at` field exists in the data |
| 3 | Net terms? | Net 30 retail / Net 60 insurance, from install | Insurance depreciation has its own timeline; one rule misrepresents one side |
| 4 | Aging bucket boundaries? | Terms-relative: within / 1–30 / 31–60 / 60+ past | Calendar buckets bury on-time insurance jobs as "late" |
| 5 | Which anomalies to flag? | The 9 patterns listed above | No anomaly definition was given in the brief |
| 6 | ACV vs RCV aging? | One row per job, missing-step tags | The data has 6 ACV / 4 RCV records — too sparse to model two clocks |
| 7 | Brandon escalation rule? | Heat score ≥ 76 (transparent components) | No threshold given; binary rules either over- or under-fire |
| 8 | Is "Brandon" a real person? | Treated as placeholder; abstract Executive Queue used | Brandon Roberts the rep ≠ confirmed exec |
| 9 | Email: draft or send? | Draft-only, copy-to-clipboard | Real sending requires infrastructure and risks spamming live reps |
| 10 | Follow-up cadence? | Flat — same template weekly | Heat score, not email count, governs escalation |
| 11 | Departed reps? | All reps assumed active | No `is_active` flag; activity-based inference deferred to v2 |
| 12 | Group dimensions for weekly rep report? | By rep primary; region & job_type as filters | Both fields exist in the data |
| 13 | Rep report sort? | Total $ outstanding desc; toggle to count, age, heat | Multiple useful axes |
| 14 | Distribution? | Dashboard tab + generated digest draft | No SMTP in MVP |
| 15 | "In the collection pipeline" definition? | Any of 4 RoofLink signals; missing all = "Fell through cracks" | No QB; pipeline must be inferred from CRM activity |
| 16 | Write-offs? | Honor `exclude_from_qb` + `warranty_voided` flags | No richer write-off mechanism in MVP |
| 17 | Dashboard for whom? | Brandon-only; no per-rep logins | Auth / per-rep scoping is v2 plumbing |
| 18 | Chat scope? | AR-scoped; Vera deflects off-topic | Focused chat outperforms open-ended one |
| 19 | Time horizon? | All-time AR; "last 12 months" toggle | Old debts are still owed |

---

## Out of scope for MVP

- QuickBooks integration / sync verification (requirement #6 — weekly)
- Trend analysis reports (requirement #7 — monthly)
- Departed rep audits (requirement #8 — monthly)
- End-of-month close (requirement #9 — monthly)
- Per-rep authentication and rep-facing dashboards
- Real outbound email sending
- Editing data inside Vera (Vera is read-only — RoofLink is the source of truth)

---

## Tech stack (summary — full detail in `docs/ARCHITECTURE.md`)

- **Monorepo:** pnpm workspaces + Turborepo. One Next.js 16 app in `apps/web`. All shared code in `shared/` (types, ui, domain logic, utils).
- **Frontend:** Next.js 16 (App Router), TypeScript strict, Tailwind, shadcn/ui, Lucide icons, TanStack Table, Recharts/Tremor, React Hook Form, Zod, nuqs, date-fns.
- **Backend:** Next.js API routes deployed as Vercel Functions. Proper REST-ish endpoints — one per dashboard view (`/api/jobs/aging`, `/api/jobs/milestones`, `/api/jobs/follow-ups`, `/api/jobs/reconciliation`, `/api/reps/outstanding`) plus `/api/chat`. All requests/responses Zod-validated. No database — slot reserved for Postgres if persistence is needed later.
- **AI:** Vercel AI SDK + Claude Sonnet 4.6 (`@ai-sdk/anthropic`) for chat and email drafts.
- **Testing:** Playwright E2E. One spec per module. Required for every route. Mocked AI in CI.
- **Deployment:** Vercel. Build runs the preprocess script that turns the 188 MB JSONL into a ~150 KB JSON.
- **Design theme:** warm fintech — parchment cream backgrounds, terracotta brass accents, muted heat-band colors (sage / mustard / terracotta / muted brick). Inspired by CRED but softer and more personal. Fraunces serif headings + Inter body. Vera's voice is composed and warm — never alarmist.

## Engineering rules (summary — full detail in `CLAUDE.md`)

- TypeScript strict, no `any`.
- Business logic in `shared/domain/*` only — pure functions, dates passed in.
- Forms always use React Hook Form + Zod resolver.
- Every default surfaced in the UI as a tooltip / footnote.
- Every route gets a Playwright spec before it merges.
- Vera is read-only — no DB writes, no real email sends.
