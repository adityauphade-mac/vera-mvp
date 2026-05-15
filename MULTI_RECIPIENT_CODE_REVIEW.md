# Multi-recipient & follow-up email — code review

**Scope:** the change set introduced by `0cdedd0 feat: multi-recipient notifications + audited follow-up email send` (≈1,400 lines across 28 files). Typecheck is clean; no `any` regressions; the audit-log integration is wired correctly per CLAUDE.md.

Items below are everything that struck me as worth fixing or flagging, ranked by impact. None are blockers; the change can stay deployed while these get addressed.

---

## C-1. `DraftEmailButton.tsx` hand-rolls a modal — rule #13 violation

**What.** [apps/web/app/dashboard/follow-ups/DraftEmailButton.tsx:132-277](apps/web/app/dashboard/follow-ups/DraftEmailButton.tsx:132) implements its own modal from scratch: portal, Escape handler, backdrop click, body scroll lock, aria attributes. All of that is already in [shared/ui/src/components/Modal.tsx](shared/ui/src/components/Modal.tsx).

**Why it matters.** CLAUDE.md rule #13 is explicit — *"shared UI primitives live in `@vera/ui`, not in page files."* The repo has the primitive; this file ignores it. Side effect: the hand-rolled modal **skips** the `vera-modal-in`/`vera-modal-out` exit animations that every other modal uses, so closing this one feels harsher than the rest of the app.

**Fix.** Replace lines 132-277 with `<Modal open={open} onOpenChange={…} widthClass="max-w-2xl">{header + body + footer}</Modal>`. The two-mode body layout (preview / compose) is just children. ~100 lines deleted, animation parity restored.

---

## C-2. Recipient summary inconsistent across four send routes

**What.** Four routes write audit-log `summary` strings that include the recipient list. They disagree on how to summarise:

| Surface | Behaviour with 2 recipients |
|---|---|
| `apps/web/app/api/schedules/[cadence]/route.ts` `summarizeRecipients()` | `"a@x.com, b@y.com"` (full list up to 3) |
| `apps/web/app/api/brief/send/route.ts:219` | `"2 recipients"` |
| `apps/web/app/api/follow-ups/send/route.ts:116` | `"2 recipients"` |
| `apps/web/app/api/cron/dispatch-briefs/route.ts:177` | `"2 recipients"` |

**Why it matters.** The audit-log table reader sees different fidelity depending on which route fired the row. The full list always lands in `details`, so this is summary-only — but the value of the summary is "you can skim the table without opening rows", and that breaks when one row says emails and another says a count.

**Fix.** Lift `summarizeRecipients` from `schedules/[cadence]/route.ts` into `apps/web/lib/audit.ts` (or a sibling helper) and call it from all four. ~30 lines.

---

## C-3. Backfill notifications now share a single `To:` header (behaviour change)

**What.** [apps/web/lib/backfill/tick-worker.ts](apps/web/lib/backfill/tick-worker.ts) previously looped `users.map(u => u.email)` and sent **N separate emails**, one per recipient. Post-multi-recipient, it sends **one** email with `to: recipients` — all configured recipients see each other on the `To:` line.

**Why it matters.** For an internal team that's fine and probably intentional. For a hypothetical future case where "team A and team B both got configured against the same source," they'd now see each other on the To: line where they didn't before. It's the kind of change that doesn't bite until someone notices.

**Fix.** Document the change in `docs/RELEASE.md` under the 2026-05-14 multi-recipient entry, OR change the send to use the recipients as `bcc:` instead of `to:` and put the tenant's own address in `to:`. Either is fine; doing nothing is also fine, as long as you make the choice consciously.

---

## C-4. `brief/send/route.ts` audit row mixes Resend id with SendLog id semantics

**What.** [apps/web/app/api/brief/send/route.ts:249-250](apps/web/app/api/brief/send/route.ts:249) writes:

```ts
entityType: 'SendLog',
entityId: result.id,
```

But `result.id` is the **Resend** message id, not a `SendLog` row id — this route doesn't insert a `SendLog` at all. The cron path correctly inserts one and uses `sendLog.id` (the DB PK): [apps/web/app/api/cron/dispatch-briefs/route.ts:160](apps/web/app/api/cron/dispatch-briefs/route.ts:160).

**Why it matters.** An audit-log reader who clicks through expects `entityId` to be a `SendLog` PK they can look up. From this route they get a Resend opaque id with no row in the DB to join against. Same category, two different `entityId` semantics depending on which route fired the row.

**Fix.** Insert a `SendLog` row in `brief/send/route.ts` (mirroring the cron path) and use its PK. Bonus: `SendLog` then becomes a unified inventory of all sends — manual `Send Now` plus scheduled. The cron and manual paths already write very similar audit detail; aligning them simplifies downstream analytics.

---

## C-5. `snapTo15Min` silently rewrites user input — rule #8 violation

**What.** [apps/web/app/api/schedules/[cadence]/route.ts:62-73](apps/web/app/api/schedules/[cadence]/route.ts:62) snaps the user-supplied time to a 15-minute grid (because the cron dispatcher wakes every 5 min, so off-grid times would fire late). If a user types `07:08`, the server saves `07:15` and the response carries the snapped value — but **nothing tells the user the snap happened.**

**Why it matters.** CLAUDE.md rule #8: *"every default behavior must be visible in the UI."* A schedule that says "Daily 07:15" when the user typed `07:08` is a small surprise that erodes trust in the rest of the UI.

**Fix.** Either:
- (a) Reject non-grid input in the Zod schema with a 400 + inline error explaining the 15-min granularity.
- (b) Accept + snap, but include a `snappedFrom` field in the response that the UI surfaces as a one-shot toast: *"Time snapped to 07:15 — schedule grid is 15 minutes."*

(b) is gentler; (a) is more honest. Either works.

---

## What's solid in this change

So you know what NOT to second-guess:

- The audit catalog is updated cleanly: `follow_up` category added with `sent` / `send_failed`, `humanizeAction` entries present, `FollowUpBody` renderer added in the detail sheet. CLAUDE.md "every new mutation surface in the audit log" rule is satisfied.
- `EmailChipInput` is well-designed: paste splitting, validation, dedup, accessibility, max-recipients counter visible (per rule #8).
- `tick-worker`'s `resolveSyncRecipients` correctly emits an explicit audit row when a sync wants to notify but has no configured recipients — that gap is now visible instead of silent.
- Schema migration is genuinely non-destructive (ADD column, UPDATE old → new, DROP old).
- `dispatch-briefs` cron defensively handles `recipients.length === 0` even though the API forbids it — good for stale rows from before the migration.

---

## Suggested rollout

Group as **two** small PRs:

1. **C-1** alone — pure refactor, no behavior change. Easy review.
2. **C-2 + C-4 + C-5** — audit / UX cleanups. C-3 is a docs-only addition that can ride along.

Total: ~150 lines added, ~120 deleted, no schema changes.
