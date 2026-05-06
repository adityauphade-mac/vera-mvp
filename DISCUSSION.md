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

Full detail in `ARCHITECTURE.md`. Engineering rules in `CLAUDE.md`.

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
