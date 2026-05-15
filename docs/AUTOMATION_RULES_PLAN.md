# Implementation Plan — RHF Standardization + Automation Rules

**Status:** Plan-only. Not yet implemented.
**Authored:** 2026-05-15
**Scope:** Two tracks that ship together to deliver the automation-rules feature on a standardized form stack.

---

## Overview

The end-goal is rule-based email automation for the AR dashboard: rules authored under `/dashboard/scheduler?tab=automation` that watch numeric AR metrics for state transitions and propose emails for human approval before sending.

CLAUDE.md mandates **React Hook Form + Zod for every form-bearing component**, but the codebase currently uses `useState` + manual validation in three places. We're fixing that drift now rather than building a brand-new form (the automation rule builder) on the wrong stack and creating a fourth pattern to migrate later.

**Two tracks, with explicit dependencies:**

- **Track A — RHF standardization** (4 phases). Adds shadcn form primitives, migrates the three real forms in the app (`DraftEmailButton`, `SchedulerView`, `DataSyncSection`), each with Playwright coverage. `AuditLogsView` is not a form — it's filter UI driven by nuqs URL state — so it stays.
- **Track B — Automation rules feature** (7 phases). Schema, evaluator, tick-worker hook, API surface, rule-builder UI (RHF from day one), pending-queue UI, Playwright + release notes.

**Track B depends on Track A finishing through A-3.** A-3 (the `SchedulerView` migration) does the nuqs `?tab=` refactor and adds an empty `automation` tab placeholder, so B-5 only needs to fill in the placeholder — no second rewrite of `SchedulerView`. A-4 (`DataSyncSection`) can run in parallel with Track B work after A-3 lands.

```
A-0 (reference) → A-1 (primitives) → A-2 (DraftEmail) → A-3 (Scheduler + nuqs)
                                                            ├── A-4 (DataSync)  ──┐
                                                            │                     │
                                                            └── B-1 → B-2 → B-3 → B-4 → B-5 → B-6 → B-7
```

---

## Track A — React Hook Form standardization

### Phase A-0 — Reference (shadcn form + RHF + Zod)

**Installed packages** (confirmed via discovery):

- `react-hook-form@^7.54.2`
- `@hookform/resolvers@^3.10.0`
- `zod@^3.24.1`
- `nuqs@^2.2.3` (already used in [FollowUpsView.tsx:29](apps/web/app/dashboard/follow-ups/FollowUpsView.tsx:29))

**Not yet installed:** shadcn `Form` / `FormField` / `FormItem` / `FormLabel` / `FormControl` / `FormMessage` primitives. They live in the shadcn registry under `form`. They need to land in `shared/ui/src/components/form.tsx` so the monorepo's `@vera/ui` exports them.

**Existing email validation reference:**
- The `/api/follow-ups/send` route validates input with a Zod schema at [apps/web/app/api/follow-ups/send/route.ts:24-34](apps/web/app/api/follow-ups/send/route.ts:24). Track A will lift this client-side as a shared schema in `shared/types`.
- Email chip input component: `EmailChipInput` (used by DraftEmailButton and SchedulerView). Already accepts `value` / `onChange` / `invalid` props — compatible with RHF's `Controller`.

**RHF pattern reference** (the shape every Track A phase will produce):

```tsx
'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@vera/ui';
import { z } from 'zod';

const schema = z.object({
  subject: z.string().min(1, 'Subject required'),
  to: z.array(z.string().email()).min(1, 'At least one recipient'),
});
type Values = z.infer<typeof schema>;

export function MyForm({ initial, onSubmit }: { initial: Values; onSubmit: (v: Values) => Promise<void> }) {
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: initial });
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="subject"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Subject</FormLabel>
              <FormControl><input {...field} className="..." /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {/* … */}
        <button type="submit" disabled={form.formState.isSubmitting}>Save</button>
      </form>
    </Form>
  );
}
```

**Anti-patterns to enforce in every A-* phase:**

- Do **not** mix `useState` field state with RHF — pick RHF or step out of the form pattern entirely.
- Do **not** call `form.setValue` on every keystroke just to mirror state to a parent; lift the schema or use `Controller` instead.
- Do **not** reach for `react-hook-form` in non-form contexts (filter URL state, in-place toggles). Those keep using `useState` or `useQueryState`.
- Do **not** put Zod schemas in the route file *and* duplicate them client-side. Put one canonical schema in `shared/types/src/forms/` and import it from both ends.

---

### Phase A-1 — Install form primitives + shared schema directory

**Goal.** Land the shadcn `Form` primitives in `@vera/ui` so every following phase can `import { Form, FormField, ... } from '@vera/ui'`. Create the home for shared form schemas.

