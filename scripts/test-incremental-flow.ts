/**
 * Full-flow test for V2 incremental sync.
 *
 * 1. Trigger a full mock run for rooflink_jobs.
 * 2. Wait for completion.
 * 3. Verify BackfillSchedule.lastSyncedAt advanced.
 * 4. Trigger an incremental run.
 * 5. Verify it fetched FEWER records (the mock fixture has rows with
 *    date_last_edited spread over 60 minutes; the run started after the
 *    full sync, so only the most recent N rows pass the filter).
 * 6. Verify both runs are promoted=true (incremental adds, doesn't replace).
 *
 * Run with `pnpm exec tsx scripts/test-incremental-flow.ts`.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BASE = 'http://localhost:3000';

async function getCookies(): Promise<string> {
  const res = await fetch(`${BASE}/api/dev/login`, { redirect: 'manual' });
  const setCookie = res.headers.get('set-cookie') ?? '';
  // Parse `name=value; Path=...; HttpOnly` → `name=value`
  const match = setCookie.match(/authjs\.session-token=([^;]+)/);
  if (!match) throw new Error('no session cookie returned from /api/dev/login');
  return `authjs.session-token=${match[1]}`;
}

async function waitForRunStatus(
  runId: number,
  terminal: ('completed' | 'failed' | 'canceled')[],
  timeoutMs = 60_000,
): Promise<{ status: string; itemsProcessed: number; mode: string; syncedSince: Date | null }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await prisma.backfillRun.findUnique({ where: { id: runId } });
    if (!run) throw new Error(`run ${runId} not found`);
    if ((terminal as string[]).includes(run.status)) {
      return {
        status: run.status,
        itemsProcessed: run.itemsProcessed,
        mode: run.mode,
        syncedSince: run.syncedSince,
      };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`run ${runId} did not terminate within ${timeoutMs}ms`);
}

async function main(): Promise<void> {
  // Hermetic state.
  await prisma.rawRooflinkJob.deleteMany();
  await prisma.rawRooflinkLineItems.deleteMany();
  await prisma.backfillRun.deleteMany();
  await prisma.backfillSchedule.deleteMany();
  // eslint-disable-next-line no-console
  console.log('[setup] cleared backfill tables');

  const cookie = await getCookies();
  const opts = { headers: { Cookie: cookie, 'Content-Type': 'application/json' } };

  // ── Step 1: trigger full mock run ──────────────────────────────────────
  // eslint-disable-next-line no-console
  console.log('[step 1] triggering full mock run for rooflink_jobs…');
  const r1 = await fetch(`${BASE}/api/backfills/rooflink_jobs/runs`, {
    ...opts,
    method: 'POST',
  });
  if (!r1.ok) throw new Error(`run create failed: ${r1.status} ${await r1.text()}`);
  const j1 = (await r1.json()) as { run: { id: number; mode: string } };
  // eslint-disable-next-line no-console
  console.log(`  → run #${j1.run.id} created · mode=${j1.run.mode}`);
  if (j1.run.mode !== 'full') throw new Error(`expected mode=full, got ${j1.run.mode}`);

  // ── Step 2: wait for completion ─────────────────────────────────────────
  // eslint-disable-next-line no-console
  console.log('[step 2] waiting for full run to complete (mock=60 records, ~30s)…');
  const r1Final = await waitForRunStatus(j1.run.id, ['completed', 'failed'], 60_000);
  // eslint-disable-next-line no-console
  console.log(
    `  → run #${j1.run.id} ${r1Final.status} · ${r1Final.itemsProcessed} items · mode=${r1Final.mode}`,
  );
  if (r1Final.status !== 'completed') throw new Error('full run did not complete');
  if (r1Final.itemsProcessed !== 60) {
    // eslint-disable-next-line no-console
    console.warn(`  WARN: expected 60 mock items, got ${r1Final.itemsProcessed}`);
  }

  // ── Step 3: verify watermark advanced ───────────────────────────────────
  // eslint-disable-next-line no-console
  console.log('[step 3] checking BackfillSchedule.lastSyncedAt…');
  // No schedule row from Run-now, so check the run's startedAt + advance
  // path via the dispatch-side schedule (which doesn't exist). Instead,
  // let's create a schedule first, then run, to test the advance.
  const sched = await prisma.backfillSchedule.create({
    data: {
      tenantId: 1,
      source: 'rooflink_jobs',
      cadence: 'weekly',
      dayOfWeek: 1,
      timeLocal: '03:00',
      timezone: 'America/Chicago',
      enabled: true,
    },
  });
  // eslint-disable-next-line no-console
  console.log(`  → schedule created (lastSyncedAt=null on creation, will be set on next full)`);

  // Trigger ANOTHER full run so the watermark advances on this fresh schedule.
  const r1b = await fetch(`${BASE}/api/backfills/rooflink_jobs/runs?mode=full`, {
    ...opts,
    method: 'POST',
  });
  const j1b = (await r1b.json()) as { run: { id: number; mode: string } };
  await waitForRunStatus(j1b.run.id, ['completed', 'failed'], 60_000);
  const schAfter = await prisma.backfillSchedule.findUnique({ where: { id: sched.id } });
  if (!schAfter?.lastSyncedAt) {
    throw new Error(`watermark did NOT advance after full sync`);
  }
  if (!schAfter.lastFullSyncAt) {
    throw new Error(`lastFullSyncAt did NOT update on full sync`);
  }
  // eslint-disable-next-line no-console
  console.log(
    `  ✓ watermark advanced to ${schAfter.lastSyncedAt.toISOString()} (full=${schAfter.lastFullSyncAt.toISOString()})`,
  );

  // ── Step 4: trigger incremental run ─────────────────────────────────────
  // eslint-disable-next-line no-console
  console.log('[step 4] triggering incremental run (no mode override)…');
  const r2 = await fetch(`${BASE}/api/backfills/rooflink_jobs/runs`, {
    ...opts,
    method: 'POST',
  });
  if (!r2.ok) throw new Error(`incremental run create failed: ${await r2.text()}`);
  const j2 = (await r2.json()) as { run: { id: number; mode: string; syncedSince: string } };
  // eslint-disable-next-line no-console
  console.log(`  → run #${j2.run.id} created · mode=${j2.run.mode} · since=${j2.run.syncedSince}`);
  if (j2.run.mode !== 'incremental') {
    throw new Error(`expected mode=incremental, got ${j2.run.mode}`);
  }
  if (!j2.run.syncedSince) {
    throw new Error('incremental run has null syncedSince');
  }

  // ── Step 5: wait for completion, verify fewer records ───────────────────
  // eslint-disable-next-line no-console
  console.log('[step 5] waiting for incremental run…');
  const r2Final = await waitForRunStatus(j2.run.id, ['completed', 'failed'], 60_000);
  // eslint-disable-next-line no-console
  console.log(
    `  → run #${j2.run.id} ${r2Final.status} · ${r2Final.itemsProcessed} items · mode=${r2Final.mode}`,
  );
  if (r2Final.status !== 'completed') throw new Error('incremental did not complete');
  if (r2Final.itemsProcessed >= 60) {
    throw new Error(
      `incremental fetched too many items: ${r2Final.itemsProcessed} (expected < 60 — mock filter should have trimmed)`,
    );
  }
  // eslint-disable-next-line no-console
  console.log(`  ✓ incremental fetched FEWER items (${r2Final.itemsProcessed} < 60)`);

  // ── Step 6: verify both runs promoted ───────────────────────────────────
  // eslint-disable-next-line no-console
  console.log('[step 6] verifying both runs are promoted=true…');
  const promoted = await prisma.backfillRun.findMany({
    where: { source: 'rooflink_jobs', promoted: true },
    orderBy: { id: 'asc' },
    select: { id: true, mode: true, promoted: true, itemsProcessed: true },
  });
  // eslint-disable-next-line no-console
  console.log(`  promoted runs: ${promoted.map((p) => `#${p.id}(${p.mode}/${p.itemsProcessed})`).join(', ')}`);
  if (promoted.length < 2) {
    throw new Error(
      `expected at least 2 promoted runs (full + incremental), got ${promoted.length}`,
    );
  }
  const hasIncremental = promoted.some((p) => p.mode === 'incremental');
  if (!hasIncremental) {
    throw new Error('incremental run was not promoted — should add, not replace');
  }
  // eslint-disable-next-line no-console
  console.log('  ✓ both full and incremental are promoted (merge view ready)');

  // eslint-disable-next-line no-console
  console.log('\n✅ ALL INCREMENTAL SYNC CHECKS PASSED');

  await prisma.$disconnect();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('\n❌ FAILED:', e instanceof Error ? e.message : e);
  prisma.$disconnect();
  process.exit(1);
});
