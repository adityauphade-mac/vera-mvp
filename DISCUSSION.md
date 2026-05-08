# Vera MVP — Discussion Log & Assumptions

A narrative record of how we arrived at each decision. For each open question, this document captures what we asked, what we considered, what we chose, and why. Pair this with `SPEC.md` (which is the final flat spec) when presenting.

---

## 1. The brief, plainly

We were given two artifacts and a one-line directive:

- **A persona PDF** describing "Vera Calloway," an AI Lead AR Intelligence Specialist for a roofing company. The PDF lists nine assigned tasks across daily / weekly / monthly cadences. We were told to focus on the first five (three daily, two weekly).
- **A 188 MB JSONL file** — `jobs_dedup.jsonl` — containing 103,440 records exported from RoofLink, the company's CRM. The company appears to be Priority Roofs based on the email domain.
- **The directive:** open-ended; build the solution we see fit; ignore the code layer; "vibe code as much as possible." The requester is curious where we'd take a project like this.

There is no QuickBooks data and no second file. Everything must be inferred from RoofLink.

---

## 2. What the data actually contains

Before any decisions could be made, we needed to know what we were working with. The funnel:

| Stage | Count | Meaning |
|---|---|---|
| Total records | 103,440 | All leads ever in RoofLink |
| With a sales rep assigned | ~99,000 | Picked up by a rep |
| With an estimate written | ~5,000 | A real bid was created |
| With `date_completed` | 4,336 | Roof was installed |
| With `balance > 0` | 2,947 | Money still owed |
| **Installed AND with balance > 0** | **~130** | **The true AR working set** |

