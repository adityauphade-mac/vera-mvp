# Vera Calloway — AR MVP

A demo of an AI accounts receivable specialist for a roofing contractor (Priority Roofs). Built around a static RoofLink export of 103,440 records — Vera quietly filters that down to ~130 jobs that actually owe money, tracks the milestones that matter, and drafts the follow-ups before you ask.

## What's here

| Doc | Why |
|---|---|
| [`SPEC.md`](./SPEC.md) | The flat product spec — what we're building, all 19 default decisions |
| [`DISCUSSION.md`](./DISCUSSION.md) | Narrative log of how each decision was reached |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Monorepo layout, tech stack, data flow, design system |
| [`CLAUDE.md`](./CLAUDE.md) | Engineering rules (the constitution) |
| [`PLAN.md`](./PLAN.md) | The eight-phase build plan, implement → test → ship |

## Run locally

```bash
pnpm install                 # install all workspaces
pnpm preprocess              # 188 MB JSONL → ~150 KB generated.json
pnpm --filter @vera/web dev  # http://localhost:3000
```

To enable the chat panel, drop your Anthropic key in `.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

## Build & test

```bash
pnpm build       # preprocess + Next.js production build
pnpm test:e2e    # Playwright suite — 27 specs across 8 modules
```

Open [`tests/e2e/`](./tests/e2e) — every dashboard route has its own spec.

## Routes

- `/` — landing, with assumptions surfaced for review
- `/dashboard` — Today's Briefing
- `/dashboard/aging` — terms-relative buckets + anomaly side panel
- `/dashboard/milestones` — per-job missing-step tags
- `/dashboard/follow-ups` — heat-scored queue + Executive Review tab
- `/dashboard/rep-report` — leaderboard with sort/filter chips
- `/dashboard/reconciliation` — "fell through cracks" weekly sweep
- `/design` — internal component preview

API:
- `GET /api/jobs/{aging,milestones,follow-ups,reconciliation}`
- `GET /api/reps/outstanding`
- `POST /api/chat`

## What's deliberately out of scope

QuickBooks sync, real outbound email, per-rep logins, monthly rollups (trends, departed-rep audits, end-of-month close), edits back to RoofLink, mobile layouts. Each of those has a clear migration path documented in [`SPEC.md`](./SPEC.md) and [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).
