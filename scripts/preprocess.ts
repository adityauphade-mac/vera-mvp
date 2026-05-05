/**
 * Reads the raw RoofLink JSONL export, filters to the AR working set,
 * computes derived fields, and writes data/generated.json.
 */
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import {
  isInARWorkingSet,
  repRollups,
  toARJob,
} from '@vera/domain';
import { GeneratedDataSchema, RoofLinkJobSchema, type RoofLinkJob } from '@vera/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'data', 'jobs_dedup.jsonl');
const OUT = path.join(ROOT, 'apps', 'web', 'data', 'generated.json');
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'generated.fixture.json');

async function main() {
  if (!existsSync(SOURCE)) {
    throw new Error(`Source file not found: ${SOURCE}`);
  }

  const now = new Date('2026-05-05T00:00:00Z'); // pinned "today" for deterministic demo
  const start = Date.now();

  // Pass 1 — collect just the AR records and address counts.
  const arSource: RoofLinkJob[] = [];
  const addressCounts = new Map<string, number>();
  let totalRead = 0;
  let parseErrors = 0;

  const stream = createReadStream(SOURCE, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    totalRead += 1;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      parseErrors += 1;
      continue;
    }
    const parsed = RoofLinkJobSchema.safeParse(raw);
    if (!parsed.success) {
      parseErrors += 1;
      continue;
    }
    const job = parsed.data;
    if (!isInARWorkingSet(job)) continue;

    arSource.push(job);
    const addr = (job.full_address ?? job.address ?? '').trim().toLowerCase();
    if (addr) addressCounts.set(addr, (addressCounts.get(addr) ?? 0) + 1);
  }

  console.log(`Read ${totalRead.toLocaleString()} records, ${parseErrors} unparseable.`);
  console.log(`Found ${arSource.length} AR records.`);

  // Pass 2 — build the slim records.
  const arJobs = arSource.map((job) => toARJob(job, { addressCounts, now }));

  const totalAR = arJobs.reduce((sum, j) => sum + j.balance, 0);
  const reps = repRollups(arJobs);

  const out = GeneratedDataSchema.parse({
    generatedAt: new Date().toISOString(),
    asOf: now.toISOString(),
    jobCount: arJobs.length,
    totalAR,
    jobs: arJobs,
    reps,
  });

  mkdirSync(path.dirname(OUT), { recursive: true });
  mkdirSync(path.dirname(FIXTURE), { recursive: true });

  await writeFile(OUT, JSON.stringify(out, null, 2));
  await writeFile(FIXTURE, JSON.stringify(out, null, 2));

  const ms = Date.now() - start;
  const sizeKB = (JSON.stringify(out).length / 1024).toFixed(1);
  console.log(`Wrote ${arJobs.length} jobs · ${reps.length} reps · ${sizeKB} KB in ${ms} ms.`);
  console.log(`  → ${OUT}`);
  console.log(`  → ${FIXTURE}`);

  // Summary by band, for a quick eye check.
  const bandCounts = arJobs.reduce<Record<string, number>>((acc, j) => {
    acc[j.heatBand] = (acc[j.heatBand] ?? 0) + 1;
    return acc;
  }, {});
  console.log('Heat bands:', bandCounts);
  console.log(
    'Fell through cracks:',
    arJobs.filter((j) => j.fellThroughCracks).length,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