A critical insight emerged: the data is **insurance-driven roofing** (heavy presence of "Claim Filed" status, adjusters' reports, `first_check_endorsed` / `final_check_endorsed` custom steps). Insurance roofing has a specific payment flow: the insurer issues two checks — an ACV (deposit, before install) and an RCV (final, after install + paperwork). The milestone trail in `custom_steps` itself tells the AR story without QuickBooks.

---

## 3. What "AR" means and why we filter

**AR (Accounts Receivable)** is money customers owe that hasn't been collected. Every dollar in AR is a dollar already spent (materials, labor, commissions) but not recovered. AR is cash flow risk — companies can be profitable on paper and still go broke if AR balloons.

We don't filter to hide records. We filter to define **what Vera is looking at every morning.** Without filtering, she'd be looking mostly at door-knock attempts ("Not Home", "Unknown") that aren't AR. That's noise.

---

## 4. The five requirements, restated in plain English

| # | Requirement | Cadence | What it does |
|---|---|---|---|
| 1 | AR Aging & Anomaly Check | Daily | Bucket every unpaid invoice by age; flag what looks wrong |
| 2 | Job Milestone Tracking | Daily | Compare install date to invoicing/payment timeline; catch gaps |
| 3 | Rep Follow-up & Escalation | Daily | Generate follow-ups per rep; escalate to executive when severe |
| 4 | Rep Outstanding Report | Weekly | Rank reps by total outstanding $ (accountability leaderboard) |
| 5 | Unpaid Job Reconciliation | Weekly | Sweep all completed installs; catch the ones nobody is working |

These are not five independent reports. They form one workflow: 1 and 2 are detection; 3 turns findings into action; 4 and 5 are weekly rollups for accountability.

---

## 5. Decisions, by group

Each decision below is what to say if asked "why did you build it that way?"

### Group A — Defining "AR" and "overdue"

**A1. AR working set.**
The question was: do we count any job with `balance > 0`, only completed jobs, or signed-30-days-ago jobs? Each gives a wildly different working set (2,947 / 130 / 561). We chose **only `date_completed` set + balance > 0**. Reasoning: a job that hasn't been installed shouldn't be invoiced, so it isn't AR yet. This is the strictest, cleanest definition.

**A2. Invoice-sent date.**
The data has no `invoice_sent_at` field. Aging needs a clock. We chose **install date (`date_completed`) as the proxy, with no fallback**. If install isn't recorded, the job isn't AR — period. Reasoning: in roofing, invoicing happens on completion. Earlier proxies (job submittal, contract signed) are internal milestones, not customer-facing.

**A3. Net terms.**
Standard B2C is Net 30. Insurance roofing is different — depreciation/RCV checks legitimately take 30–90 days. A single rule misrepresents one side. We chose **Net 30 for retail / cash jobs, Net 60 for insurance jobs**, both measured from install. Insurance is detected via `lead_source`, `insurance_claim` field, or `lead_status`.

**A4. Aging buckets.**
Calendar-based buckets (0–30 / 31–60 / etc.) bury on-time insurance jobs in the "late" buckets and over-pad the on-time ones. We chose **terms-relative buckets**: Within terms / 1–30 past terms / 31–60 past terms / 60+ past terms. A 50-day-old insurance job (Net 60) shows as "Within terms"; a 35-day-old retail job (Net 30) shows as "1–30 past terms."

### Group B — Anomaly definitions

**B5. Which anomalies to flag.**
Aging tells you what's *late*. Anomalies tell you what's *wrong*. We landed on nine patterns Vera will flag:

1. `balance > gt_price` — math doesn't add up
2. Installed but no `certificate_of_completion` after 14 days — blocks insurance final check
3. Insurance job, installed 60+ days ago, no `final_check_endorsed` — depreciation stuck
4. Retail job, installed 30+ days ago, `payments = 0` — no customer payment activity
5. Duplicate addresses with overlapping dates — possible double-billing
6. Installed but no `commission_request` after 14 days — rep's behavioral tell that something's off
7. `payments < 0` or `payments > gt_price` — refund/credit mishandling
8. `is_archived = true` and `balance > 0` — zombie estimate
9. `warranty_voided = true` and `balance > 0` — disputed job, don't chase blindly

We dropped one candidate: "stale signed contract with no install" — that's pipeline leak, not AR leak.

**B6. ACV vs RCV separately?**
For an insurance job with two checks (ACV before install, RCV after), should we model them as two aging rows or one? We chose **one row per job, with missing-step tags**. Reasoning: our AR working set requires `date_completed` to be set, and in practice install rarely starts without ACV in hand — so by the time a job is in AR, only the RCV is typically outstanding. Tags like `cert of completion missing` show *which step is stuck* without doubling the data model.

### Group C — Brandon escalation rules

**C7. Heat score, not threshold rules.**
Binary rules ("escalate if balance > $10k AND past terms") miss obvious cases — a $9,500 job that's 90 days late wouldn't escalate. We chose a **0–100 heat score** combining four explainable components:

| Component | Weight | Logic |
|---|---|---|
| Days past terms | 40% | 0 within terms; capped at 60+ days = full weight |
| Balance size | 25% | Log-scaled — $1k ≈ 30%, $10k ≈ 70%, $50k+ ≈ 100% |
| Rep silence | 20% | 0 if any custom_step or edit in last 14 days; 100% if 30+ days quiet |
| Anomaly flags | 15% | Each anomaly adds 33%, capped at 3 |

Bands: **0–25 Cool**, **26–50 Warm**, **51–75 Hot** (Vera generates a draft to the rep), **76–100 Critical** (auto-flow to Executive Review Queue). Every job displays its score breakdown so escalations are explainable: *"This was flagged because: 32 from days past terms, 18 from balance, 15 from one anomaly = 65, Hot."*

**C8. Brandon is a placeholder.**
The PDF says escalations go to "Brandon," but the data has a sales rep named Brandon Roberts and no confirmed executive. We treat the persona's "Brandon" as **fictional** and route critical jobs to an abstract **Executive Review Queue** — a tab in the dashboard, not a named person. Brandon Roberts is just a regular rep.

### Group D — Rep follow-up mechanics

**D9. Draft-only, never autosend.**
Real sending requires email infrastructure (sending domain, SPF/DKIM, list of confirmed addresses) and risks spamming real reps if a threshold is wrong. We chose **draft-only emails**. Vera writes the message; it appears in the dashboard with copy-to-clipboard / mailto links. Brandon is the human-in-the-loop. Autosend is v2 once tone and rules are trusted.

**D10. Flat cadence.**
Weekly nudges per stale job, same template each time. We initially considered an escalating-tone cadence (gentle → firm → escalation warning) but chose flat because **heat score governs escalation, not email count.** A job that crosses 76 auto-escalates regardless of how many nudges have been sent. Cleaner separation of concerns.

**D11. Departed reps.**
The data has no `is_active` flag. Inferring departure from inactivity is brittle in an MVP. We **assume all reps in the data are active** for now. Departed-rep handling is the monthly task #8, out of scope.

### Group E — Rep Outstanding Report (weekly)

**E12, E13, E14.** Group primarily by sales rep, with `region` and `job_type` available as filters/secondary groupings (both fields are in the data). Default sort: total outstanding $ descending. Toggleable sorts: count of stuck jobs, oldest job age, average heat score. Distribution: dashboard tab + a "Generate weekly digest" button that produces an email-style draft Brandon can copy.

### Group F — Unpaid Job Reconciliation (weekly)

**F15. "In the collection pipeline" definition.**
"Forgotten" isn't a flag in the data. We have to infer it from activity. A job is considered actively in the pipeline if **at least one** of:

- `first_check_endorsed` or `final_check_endorsed` logged in last 30 days
- `certificate_of_completion` logged
- Residential or commercial `commission_request` logged
- `date_last_edited` within last 14 days

A job missing **all four** signals is flagged **"Fell through cracks"** — the report's headline output. Reasoning: each of these is something a human does when working a collection. Their absence is the strongest available abandonment signal short of QuickBooks.

**F16. Write-offs / exclusions.**
We honor two existing flags:

- `exclude_from_qb = true` → drop from AR entirely (deliberately not billed)
- `warranty_voided = true` → keep visible but tag as disputed

No richer write-off mechanism in MVP.

### Group G — Presentation, scope, chat

**G17. Brandon-only dashboard.**
The MVP has one user — the executive. Reps don't log in; they consume Vera through email drafts Brandon sends. Per-rep dashboards are v2 because per-rep authentication is plumbing that doesn't change Vera's intelligence.

**G18. AR-scoped chat.**
The chat panel is paired with the dashboard. Vera answers about jobs, reps, balances, escalations, anomalies, and drafts emails on demand. She politely deflects general business questions ("That's outside my AR remit, but I can show you who's late on payment…"). A focused chat that does AR really well outperforms an open-ended one.

**G19. Time horizon.**
All-time AR by default — old debts are still owed. A "last 12 months" toggle exists for narrower views.

---

## 6. Reference: the calculations Vera performs

These are the exact rules implemented. Use this section to defend any specific number on the dashboard.

### 6.1 AR working set
```
job is in AR if:
  date_completed is not null
  AND primary_estimate.balance > 0
  AND exclude_from_qb is not true
```

### 6.2 Days past terms
```
net_terms = 60 if is_insurance(job) else 30
days_since_install = today - date_completed
days_past_terms = max(0, days_since_install - net_terms)
```

### 6.3 Aging bucket
```
if days_past_terms == 0 -> "Within terms"
elif days_past_terms <= 30 -> "1–30 past terms"
elif days_past_terms <= 60 -> "31–60 past terms"
else -> "60+ past terms"
```

### 6.4 Heat score
```
days_component = min(days_past_terms / 60, 1.0) * 40
dollar_component = log_scaled(balance) * 25
  where log_scaled gives ~0.3 at $1k, ~0.7 at $10k, ~1.0 at $50k+
silence_component = silence_factor * 20
  where silence_factor = 0 if any activity in last 14 days,
                          ramps to 1.0 at 30+ days quiet
anomaly_component = min(anomaly_count, 3) / 3 * 15

heat_score = days_component + dollar_component + silence_component + anomaly_component
heat_band = "Cool" | "Warm" | "Hot" | "Critical" based on score
```

### 6.5 "Fell through cracks" detection
```
job has fallen through cracks if:
  job is in AR
  AND no first_check_endorsed in last 30 days
  AND no final_check_endorsed in last 30 days
  AND no certificate_of_completion logged
  AND no commission_request logged
  AND date_last_edited > 14 days ago
```

---

## 6.5 Architecture decisions (post-spec)

After locking the 19 product questions, we settled the engineering shape:

- **Monorepo** with pnpm workspaces + Turborepo. One Next.js app (`apps/web`); shared code (types, UI, domain logic) lives in `shared/`.
- **There is a backend** — but it's just Next.js API routes deployed as Vercel Functions, not a separate service. Two routes total in MVP: `/api/data` and `/api/chat`.
- **No database in MVP.** The data is static (~130 AR jobs after filtering). Heat scores, anomalies, and aging are computed once at build time. A Postgres slot (Neon via Vercel Marketplace) is reserved for when we need persistence (write-off marks, audit trail).
- **Tech stack pins:** TypeScript strict, Tailwind, shadcn/ui, Lucide, TanStack Table, Tremor charts, React Hook Form + Zod, nuqs for URL state, date-fns, Vercel AI SDK + Claude Sonnet 4.6.
- **Playwright E2E testing per module** is mandatory — every dashboard route gets a spec before it merges. AI calls mocked in CI.
- **Design theme** is a warm reinterpretation of CRED — premium but not cold, intelligent but not overwhelming. Parchment cream backgrounds, terracotta brass accents, muted heat-band colors (sage / mustard / terracotta / muted brick). Fraunces serif headings + Inter body. Vera's voice is composed and warm — she narrates her findings rather than alerting.

Full detail in `docs/ARCHITECTURE.md`. Engineering rules in `CLAUDE.md`.

---

## 6.6 Demo follow-ups (May 5 2026)

Decisions taken in the post-demo review with Israel:

- **Aging defaults to past-terms only.** `/dashboard/aging` auto-applies a `1-30-past + 31-60-past + 60+ past` bucket filter so the daily list isn't drowned out by jobs that aren't due yet. A surfaced banner ("Default · past terms only · View all jobs") lets the user remove the filter; clearing all bucket selections shows the full set.
- **Rep leaderboard period selector exposes MTD and YTD as primary options.** `lastMonth / 30d / 90d / 12m / All-time` remain available; MTD and YTD lead the list per Brandon's framing.
- **Vera personality slot.** A `<VeraAvatar>` is rendered in the chat modal header, the floating FAB, and assistant message bubbles. The asset (`apps/web/public/vera-avatar.png`) is the single drop-in point; until it's provided the component falls back to a stylized "V" mark.

---

## 6.7 Email send policy (May 6 2026 update)

This section supersedes Q9 of the original spec for the daily AR brief workflow. Other email-shaped actions (follow-up drafts on `/dashboard/follow-ups`) remain copy-to-clipboard / `mailto:` until they're explicitly migrated.

**Decision**: lift the no-outbound-email and no-autosend restrictions specifically for the daily AR brief. Sending real email is necessary for the GM workflow Israel asked for in the May 5 demo — drafting in-app and re-pasting into an email client is friction the MVP shouldn't carry.

**Implementation**:
- Outbound delivery via Resend, wrapped in `apps/web/lib/email.ts`.
- One-shot scheduled sends use Resend's `scheduled_at` field — Resend holds the queued email server-side, so no DB is needed for scheduling state.
- A rich PDF report (full job table, anomaly breakdown, top reps, bucket distribution chart) is generated per-send via `@react-pdf/renderer` and attached to the outgoing email. PDF is delivery-only — no in-app download.
- Sending domain in dev: `onboarding@resend.dev` (Resend's restricted sandbox — only sends to the account holder's address). Production sending domain verification is a follow-up.

**Constraints retained**:
- Every send requires explicit user action + a confirmation modal previewing the recipient, content, and timing.
- No recurring cron-driven sends in MVP. Each scheduled send is a discrete user-initiated action.
- No DB writes. Audit trail lives in the Resend dashboard until V2 introduces in-app history.
- Do-not-contact lists, per-rep quotas, and in-app cancellation of scheduled sends are V2 features.

**Rationale**: confirmation gating + Resend's own audit dashboard meet the safety bar without additional infrastructure. The Neon slot reserved in §6 remains reserved — it's the trigger for V2 (in-app audit log, configurable schedule, do-not-contact list).

---

## 6.8 Demo prep (May 6 2026 · today)

Scorecard for today's review with Israel. Everything below is shipped to production at `vera-mvp.vercel.app` as of this morning.

### Directly addressing the May 5 action items

- **Aging filter auto-applies past-terms.** `/dashboard/aging` opens with `1–30 + 31–60 + 60+` selected. A "Default · past terms only · View all jobs" banner reverts to the full set in one click. Filter state lives in the URL via `nuqs` so links/bookmarks round-trip.
- **Vera goes central + gets a face.** Ask Vera moved from a right-side sheet to a centered portal modal with an entrance animation; the floating FAB now pulses to draw attention. `<VeraAvatar>` renders in the modal header, the FAB, and assistant message bubbles, backed by `apps/web/public/vera-avatar.png`. The "Vera is watching · 130 jobs" tagline came out — the avatar carries the persona now.
- **Rep leaderboard live with MTD/YTD primary.** All three metrics Israel asked for — install revenue (`gt_price` sum), commissions, install count — plus four extras (outstanding, oldest past terms, average heat, job count). MTD and YTD lead the period selector; Last month / 30d / 90d / 12m / All-time still available. *Variation:* one sortable table with a metric pill that re-orders, not three side-by-side tables — open question for Israel.
- **Daily / Weekly / Monthly AR briefs (email + PDF).** `/dashboard/scheduler` lets the GM pick recipients and cadences. Each Send-now hits `/api/brief/send` which renders a cadence-specific PDF and ships via Resend. The three briefs differ on cover-page KPIs, headline, and section order — *not* just the subject line.
  - **Daily**: today's snapshot. Standard 4 KPIs, top jobs, anomalies, top reps.
  - **Weekly**: "what just slipped" framing. NEW PAST TERMS / 1-30 BUCKET / HOT+CRIT / REPS OVER $50K KPIs. Adds a "Just slipped past terms this week" card. 8-rep accountability list.
  - **Monthly (covers month-end)**: close-out framing. OPEN AR / PAST TERMS / STUCK ITEMS / FELL-THROUGH KPIs. Adds a **Close-out checklist** card with the GM-facing ask per stuck-item type (insurance final check stuck, no cert of completion, no commission request, retail-no-payment, balance-exceeds-price). 10-rep accountability list.
  - All three PDFs use `wrap={false}` on every cover-page card so titles + column headers never orphan from their data rows. The full job list at the back uses a flat layout with a fixed, repeating column header.

### Bonus shipped — beyond the May 5 list

A lot of polish landed alongside the headline items. Worth calling out individually because each one is independently demoable.

**New top-level routes**
- **`/design`** — full design system documentation page (~900 lines). Every shared/ui component shown in context — MetricTile, Card, AgingChip, HeatMeter, DonutChart, FilterMenu, TablePagination, Tooltip, animations, iconography, color tokens. Replaces the previous `/dashboard/design` so the design system loads with its own chrome and isn't gated by the dashboard.
- **`/docs`** — handbook (~590 lines) covering what Vera is, how AR / payment terms work, the heat-score model, every report, and the surfaced default assumptions. Pulled this content out of the bloated landing page so the landing page can stay marketing.
- **Slimmed landing page** — three clear CTAs (open dashboard / read how Vera works / see design system) plus a tail card and footer of cross-links. Was 500+ lines of mixed marketing/educational copy; now pure marketing.
- **Shared `<PageNav>` scrollspy** — sticky table-of-contents on `/design` and `/docs`, driven by IntersectionObserver. Highlights the section currently in the upper band of the viewport (`aria-current='true'` for testability).

**Table & filter UX (Aging, Milestones, Reconciliation, Rep Leaderboard)**
- **URL-state for everything.** `nuqs` backs reps, regions, missing milestones, page, pageSize, tab, metric, and period. Every report is bookmarkable; refresh preserves state; links can be shared with filters baked in.
- **Integrated pagination** via a new `TableShell` footer slot — pagination sits flush with the table instead of floating below as a separate component.
- **`TablePagination`** — rows-per-page dropdown, smart ellipsis past 5 pages, prev/next, anchored to the table footer.
- **`FilterMenu`** — chip-group filter UI with a searchable rep dropdown rendered via portal (so it escapes overflow-clipped tables). Replaces the previous global search box.
- **MetricTile uniform height** — hint slot is reserved even when empty, so a row of tiles doesn't have one tile shorter than its neighbors.
- **`whitespace-nowrap`** on table headers — multi-word column headers no longer wrap and bloat row height.

**Follow-ups page UX**
- Switched from paginated to **infinite scroll** with an IntersectionObserver sentinel and "Showing X of Y · scroll to load more" hint. Each follow-up card height is locked to `min-h-[200px]` so the list reads as a uniform stack.

**Chrome**
- Sidebar header and dashboard top bar share an `h-[84px]` flex container so their bottom borders sit on the same horizontal line — was previously a noticeable misalignment.
- Sidebar gains a `mt-auto` footer cluster: **"How Vera works"** link to `/docs` and **"Log out"** link to landing. (Log out is symbolic for now — there's no auth, but the affordance is there for when there is.)
- Main content gains `pb-32` so pagination can't collide with the FAB.

**Animations & motion (with prefers-reduced-motion fallbacks)**
- `vera-modal-in` — entrance animation for the centered Ask Vera modal.
- `vera-callout-in` — subtle rise for surface-level callouts.
- `vera-fab-pulse` — continuous pulse on the floating Ask Vera button.
- `vera-rise` / `vera-rise-delay-N` — staggered section entrance on dashboard pages.
- Sheet (job detail drawer) entrance animation.

**Today's polish (the same commit that shipped the email scheduler)**
- **PDF page-break safety**, applied to every cadence's PDF: `wrap={false}` on every cover-page card so titles + column headers never orphan; flat full-job-list layout at the back with a fixed, repeating column header. Fixes a regression where Monthly's Per-rep accountability table had its header stranded on page 1 with bare data rows on page 2.
- **Native `<input type="time">`** time picker — single input, no Hour/Minute/AM-PM dropdowns, OS calendar-picker glyph hidden via `[&::-webkit-calendar-picker-indicator]:hidden`. Replaces a previous 3-Select implementation.
- **DonutChart SSR hydration fix** — the slice `<title>` was emitting three text-node children separated by JSX whitespace, which Next 16 / React 19 flagged as a hydration mismatch and re-rendered on the client. Collapsed to a single template-literal expression so SSR and client emit identical text.

**Data + docs hygiene**
- Preprocess now maps case-insensitive `'unknown'` to `null` so the literal string can never leak into UI labels.
- `DEMO_SCRIPT.md` + `README.md` updated to point at `/design` (was `/dashboard/design`).
- `NEXT_FEATURES.md` captures the Phase 2 backlog distilled after the May 5 demo — most of which has now shipped.

### Open from May 5 — for context only (Israel said these can flex)

- **Quarter-end + year-end review emails** — Q and Y cadences not yet built. Scheduler UI + `/api/brief/send` already accept a `cadence` parameter, so adding them is mostly a content + section-shape question. Holding for explicit go-ahead.
- **Architecture for two ingestion sources (Rooflink + future CRM).** Not yet abstracted. Open question: is the second source a CRM or QuickBooks for payment dates? The shape of the abstraction depends on which fields each source contributes.
- **"Paid in full" date — researched, confirmed not present.** Inspected `data/jobs_dedup.jsonl` (5K+ records sampled). Every payment field is a single sum (`estimate.payments`, `estimate.balance`) — no array of payment events, no `paid_in_full_at`, no `balance_zeroed_at`. The closest proxies are `custom_steps.final_check_endorsed.date_completed` (insurance-only, covers ~2% of paid-in-full jobs), `commission_request.date_completed` (loose proxy, not enforced), and `date_last_edited` (moves on any edit — noisy). **Implication for Trend Analysis (req #7):** speed-of-collection / average-days-to-paid-in-full is not computable from the current export. Two paths forward — (a) ask RoofLink whether there's a payments endpoint exposing `[{job_id, amount, date}, …]`, or (b) Israel's original instinct: pull payment dates from QuickBooks once that integration is on the table.
- **Leaderboard-as-three-tables vs single-table-with-pill** — pending Israel's preference.

### Talking points for today's demo

1. **Land on the slimmed-down landing page.** Show the three CTAs. Click "see design system" to flash the new `/design` route + scrollspy. Flip back. Click "read how Vera works" to flash `/docs`.
2. **Open the dashboard.** Top-to-bottom: Today's briefing → MetricTiles (uniform heights) → Heat distribution donut → Top three. Click the pulsing FAB to show the centered Ask Vera modal + Vera avatar; ask Vera something quick that triggers tool calls.
3. **Walk Aging.** Open `/dashboard/aging` — point at the "Default · past terms only" banner. Apply a rep filter from the FilterMenu (the searchable dropdown is one of the polish wins). Copy the URL, paste it in a new tab — filter state round-trips. Demonstrate pagination at the bottom of the table.
4. **Show Follow-ups infinite scroll.** Scroll the list to trigger the IntersectionObserver — point at the "Showing X of Y" indicator updating.
5. **Walk the Rep Leaderboard.** Switch the metric pill between install revenue → commissions → installs. Switch the period between MTD → YTD. Ask Israel about single-table vs three-table.
6. **Open the Scheduler.** Walk Daily / Weekly / Monthly rows. Mention the preview banner is explicit about recurring storage being preview-only; Send-now is real. Click Send-now on Daily to fire a real email mid-demo. Show the new native time picker in the row config.
7. **Open the three PDFs in the inbox** side-by-side: Daily snapshot → Weekly "what slipped" → Monthly close-out checklist with GM asks. Point at how the layout actually differs (KPIs, headline, sections), not just the subject.
8. **Wrap** by mentioning the open list as a flexible parking lot — Q+Y emails, dual-source architecture, paid-in-full research, leaderboard layout. Israel drives priority.

### Production checklist (verified before this section was written)

- [x] All 10 routes return 200 (landing, /design, /docs, /dashboard, /dashboard/aging, /dashboard/follow-ups, /dashboard/milestones, /dashboard/reconciliation, /dashboard/rep-leaderboard, /dashboard/scheduler).
- [x] All 6 GET API endpoints return data; `POST /api/chat` streams tool-calling correctly (Vera correctly identified the highest-heat job).
- [x] `POST /api/brief/send` ships all three cadences from production via Resend.
- [x] Vercel env vars in production: `OPENAI_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`.

---

## 7. Out of scope (explicitly)

- QuickBooks integration / sync verification (requirement #6)
- Trend analysis reports (requirement #7)
- Departed rep audits (requirement #8)
- End-of-month close (requirement #9)
- Per-rep authentication and rep-facing dashboards
- Real outbound email sending
- Any data writes back to RoofLink — Vera is read-only

---

## 8. FAQ likely to come up in presentation

**"Why only ~130 jobs in AR when there are 103,000 records?"**
Most records are leads and door-knock attempts that never converted. The strict AR rule (installed + balance owed) intentionally narrows the focus to actually-owed money.

**"Why heat score and not a simple dollar threshold?"**
A $9,500 job that's 90 days late should escalate. A $15,000 job that's 5 days late shouldn't. Single-axis thresholds either over-fire or under-fire. The heat score combines four components transparently and shows its work.

**"Why can't Vera send emails?"**
Real sending touches real people. One wrong threshold spams 30 salespeople. The MVP keeps a human in the loop until the rules are trusted; autosend is a v2 graduation.

**"How do you detect anomalies without rules from Brandon?"**
We surface the patterns we *can* detect from the data and let Brandon tune them. Each anomaly rule can be toggled on/off in the UI.

**"What if Brandon disagrees with a default?"**
Every default is visible in the UI as a tooltip/footnote (e.g., "Net 60 used for insurance — adjust here"). Defaults are designed to be challenged on first read, not buried.
