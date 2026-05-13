/**
 * Sends three preview variants of the post-sync email to a fixed recipient
 * so the user can eyeball the format end-to-end before this lands in prod.
 *
 *   1. Empty incremental — no records touched, no PDF attached.
 *   2. Small incremental — 5 records, single-page PDF.
 *   3. Large full sync   — 200 records (the PDF cap), multi-page PDF.
 *
 * The email body is constructed exactly the same way as `notifySuccess` in
 * `apps/web/lib/backfill/tick-worker.ts`. If those two ever drift, the
 * preview no longer matches what production sends — keep them in sync.
 *
 * Run with:
 *   pnpm tsx scripts/send-sync-email-preview.ts
 *
 * Reads RESEND_API_KEY from apps/web/.env.local.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// Load apps/web/.env.local into process.env. sendEmail reads
// RESEND_API_KEY at first invocation, so this must happen before any
// sendEmail call — module-level imports below are fine since the read
// is lazy.
function loadEnvLocal(): void {
  const envPath = path.join(REPO_ROOT, 'apps', 'web', '.env.local');
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
loadEnvLocal();

import { renderSyncSummaryPDF } from '../apps/web/lib/sync-summary-pdf';
import { sendEmail, isEmailConfigured } from '../apps/web/lib/email';
import {
  renderEmailLayout,
  renderSummaryTable,
  escapeEmailHtml,
} from '../apps/web/lib/email-layout';
import type { SyncSummaryData } from '../apps/web/lib/sync-summary-data';

type SyncSummaryJobRow = SyncSummaryData['jobRows'][number];

const RECIPIENT = 'adityauphade@makanalytics.org';

// --- Synthetic data builders ------------------------------------------------

const STREETS = [
  'Elm', 'Maple', 'Oak', 'Pine', 'Cedar', 'Birch', 'Walnut', 'Willow',
  'Chestnut', 'Magnolia', 'Hickory', 'Sycamore', 'Aspen', 'Cypress', 'Juniper',
];
const CITIES = ['Dallas', 'Plano', 'Frisco', 'Allen', 'Richardson', 'McKinney', 'Irving'];
const FIRST_NAMES = [
  'Emily', 'Marcus', 'Sofia', 'James', 'Priya', 'Daniel', 'Aisha', 'Tom',
  'Nora', 'Wei', 'Olivia', 'Hank', 'Beatriz', 'Diego', 'Sarah', 'Ravi',
];
const LAST_NAMES = [
  'Calloway', 'Ng', 'Patel', 'Hernandez', 'Whitford', 'Okonkwo', 'Berman',
  'Chen', 'Reyes', 'Singh', 'Brooks', 'Martinelli', 'Yates',
];

function synthJob(index: number): SyncSummaryJobRow {
  const street = STREETS[index % STREETS.length];
  const city = CITIES[index % CITIES.length];
  const first = FIRST_NAMES[index % FIRST_NAMES.length];
  const last = LAST_NAMES[(index * 3) % LAST_NAMES.length];
  const number = 4500 + index;
  const balance = Math.round(((index * 1373) % 80_000) / 100) * 100;
  const completedOffsetDays = (index * 7) % 180;
  const installed = new Date(Date.UTC(2026, 4, 1) - completedOffsetDays * 86_400_000);
  return {
    rooflinkId: String(10_000 + index),
    jobNumber: number,
    address: `${100 + index} ${street} St, ${city} TX`,
    customerName: `${first} ${last}`,
    dateCompleted: installed.toISOString().slice(0, 10),
    balance,
    gtPrice: balance + 5_000,
  };
}

function syntheticData(opts: {
  mode: 'incremental' | 'full';
  count: number;
  runId: number;
}): SyncSummaryData {
  const { mode, count, runId } = opts;
  const startedAt = new Date('2026-05-13T15:00:00.000Z');
  const finishedAt = new Date(
    startedAt.getTime() + (count === 0 ? 12_000 : 30_000 + count * 250),
  );
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const durationLabel =
    durationMs < 60_000
      ? `${Math.round(durationMs / 1000)} seconds`
      : `${Math.floor(durationMs / 60_000)}m ${Math.round((durationMs % 60_000) / 1000)}s`;

  const rows = Array.from({ length: count }, (_, i) => synthJob(i));
  rows.sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0));

  return {
    source: 'rooflink_jobs',
    sourceFriendly: 'Rooflink jobs',
    runId,
    mode,
    modeFriendly: mode === 'incremental' ? 'Incremental sync' : 'Full sync',
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationLabel,
    itemsProcessed: count,
    itemsTotal: mode === 'full' ? Math.max(count, 250) : count,
    shownCount: rows.length,
    truncated: mode === 'full' && rows.length < count + 50,
    jobRows: rows,
    lineItemsRows: [],
  };
}

// --- Mirrors notifySuccess in tick-worker.ts --------------------------------

async function buildAndSend(opts: {
  data: SyncSummaryData | null; // null = empty/no-records variant
  variantLabel: string;          // appended to subject so each preview is distinguishable
  fallbackRunId: number;         // used when data is null
}): Promise<void> {
  const { data, variantLabel, fallbackRunId } = opts;

  const sourceFriendly = data?.sourceFriendly ?? 'Rooflink jobs';
  const modeFriendly = data?.modeFriendly ?? 'Incremental sync';
  const durationStr = data?.durationLabel ?? '12 seconds';
  const itemsProcessed = data?.itemsProcessed ?? 0;
  const runId = data?.runId ?? fallbackRunId;
  const isEmpty = !data || itemsProcessed === 0;

  const baseSubject = isEmpty
    ? `${sourceFriendly}: no new changes`
    : `${sourceFriendly}: ${itemsProcessed.toLocaleString()} ${itemsProcessed === 1 ? 'record' : 'records'} updated`;
  const subject = `[PREVIEW · ${variantLabel}] ${baseSubject}`;

  const headline = isEmpty
    ? 'Sync ran — nothing new to update'
    : `${itemsProcessed.toLocaleString()} ${itemsProcessed === 1 ? 'record was' : 'records were'} updated`;
  const intro = isEmpty
    ? `Vera checked Rooflink for changes since the last successful sync and found nothing new for <strong>${escapeEmailHtml(sourceFriendly)}</strong>. No action needed.`
    : `Vera just finished a sync of <strong>${escapeEmailHtml(sourceFriendly)}</strong>. Here's what was pulled in:`;

  let pdfAttachment: { filename: string; content: Buffer } | null = null;
  if (!isEmpty && data) {
    const buffer = await renderSyncSummaryPDF(data);
    const dateStamp = (data.finishedAt ? new Date(data.finishedAt) : new Date())
      .toISOString()
      .slice(0, 10);
    pdfAttachment = {
      filename: `vera-${data.source}-sync-${dateStamp}-run-${data.runId}.pdf`,
      content: buffer,
    };
  }

  const summaryRows: Array<[string, string]> = [
    ['Source', sourceFriendly],
    ['Mode', modeFriendly],
    ['Records updated', itemsProcessed.toLocaleString()],
    ['Duration', durationStr],
    ['Run reference', `#${runId}`],
  ];
  if (pdfAttachment) {
    summaryRows.push(['Attached report', pdfAttachment.filename]);
  }

  const html = renderEmailLayout({
    preheader: isEmpty
      ? `No new ${sourceFriendly.toLowerCase()} since last sync`
      : `${itemsProcessed.toLocaleString()} ${sourceFriendly.toLowerCase()} updated`,
    eyebrow: 'Vera · data sync complete',
    headline,
    introHtml: pdfAttachment
      ? `${intro} A PDF summary of the touched records is attached to this email.`
      : intro,
    bodyHtml: renderSummaryTable(summaryRows),
    cta: {
      href: `${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/dashboard/scheduler`,
      label: 'Open scheduler',
    },
  });

  const result = await sendEmail({
    to: RECIPIENT,
    subject,
    html,
    attachments: pdfAttachment ? [pdfAttachment] : undefined,
  });
  if (result.ok) {
    console.log(
      `[${variantLabel}] sent to ${RECIPIENT} (resend id ${result.id}${pdfAttachment ? `, pdf ${pdfAttachment.content.byteLength} bytes` : ''})`,
    );
  } else {
    console.error(
      `[${variantLabel}] send failed: ${result.reason === 'send_failed' ? result.message : result.reason}`,
    );
  }
}

async function main(): Promise<void> {
  if (!isEmailConfigured()) {
    console.error('RESEND_API_KEY is not set in apps/web/.env.local — aborting.');
    process.exit(1);
  }

  console.log(`Sending three sync-email previews to ${RECIPIENT}…`);

  await buildAndSend({
    data: null,
    variantLabel: 'empty incremental',
    fallbackRunId: 9001,
  });

  await new Promise((r) => setTimeout(r, 500));

  await buildAndSend({
    data: syntheticData({ mode: 'incremental', count: 5, runId: 9002 }),
    variantLabel: 'small (5 records)',
    fallbackRunId: 9002,
  });

  await new Promise((r) => setTimeout(r, 500));

  await buildAndSend({
    data: syntheticData({ mode: 'full', count: 200, runId: 9003 }),
    variantLabel: 'multi-page (200 records)',
    fallbackRunId: 9003,
  });

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