**Files to create:**
- `shared/ui/src/components/form.tsx` — copied from the shadcn registry, adapted to the existing `@vera/ui` import paths (replace any `@/lib/utils` import with the package's existing `cn` helper).
- `shared/ui/src/index.ts` — re-export the new primitives (`Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormDescription`, `FormMessage`, plus the `useFormField` hook).
- `shared/types/src/forms/index.ts` — barrel file for shared form schemas; empty for now, populated by A-2 onward.
- `shared/types/src/forms/email.ts` — reusable `emailListSchema` matching the route's validation. Lift from [apps/web/app/api/follow-ups/send/route.ts:24-34](apps/web/app/api/follow-ups/send/route.ts:24).

**Implementation notes:**

- The shadcn CLI may not install cleanly to `shared/ui` in this monorepo layout. If `npx shadcn@latest add form` fails, copy the canonical primitive source from the shadcn docs site directly into `shared/ui/src/components/form.tsx`. Either way, the destination is `shared/ui`, **not** `apps/web/components`.
- Inside `form.tsx`, replace any `@/lib/utils` `cn` import with `@vera/ui`'s existing utility (find it via `rg "export.*function cn" shared/ui/src`).
- Show no example in the design page (`/design`) yet — design-system additions come in A-2 when we have a real consumer to demo with.

**Verification:**
- `pnpm typecheck` clean.
- A trivial smoke: in a scratch tsx file (do not commit), import `Form` and `FormField` from `@vera/ui` and confirm they render. Delete the scratch file.

**Anti-patterns:**
- Don't put `form.tsx` in `apps/web/components/`. The design system lives in `shared/ui` (CLAUDE.md rule #13).
- Don't expose `useFormField` outside the package as a public API entry; it's there for the primitives to use internally.

---

### Phase A-2 — Migrate DraftEmailButton

**Goal.** Smallest of the three forms, validates the pattern end-to-end before tackling the giants. After this phase, `apps/web/app/dashboard/follow-ups/DraftEmailButton.tsx` uses RHF + zodResolver and has a Playwright spec covering both happy and validation-error paths.

**Files to edit:**
- `apps/web/app/dashboard/follow-ups/DraftEmailButton.tsx` — replace `useState` field state with `useForm`. Wrap the compose-mode body in `<Form>` / `<form onSubmit={form.handleSubmit(onSend)}>`. Replace `canSend` derivation with `form.formState.isValid && !form.formState.isSubmitting`.
- `shared/types/src/forms/email.ts` — extend with `draftEmailSchema` (to / cc / subject / body, all with Zod validation).

**Schema** (canonical, used by client + server):

```ts
export const draftEmailSchema = z.object({
  to: z.array(z.string().email()).min(1, { message: 'At least one recipient required' }),
  cc: z.array(z.string().email()),
  subject: z.string().min(1, { message: 'Subject required' }).max(998),
  body: z.string().min(1, { message: 'Body required' }),
});
export type DraftEmailValues = z.infer<typeof draftEmailSchema>;
```

The existing route's Zod schema at [apps/web/app/api/follow-ups/send/route.ts:24](apps/web/app/api/follow-ups/send/route.ts:24) should be replaced with an import from this shared module. **Same schema both ends** — that's the whole point of the shared file.

**Implementation notes:**

- `EmailChipInput` already accepts `value` / `onChange` props. Wrap with RHF `Controller`:
  ```tsx
  <FormField control={form.control} name="to" render={({ field }) => (
    <FormItem>
      <FormLabel>To</FormLabel>
      <FormControl><EmailChipInput value={field.value} onChange={field.onChange} invalid={!!form.formState.errors.to} /></FormControl>
      <FormMessage />
    </FormItem>
  )} />
  ```
- Keep the modal portal + two-mode (preview/compose) toggle. Only the compose mode's form internals change.
- Preserve the `useConfirm()` before-send dialog at [DraftEmailButton.tsx:90](apps/web/app/dashboard/follow-ups/DraftEmailButton.tsx:90).
- On submit success, reset the form with `form.reset()` so the modal opens fresh next time.

**Verification:**
- `pnpm typecheck` clean.
- Update `tests/e2e/follow-ups.spec.ts` (or create if missing) with cases for:
  - Submit with empty subject → inline error rendered via `<FormMessage />`, no API call.
  - Submit with invalid CC email → inline error, no API call.
  - Happy path → API called, audit row written.
- `pnpm test:e2e -- follow-ups` passes.

**Anti-patterns:**
- Don't write field-specific error states (`setSubjectError`, etc.) — RHF + `<FormMessage />` handles it.
- Don't validate manually before `handleSubmit`. Trust the resolver.
- Don't drop the `useConfirm()` step. It's defensive and explicit-intent matters for outbound mail (CLAUDE.md rule #4).

---

### Phase A-3 — Migrate SchedulerView (+ nuqs tab refactor + automation tab stub)

**Goal.** Three intertwined changes in one phase, because they all touch `apps/web/app/dashboard/scheduler/SchedulerView.tsx` and doing them sequentially would mean rewriting the same regions twice:
1. Convert per-schedule form blocks (daily / weekly / monthly + highlights) from `useState` to RHF.
2. Swap local tab state for `useQueryState` with enum `['report', 'sync', 'automation']`, default `'report'`.
3. Render an empty `<div>` placeholder for the `automation` tab. Track B's Phase B-5 fills it in.

**Files to edit:**
- `apps/web/app/dashboard/scheduler/SchedulerView.tsx` — full rewrite.
- `shared/types/src/forms/schedule.ts` — new shared schema for daily/weekly/monthly schedule editing.
- `apps/web/app/api/schedules/[cadence]/route.ts` — replace inline `PutBodySchema` with import from the shared file.

**Schema** (one per cadence, plus a discriminated union):

```ts
const baseSchedule = z.object({
  timeLocal: z.string().regex(/^\d{2}:\d{2}$/),
  recipients: z.array(z.string().email()).min(1).max(6),
  enabled: z.boolean(),
});
export const dailyScheduleSchema = baseSchedule;
export const weeklyScheduleSchema = baseSchedule.extend({ dayOfWeek: z.number().int().min(0).max(6) });
export const monthlyScheduleSchema = baseSchedule.extend({ dayOfMonth: z.union([z.literal('last'), z.string().regex(/^\d{1,2}$/)]) });
```

**Implementation notes:**

- Each cadence section gets its own `useForm` instance. Three forms on the page is fine — they save independently.
- Highlight toggles are not form fields in the traditional sense (single switch each); keep them as their existing UI but route the value through `form.control` for the cadence they belong to, OR keep them as direct `useState` if they aren't tied to a save action. **Decision criterion:** is there a Save button that submits highlight state to an API? If yes, RHF. If no (saves on toggle), keep `useState`. Verify against the current behavior before deciding.
- `useQueryState` setup at the top of the component:
  ```tsx
  const [tab, setTab] = useQueryState(
    'tab',
    parseAsStringEnum<'report' | 'sync' | 'automation'>(['report', 'sync', 'automation']).withDefault('report'),
  );
  ```
- localStorage `STORAGE_KEY = 'vera-scheduler-v2'` (line 92) can stay — it's a draft buffer for unsaved form state across refreshes. RHF + localStorage coexist via `form.reset(loaded)` in a `useEffect`.

**Verification:**
- `pnpm typecheck` clean.
- `tests/e2e/scheduler.spec.ts` updated:
  - Validation: invalid email in recipients → inline error, save button disabled.
  - Tab URL: `?tab=sync` lands on data sync, refresh preserves.
  - `?tab=automation` renders the empty placeholder without crashing.
- Manual smoke against local `vera_dev`: edit daily schedule recipients, save, refresh — values persist (server is the source of truth per CLAUDE.md rule #10).

**Anti-patterns:**
- Don't bundle DataSyncSection's migration here. It's its own phase (A-4). This phase only touches `SchedulerView.tsx`.
- Don't put RHF schemas in the route file. Shared file, both ends.
- Don't use localStorage as the source of truth for what's currently scheduled. Always fetch on mount, then hydrate `form.reset(serverValues)` (CLAUDE.md rule #10).

---

### Phase A-4 — Migrate DataSyncSection

**Goal.** The biggest form in the codebase (~1,098 lines, two parallel source configs). After this phase the codebase has zero `useState`-driven forms.

**Files to edit:**
- `apps/web/app/dashboard/scheduler/DataSyncSection.tsx` — full rewrite.
- `shared/types/src/forms/backfill-schedule.ts` — new shared schema. Identical structure to the schedule schemas from A-3, plus `source: z.enum(['rooflink_jobs', 'rooflink_lineitems'])`.
- `apps/web/app/api/backfills/[source]/schedule/route.ts` — replace inline schema with shared import.

**Implementation notes:**

- Two sources = two `useForm` instances. Keep them independent — saving one shouldn't affect the other.
- Active-run polling state stays as `useState`. It's not form state; it's a live data subscription.
- Toast coordination (`toast.loading` for in-flight runs, success/error on completion) stays as-is. The "Save schedule" submit is the only thing that becomes a form-submit.
- "Run now" button is an out-of-form action — keep it as a plain `<button onClick={...}>` outside the `<form>` tag. It's not a schedule mutation.

**Verification:**
- `pnpm typecheck` clean.
- `tests/e2e/scheduler.spec.ts` (or a new `data-sync.spec.ts`) covers:
  - Invalid time format in `rooflink_jobs` → inline error.
  - Saving valid schedule for one source doesn't dirty the other source's form.
  - "Run now" button still works after the migration.
- Grep for `useState` in `apps/web/app/dashboard/scheduler/` should only return non-form state (mounted flags, modal open flags, polling state).

**Anti-patterns:**
- Don't merge the two source forms into one. They're independent records with independent save endpoints.
- Don't try to share form instance between SchedulerView (A-3) and DataSyncSection (A-4). They live in different tabs; co-mounting would just couple them needlessly.

---

## Track B — Automation rules feature

### Phase B-0 — Reference

Everything from Track A-0 plus the following:

**Audit logging** — `recordAudit` at [apps/web/lib/audit.ts:144](apps/web/lib/audit.ts:144), `RecordAuditInput` at [audit.ts:89](apps/web/lib/audit.ts:89), `AUDIT_CATEGORIES` at [shared/types/src/audit.ts:16](shared/types/src/audit.ts:16), `withAuth` at [auth-helpers.ts:35](apps/web/lib/auth-helpers.ts:35), `withSystemAuditContext` at [audit-context.ts:53](apps/web/lib/audit-context.ts:53), `withSuppressedAutoAudit` at [audit-context.ts:82](apps/web/lib/audit-context.ts:82), `toPlainSummary` at [audit.ts:121](apps/web/lib/audit.ts:121). `AuditDetailSheet` dispatcher at [AuditLogsView.tsx:567](apps/web/app/dashboard/audit-logs/AuditLogsView.tsx:567); pattern after `FollowUpBody` at line 578.

**Schema + migrations** — `apps/web/prisma/schema.prisma`. `Schedule` model at line 51, `BackfillSchedule` at line 178, `BackfillRun` at line 219, `SendLog` at line 82. Migrations in `apps/web/prisma/migrations/`, naming `YYYYMMDDHHMMSS_snake_case`.

**Tick worker hook point** — `runTick` at [tick-worker.ts:68](apps/web/lib/backfill/tick-worker.ts:68); `promote()` at line 409; hook point ~line 446 (after promote, before cache invalidation at 458). `tenantId` lives on `BackfillRun.tenantId`.

**Email pipeline** — `sendEmail` at [apps/web/lib/email.ts:38](apps/web/lib/email.ts:38). Returns `{ ok, id, scheduledAt }` or `{ ok: false, reason, message }`. `SendLog` at [schema.prisma:82](apps/web/prisma/schema.prisma:82) — `toEmails String[]`, `status: 'sent' | 'failed' | 'cancelled'`. Call sites: `/api/brief/send/route.ts:217`, `/api/follow-ups/send/route.ts:109`.

**Route skeleton** — [apps/web/app/api/schedules/[cadence]/route.ts:89](apps/web/app/api/schedules/[cadence]/route.ts:89). `withAuth → parse Zod → withSuppressedAutoAudit → mutate → recordAudit → respond`.

**Data source** — `getData(tenantId)` at [apps/web/lib/data.ts:31](apps/web/lib/data.ts:31). Returns the full AR working set including computed `heatScore`, `daysPastTerms`, `balance`, `rep`. ARJob shape at [shared/types/src/index.ts:145](shared/types/src/index.ts:145). **Metric enum → ARJob field map**: `aging_days → daysPastTerms`, `balance → balance`, `heat_score → heatScore`. Rep shape (rep.email nullable) at [shared/types/src/index.ts:137](shared/types/src/index.ts:137).

**UI** — `useConfirm()` example at [DraftEmailButton.tsx:40](apps/web/app/dashboard/follow-ups/DraftEmailButton.tsx:40) (post-A-2 migration this will be alongside RHF usage). `toast` example at [DraftEmailButton.tsx:72](apps/web/app/dashboard/follow-ups/DraftEmailButton.tsx:72). Modal portal at [DraftEmailButton.tsx:132](apps/web/app/dashboard/follow-ups/DraftEmailButton.tsx:132). **RHF + Zod skeleton: see Phase A-0.**

**Anti-patterns** —
- Do not add `AutomationRule` to `AUDITABLE_MODELS`. The set is intentionally empty; this feature uses explicit `recordAudit`.
- Do not use `window.alert/confirm/prompt`.
- Do not introduce `useState`-driven forms in the new UI. RHF + Zod, no exceptions — Track A normalized the codebase.
- Do not `new Date()` inside `shared/domain/*`. Pass `now` in.
- Do not deploy from this worktree. Canonical repo only.

---

### Phase B-1 — Schema, audit catalog, decision doc

**Goal.** Land the database schema and audit category catalog. No application code changes that touch the new tables yet.

**Files to edit / create:**
- `apps/web/prisma/schema.prisma` — append three models.
- `apps/web/prisma/migrations/<timestamp>_add_automation_rules/migration.sql` — generated by `pnpm prisma migrate dev --name add_automation_rules` from the canonical repo.
- `shared/types/src/audit.ts` — extend `AUDIT_CATEGORIES`, `AUDIT_ACTIONS_BY_CATEGORY`, `ACTION_LABELS`.
- `docs/DISCUSSION.md` — append "§7 Automation rules" capturing the planning decisions (operators chosen + why, recipient model, Pattern B rationale, RHF standardization triggered by this work).

**Schema** (append to `schema.prisma`):

```prisma
model AutomationRule {
  id                Int       @id @default(autoincrement())
  tenantId          Int
  name              String
  metric            String    // 'aging_days' | 'balance' | 'heat_score'
  operator          String    // 'crosses_above' | 'crosses_below' | 'stays_above_for_n_days'
  threshold         Float
  thresholdDays     Int?      // only used when operator = 'stays_above_for_n_days'
  recipientMode     String    // 'assigned_rep' | 'fixed_email'
  recipientEmail    String?   // populated when recipientMode = 'fixed_email'
  subjectTemplate   String
  bodyTemplate      String
  dailySendCap      Int       @default(25)
  enabled           Boolean   @default(true)
  lastEvaluatedAt   DateTime?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  createdById       Int?

  tenant            Tenant                @relation(fields: [tenantId], references: [id])
  evaluationStates  RuleEvaluationState[]
  pendingSends      PendingRuleSend[]

  @@index([tenantId, enabled])
}

model RuleEvaluationState {
  id                 Int       @id @default(autoincrement())
  ruleId             Int
  jobId              Int
  lastMetricValue    Float?
  wasAboveThreshold  Boolean   @default(false)
  streakStartedAt    DateTime?
  lastFiredAt        DateTime?
  lastEvaluatedAt    DateTime

  rule               AutomationRule @relation(fields: [ruleId], references: [id], onDelete: Cascade)

  @@unique([ruleId, jobId])
  @@index([ruleId])
}

model PendingRuleSend {
  id                Int       @id @default(autoincrement())
  tenantId          Int
  ruleId            Int
  jobId             Int
  triggerSnapshot   Json
  proposedRecipient String?
  proposedSubject   String
  proposedBody      String
  status            String    @default("pending") // 'pending' | 'approved' | 'rejected' | 'sent' | 'expired' | 'missing_recipient' | 'pending_send_failed'
  reviewedById      Int?
  reviewedAt        DateTime?
  rejectionReason   String?
  sendLogId         Int?
  expiresAt         DateTime
  createdAt         DateTime  @default(now())

  tenant            Tenant         @relation(fields: [tenantId], references: [id])
  rule              AutomationRule @relation(fields: [ruleId], references: [id], onDelete: Cascade)

  @@index([tenantId, status, createdAt])
  @@index([ruleId])
}
```

Append back-relations on `Tenant`: `automationRules AutomationRule[]` and `pendingRuleSends PendingRuleSend[]`.

**Audit catalog** — add `'automation_rules'` to `AUDIT_CATEGORIES`. Add actions: `['created', 'updated', 'deleted', 'enabled', 'disabled', 'evaluated', 'pending_approved', 'pending_rejected', 'pending_expired', 'pending_send_failed']`. Add `ACTION_LABELS` entries for each.

**Verification:**
- `pnpm prisma format && pnpm prisma validate` clean.
- Migration generated from canonical repo, applied to local `vera_dev`. **Do not apply to `vera_prod`** until B-7 ships.
- `pnpm typecheck` clean.

**Anti-patterns:**
- Don't generate migrations from the worktree (CLAUDE.md worktree rules).
- Don't add new models to `AUDITABLE_MODELS`.

---

### Phase B-2 — Pure evaluator in `shared/domain`

**Goal.** Pure function in `shared/domain/src/automation-rules.ts` that takes rules + jobs + prior states + `now` and returns the new states + fires. Zero I/O, deterministic.

**Public API:**

```ts
export type Metric = 'aging_days' | 'balance' | 'heat_score';
export type Operator = 'crosses_above' | 'crosses_below' | 'stays_above_for_n_days';

export interface EvaluableRule { id: number; metric: Metric; operator: Operator; threshold: number; thresholdDays: number | null; }
export interface EvaluableJob { id: number; daysPastTerms: number; balance: number; heatScore: number; }
export interface PriorState { ruleId: number; jobId: number; wasAboveThreshold: boolean; streakStartedAt: Date | null; lastFiredAt: Date | null; }
export interface RuleFire { ruleId: number; jobId: number; metricValueAtFire: number; reason: 'crossed_above' | 'crossed_below' | 'stayed_above_for_days'; }
export interface NewState { ruleId: number; jobId: number; lastMetricValue: number; wasAboveThreshold: boolean; streakStartedAt: Date | null; lastFiredAt: Date | null; }

export function evaluateAutomationRules(args: {
  rules: EvaluableRule[];
  jobs: EvaluableJob[];
  priorStates: PriorState[];
  now: Date;
  bootstrap?: boolean;
}): { fires: RuleFire[]; newStates: NewState[] };
```

**Semantics:**

- Map metric to job field. Compute `currentlyAbove = metricValue >= threshold`.
- Prior state default when absent: `{ wasAboveThreshold: false, streakStartedAt: null, lastFiredAt: null }` — **except in bootstrap mode**, where the snapshot reflects current state with no fire.
- `crosses_above`: fire iff `!prior.wasAboveThreshold && currentlyAbove && !bootstrap`.
- `crosses_below`: fire iff `prior.wasAboveThreshold && !currentlyAbove && !bootstrap`.
- `stays_above_for_n_days`: fire iff `currentlyAbove && streakStartedAt !== null && (now - streakStartedAt) >= thresholdDays days && (lastFiredAt == null || (now - lastFiredAt) >= thresholdDays days)`. Default `thresholdDays=7` if null.
- Update `streakStartedAt`: set to `now` on transition to above, null on transition to below, kept otherwise.
- Update `lastFiredAt` to `now` iff fire emitted.
- Always emit a `NewState` per (rule, job) evaluated, fire or no.

**Verification:**
- `pnpm typecheck` clean.
- No commits of unit tests (CLAUDE.md MVP testing scope is Playwright E2E only). Scratch-test in REPL if useful; do not commit.

**Anti-patterns:**
- No `new Date()` inside the function.
- No DB access. No `fetch`.
- No React imports.

---

### Phase B-3 — Tick-worker hook + DB-side wrapper

**Goal.** DB-aware wrapper around the pure evaluator. Hook into backfill promotion.

**Files to create / edit:**
- Create `apps/web/lib/automation/evaluator.ts`.
- Edit `apps/web/lib/backfill/tick-worker.ts` — add hook after `promote()`.

**Wrapper API:**

```ts
export async function evaluateRulesForTenant(args: {
  tenantId: number;
  trigger: 'sync' | 'manual' | 'bootstrap';
  ruleIds?: number[];
  now?: Date;
}): Promise<{ rulesEvaluated: number; firesCreated: number; pendingSendsCreated: number }>;
```

**Flow:**

1. Load enabled `AutomationRule` rows for the tenant (filtered by `ruleIds` when bootstrap).
2. Call `getData(tenantId)`. Project to `EvaluableJob[]`.
3. Load prior `RuleEvaluationState` for involved (rule, job) pairs.
4. Call `evaluateAutomationRules(...)`.
5. In `db.$transaction`:
   - Upsert `RuleEvaluationState` rows from `newStates`.
   - For each `RuleFire`: look up rule, render templates via `{{placeholder}}` substitution against `{ job, rule, rep, metric }`, resolve recipient (assigned_rep email or fixed), apply per-rule daily send cap (count pending+sent rows in last 24h; skip if exceeded, summarize skip in audit), insert `PendingRuleSend` with `expiresAt = now + 7 days`.
     - If `recipientMode='assigned_rep'` and `job.rep?.email == null`: insert with `status='missing_recipient'`, `proposedRecipient=null`.
   - Update each rule's `lastEvaluatedAt = now`.
6. Emit `recordAudit({ category: 'automation_rules', action: 'evaluated', summary: "Rule '<name>' fired N times" })` per rule that fired.

**Tick-worker hook** at `apps/web/lib/backfill/tick-worker.ts` after `promote()` returns (around line 446):

```ts
try {
  await withSystemAuditContext({ tenantId: run.tenantId }, () =>
    evaluateRulesForTenant({ tenantId: run.tenantId, trigger: 'sync' }),
  );
} catch (err) {
  console.error('[automation] evaluation failed', { runId, err });
}
```

**Verification:**
- `pnpm typecheck` clean.
- Trigger a backfill on local `vera_dev` with one test rule. Confirm `RuleEvaluationState` rows + `PendingRuleSend` rows + audit row.
- Crashing the evaluator (force-throw) does not roll back the promoted backfill.

**Anti-patterns:**
- No email sends from this layer. Sends happen only when the user approves in Phase B-5/B-6.
- Always wrap in `withSystemAuditContext` from cron paths.

---

### Phase B-4 — API routes

**Goal.** REST surface for rule CRUD + manual eval + pending approve/reject.

**Files to create:**
- `apps/web/app/api/automation-rules/route.ts` — `GET` list, `POST` create (creates rule + runs bootstrap eval).
- `apps/web/app/api/automation-rules/[id]/route.ts` — `GET`, `PUT`, `DELETE`.
- `apps/web/app/api/automation-rules/[id]/preview/route.ts` — `POST` dry-run.
- `apps/web/app/api/automation-rules/evaluate-now/route.ts` — `POST` manual trigger.
- `apps/web/app/api/automation-rules/pending/route.ts` — `GET` list with `?status=`.
- `apps/web/app/api/automation-rules/pending/[id]/approve/route.ts` — `POST`.
- `apps/web/app/api/automation-rules/pending/[id]/reject/route.ts` — `POST`.

**Shared Zod schemas** in `shared/types/src/forms/automation-rule.ts` — imported by both client (RHF resolver in B-5) and server (API validation):

```ts
export const automationRuleSchema = z.object({
  name: z.string().min(1).max(80),
  metric: z.enum(['aging_days', 'balance', 'heat_score']),
  operator: z.enum(['crosses_above', 'crosses_below', 'stays_above_for_n_days']),
  threshold: z.number(),
  thresholdDays: z.number().int().positive().nullable(),
  recipientMode: z.enum(['assigned_rep', 'fixed_email']),
  recipientEmail: z.string().email().nullable(),
  subjectTemplate: z.string().min(1).max(200),
  bodyTemplate: z.string().min(1),
  dailySendCap: z.number().int().positive().default(25),
  enabled: z.boolean().default(true),
}).refine((v) => v.operator !== 'stays_above_for_n_days' || v.thresholdDays !== null, {
  message: 'thresholdDays required for stays_above_for_n_days',
  path: ['thresholdDays'],
}).refine((v) => v.recipientMode !== 'fixed_email' || v.recipientEmail !== null, {
  message: 'recipientEmail required when recipientMode = fixed_email',
  path: ['recipientEmail'],
});
```

**Approve flow** (the critical one):
1. Load row; 404 / 403 / 400 as appropriate.
2. If `status='missing_recipient'`, require recipient override in request body.
3. `sendEmail(...)`.
4. Success: create `SendLog` with `cadence='automation'`, mark `status='sent'`, store `sendLogId` + `reviewedById` + `reviewedAt`.
5. Failure: mark `status='pending_send_failed'`.
6. `recordAudit({ action: 'pending_approved' | 'pending_send_failed', ... })`.

**Verification:**
- `pnpm typecheck` clean.
- Curl each endpoint against local dev.

**Anti-patterns:**
- No direct send from evaluator. Approve is the only path to send.
- All outbound mail through `sendEmail` (CLAUDE.md rule #4).

---

### Phase B-5 — Rule builder UI (RHF from day one)

**Goal.** Fill in the `automation` tab placeholder that A-3 left in `SchedulerView`. Authoring, listing, enabling/disabling, deleting. Dry-run preview. Daily-sync warning banner. **All forms are RHF + zodResolver from the first commit — no `useState` form fields.**

**Files to create:**
- `apps/web/app/dashboard/scheduler/AutomationTab.tsx` — tab content for `?tab=automation`.
- `apps/web/app/dashboard/scheduler/AutomationRuleCard.tsx` — one rule's card.
- `apps/web/app/dashboard/scheduler/AutomationRuleModal.tsx` — create/edit modal (mimic [DraftEmailButton.tsx:132](apps/web/app/dashboard/follow-ups/DraftEmailButton.tsx:132) for the modal chrome, but RHF for the form).
- `apps/web/app/dashboard/scheduler/AutomationTabSkeleton.tsx` — CLAUDE.md skeleton-first.

**Files to edit:**
- `apps/web/app/dashboard/scheduler/SchedulerView.tsx` — replace the empty placeholder rendered when `tab === 'automation'` (from A-3) with `<AutomationTab />`.

**Tab layout:**
1. Warning banner if no enabled daily `BackfillSchedule` — deep links to `?tab=sync`.
2. Header row: title + "Evaluate now" button.
3. Rule list of `AutomationRuleCard` (name + enabled toggle + condition summary + recipient + last-evaluated relative time with stale-badge if >36h + Edit/Delete).
4. Empty state.

**Modal flow** — RHF with `automationRuleSchema` from B-4. Form structure:

```tsx
const form = useForm<AutomationRuleValues>({
  resolver: zodResolver(automationRuleSchema),
  defaultValues: initial ?? { name: '', metric: 'heat_score', operator: 'crosses_above', threshold: 80, thresholdDays: null, recipientMode: 'assigned_rep', recipientEmail: null, subjectTemplate: '', bodyTemplate: '', dailySendCap: 25, enabled: true },
});

// Conditional field visibility via watch
const operator = form.watch('operator');
const recipientMode = form.watch('recipientMode');
```

- `<FormField name="thresholdDays" ...>` rendered only when `operator === 'stays_above_for_n_days'`.
- `<FormField name="recipientEmail" ...>` rendered only when `recipientMode === 'fixed_email'`.
- **Dry-run preview button** above the Save button: calls `POST /api/automation-rules/[id]/preview` (or unsaved-rule equivalent), shows "If this rule existed now, it would match N jobs: …".
- Save: `form.handleSubmit(async (values) => { await fetch('/api/automation-rules', { method: 'POST', body: JSON.stringify(values) }); toast.success(...); })`.

**Verification:**
- `pnpm typecheck` clean.
- Manual: create a rule with `heat_score crosses_above 80`, fixed email = your address. Baseline snapshot taken, no immediate fires. Edit threshold to 30, save, "Evaluate now" → multiple pending sends. Warning banner shows/hides correctly based on `BackfillSchedule` state.

**Anti-patterns:**
- No `useState` for form fields. Everything through RHF.
- No `window.confirm` for delete. Use `useConfirm()`.
- No inline error banners — RHF + `<FormMessage />` handle field errors; submit errors via `toast.error`.

---

### Phase B-6 — Pending queue UI + AuditDetailSheet renderer

**Goal.** Approve/reject UX inside the automation tab. New audit-log detail renderer for the new category. **RHF used for the inline recipient-override edit and the reject-reason textarea where they appear.**

**Files to create:**
- `apps/web/app/dashboard/scheduler/AutomationPendingQueue.tsx`.
- `apps/web/app/dashboard/scheduler/AutomationPendingCard.tsx`.
- `apps/web/app/dashboard/scheduler/RejectReasonForm.tsx` — RHF + Zod for the optional reason input (3-line component).
- `apps/web/app/dashboard/scheduler/MissingRecipientForm.tsx` — RHF + Zod for the inline email-override input (3-line component).

**Files to edit:**
- `apps/web/app/dashboard/scheduler/AutomationTab.tsx` — add `<AutomationPendingQueue />` sub-section below the rules list.
- `apps/web/app/dashboard/audit-logs/AuditLogsView.tsx` — add `AutomationRulesBody` renderer in the per-category dispatch at line 567. Pattern after `FollowUpBody` at line 578.

**Approve flow:**
1. Click Approve → `useConfirm` dialog "Send this email to <recipient>?".
2. `POST /api/automation-rules/pending/<id>/approve`.
3. `toast.loading` (stable id) → `toast.success` on success, `toast.error` on failure.

**Reject flow:**
1. Click Reject → modal containing `RejectReasonForm` (single textarea, optional, max 200 chars, RHF + Zod).
2. Submit → `POST .../reject` with the reason.

**Missing-recipient flow:**
1. Card renders inline `MissingRecipientForm` (single email field, required, RHF + Zod).
2. Submitting the form sets the override, then enables the Approve button which posts both the override and the approve action.

**AuditDetailSheet renderer** (`AutomationRulesBody`):
- Shows rule name, action, metric/operator/threshold, fire reason, affected job IDs (for `evaluated`), recipient + subject preview (for `pending_approved` / `pending_rejected`), error message (for `pending_send_failed`).
- Render rejection reason if present.

**Verification:**
- `pnpm typecheck` clean.
- Manual: trigger rule → pending row → approve → toast success → audit log shows `pending_approved`. Reject with reason → audit log shows `pending_rejected` with reason. Missing-recipient row → fill inline → approve works.

**Anti-patterns:**
- No bulk approve in v1.
- No aggressive polling.

---

### Phase B-7 — Playwright + release notes

**Goal.** Coverage + release log entry. Per CLAUDE.md rule #14, the RELEASE.md entry lands **before** `vercel --prod --yes`.

**Files to create:**
- `tests/e2e/automation-rules.spec.ts` — full spec.

**Files to edit:**
- `docs/RELEASE.md` — new entry at the top.

**Spec coverage:**
1. Create rule with dry-run preview, save success, appears in list.
2. Bootstrap suppresses initial fires on rule create.
3. Manual "Evaluate now" creates pending sends.
4. Approve flow sends, audit row written, toast success.
5. Reject flow with reason, audit row carries reason.
6. Missing-recipient inline override works end-to-end.
7. Warning banner appears with no daily `BackfillSchedule`; disappears when one is enabled.
8. Tab URL state survives navigation and refresh.
9. RHF validation: empty subject template / invalid email in fixed recipient / missing thresholdDays for `stays_above_for_n_days` operator all render inline `<FormMessage />` errors without hitting the API.

**RELEASE.md entry template:**
```
## YYYY-MM-DD — automation rules + RHF standardization
- Merge: <SHA>
- User-visible: new Automation tab under /dashboard/scheduler. Rules watch aging days / balance / heat score and propose emails on threshold transitions. Sends require human approval from the pending queue. All forms across the app now use React Hook Form + Zod (DraftEmailButton, SchedulerView, DataSyncSection, new automation rule editor).
- DB migration: <id> adds AutomationRule, RuleEvaluationState, PendingRuleSend.
- Rollback: disable rules via the toggle; reject pending sends en masse. Revert migration via SQL drop of the three new tables (no FK cycles outside the tables themselves).
```

**Anti-patterns:**
- Don't deploy from this worktree.
- Don't skip the RELEASE.md entry.

---

## Final verification phase

In order:

1. `pnpm typecheck` clean across all workspaces.
2. `pnpm lint` clean.
3. `pnpm test:e2e` full suite passes locally (includes the new automation-rules spec + updated follow-ups / scheduler / data-sync specs from Track A).
4. Manual smoke against local `vera_dev`:
   - Edit DraftEmailButton form, verify inline RHF errors on bad input.
   - Edit a schedule, verify inline RHF errors on bad input.
   - Create an automation rule, baseline, evaluate-now, approve, reject. All audit rows present in `/dashboard/audit-logs` with category `Automation rules`.
5. Grep checks:
   - `rg "useState.*string.*''" apps/web/app/dashboard/scheduler/` and `apps/web/app/dashboard/follow-ups/` — should not return anything that's clearly form-field state (mounted flags / modal open flags are OK).
   - `rg "from 'react-hook-form'" apps/web/app/dashboard/scheduler/ apps/web/app/dashboard/follow-ups/` — should return imports in every form file.
   - `rg "AUDITABLE_MODELS" apps/web/lib/audit.ts` — confirm the three new tables are NOT listed.
   - `rg "window\.(alert|confirm|prompt)" apps/web/` — must return nothing.
6. RELEASE.md entry written and committed in the same change set as the deploy.
7. Deploy from canonical repo: `vercel --prod --yes`.
8. Production smoke: `/dashboard/scheduler?tab=automation` loads, create a rule, no console errors. `/dashboard/follow-ups` Draft email composer still works. `/dashboard/scheduler?tab=sync` data-sync still works.
9. Confirm `.env.prod` does not need updates (no new env vars added).
