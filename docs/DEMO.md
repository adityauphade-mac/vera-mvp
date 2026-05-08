# Vera — Demo script

A 5-minute live walkthrough. Use this as a checklist before the demo and a
narration template during it.

> Last updated: May 8, 2026.

---

## Before the demo (5-min checklist)

- [ ] Production smoke: `curl -s -o /dev/null -w "%{http_code}\n" https://vera-mvp.vercel.app/` returns `200`
- [ ] Sign in once at https://vera-mvp.vercel.app/login (warm the auth cookie + the Vercel function)
- [ ] Click "Fetch latest news" on the dashboard so the AI briefing is in the DB and renders instantly during the demo
- [ ] Scheduler page: optional — clean up any half-baked test schedules from earlier (see [OPERATIONS.md](./OPERATIONS.md))
- [ ] Have a second tab open at https://github.com/adityauphade-mac/vera-mvp/actions in case you want to show a live cron run
- [ ] Have https://resend.com/emails open in a third tab to show the delivery log if email comes up
- [ ] Mute Slack / phone

---

## Demo flow (5 minutes)

### Minute 1 — Landing + sign in (30s)

> **Say:** *"Vera is an AI accounts-receivable specialist. She watches every install, notices when a payment is sitting somewhere it shouldn't, and drafts the follow-ups before you ask. Built for Priority Roofs in Dallas — single tenant today, multi-tenant ready underneath."*

1. Open `https://vera-mvp.vercel.app/`
2. Point out the conditional CTA (anonymous → "Sign in")
3. Click **Sign in**, complete Google OAuth → land on dashboard

### Minute 2 — Today's briefing (60s)

> **Say:** *"Each morning Vera writes a fresh briefing using gpt-4o, weather alerts from the National Weather Service, and roofing-industry news. Bolded keywords are the things to act on. Sources cited at the bottom."*

1. Read the briefing headline aloud (mention the bolded segments — bolding works in markdown)
2. Hover one of the source chips → external link works
3. **Don't** click "Refresh" mid-demo (gpt-4o latency is 8-15s)

### Minute 3 — Aging + JobDetailSheet (60s)

> **Say:** *"Past-terms by aging bucket. The numbers next to each bucket are real — we never count pre-install jobs or payments that have already cleared. Click into any row to see why a job is hot."*

1. Sidebar → **Aging & anomalies**
2. Click the **60+ past** tile or any row in the table
3. JobDetailSheet slides in (smooth exit animation when you press Esc)
4. Point out the **heat score breakdown** — 4 numbers, no black box
5. Press Esc → sheet slides out cleanly

### Minute 4 — Follow-ups + Ask Me (60s)

> **Say:** *"Hot jobs get a draft email Vera writes for the rep. Critical jobs skip the rep and go to the executive review queue. And there's chat — Vera answers anything inside her AR remit."*

1. Sidebar → **Follow-ups**
2. Click any row → draft email modal opens with the email Vera would send
3. Close modal
4. Click **Ask Me** floating button (bottom right)
5. Click a suggested prompt: *"Who's worst this week?"*
6. Vera streams the answer grounded in real data
7. Close panel (smooth exit animation)

### Minute 5 — Scheduler + delivery (90s)

> **Say:** *"Email delivery for the daily AR brief is real. Resend, verified domain. Pick a time, Vera fires the brief automatically every weekday."*

1. Sidebar → **Scheduler**
2. Point out the **amber banner at the top** — *"Automatic dispatch may be delayed"*
3. **Acknowledge the limitation:** *"Recurring auto-fire runs on GitHub Actions cron. New repos sit in a multi-hour onboarding throttle before their first scheduled run picks up. We're inside that window today."*
4. Demo **Send now** instead — fires immediately:
   - Type recipient
   - Click **Send now**
   - Email lands in inbox in ~5 seconds
5. *(Optional)* Show a live manual trigger: in your terminal,
   ```
   gh workflow run cron-dispatch-briefs.yml --repo adityauphade-mac/vera-mvp
   ```
   Then refresh the GitHub Actions tab and watch the run complete in 15s.
   Same code path the auto-cron uses.

---

## Honest caveats — what NOT to claim

| Don't say | Why |
|---|---|
| *"The cron auto-fires every 15 minutes"* | True in theory, blocked today by GitHub onboarding throttle. Use *"will fire automatically once GitHub indexes the workflow, hours to ~24h after the workflow lands"* |
| *"Multi-tenant"* | Schema is multi-tenant, only Priority Roofs is onboarded. Use *"multi-tenant ready, single tenant live"* |
| *"Vera replies to the rep on your behalf"* | She drafts, never sends to reps. Only AR briefs to executives go out as live email. |
| *"RoofLink data is live"* | Data is a snapshot. The live-sync cron is post-demo work. |

---

## Backup plans

| Failure mode | Fallback |
|---|---|
| `Fetch latest news` is slow (gpt-4o throttle) | Don't click it — the existing briefing renders fine. |
| Resend fails to send | Open `https://resend.com/emails` in your spare tab — show today's earlier deliveries as proof the integration works. |
| The auto-cron doesn't fire when you manually trigger it | Manual trigger has worked all day — if it ever doesn't, run `curl -X POST https://vera-mvp.vercel.app/api/cron/dispatch-briefs -H "Authorization: Bearer $CRON_SECRET"` directly. Same outcome. |
| A Vercel deploy broke something | Roll back: `vercel rollback https://vera-i51kgo3rl-aditya-uphades-projects.vercel.app` (the known-good 13:54-IST deploy). |
| Google sign-in fails | Have your already-signed-in browser tab ready. Don't sign in fresh during the demo. |

---

## Closing line (suggested)

> *"What's not built yet: a live RoofLink data sync (the snapshot is manual today) and a more reliable cron trigger than GitHub Actions. Both are tracked in `IMPROVEMENTS.md` — happy to walk through the plan offline."*
