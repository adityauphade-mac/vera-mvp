/**
 * AR brief — pure content generator. Produces three distinct cadences.
 *
 *   daily   — today's snapshot. What to act on now.
 *   weekly  — week in review. What moved, what's about to slip.
 *   monthly — month-end close. Checklist of stuck items, per-rep accountability.
 *
 * Each cadence ships its own subject, opener, KPI set, ordered section list,
 * and PDF document title. The same underlying job set drives every cadence;
 * we don't yet have snapshot history, so "this week" / "this month" framings
 * use proxies (e.g. recently-aged-into-past-terms instead of bucket diffs).
 *
 * No I/O, no React. Implements DISCUSSION.md §6.7.
 */

import type { ARJob, AnomalyFlag } from '@vera/types';

export type BriefCadence = 'daily' | 'weekly' | 'monthly';

export type DailyBriefSection = {
  /** Plain-text subject line, e.g. "Vera's daily AR brief — May 6, 2026" */
  subject: string;
  /** Markdown body — used by the email and the dashboard preview */
  markdown: string;
  /** Structured data for the PDF */
  data: DailyBriefData;
};

export type BriefKPI = {
  label: string;
  value: string;
  hint?: string;
  emphasis?: 'critical' | 'accent' | 'default';
};

export type CloseOutItem = {
  flag: AnomalyFlag;
  label: string;
  count: number;
  totalBalance: number;
  /** Short imperative ask for the GM. */
  ask: string;
};

export type WeekHighlight = {
  id: number;
  address: string;
  rep: string;
  balance: number;
  daysPastTerms: number;
  bucket: string;
};

export type DailyBriefData = {
  cadence: BriefCadence;
  asOf: Date;
  /** Cadence-aware document title shown in the PDF header. */
  briefTitle: string;
  /** Cadence-aware sub-line under the brand mark, e.g. "Week of May 6, 2026". */
  briefSubtitle: string;
  /** One-sentence opening quote shown in both email and PDF cover. */
  headline: string;
  /** 4 cadence-specific KPI tiles in display order. */
  kpis: BriefKPI[];
  /**
   * Monthly only: stuck-item close-out checklist. Empty array for daily/weekly.
   * Surfaces the items the GM needs to clear before the books close.
   */
  closeOutItems: CloseOutItem[];
  /**
   * Weekly only: jobs that just slipped past terms (past terms ≤ 7 days).
   * Empty array for daily/monthly.
   */
  weekHighlights: WeekHighlight[];
  totals: {
    arJobCount: number;
    totalOutstanding: number;
    pastTermsTotal: number;
    pastTermsCount: number;
    criticalCount: number;
  };
  bucketSummary: Array<{ bucket: string; label: string; count: number; total: number }>;
  topCriticalJobs: Array<CriticalJobRow>;
  anomalyBreakdown: Array<{ flag: AnomalyFlag; label: string; count: number }>;
  topReps: Array<RepRow>;
  fullJobList: Array<JobRow>;
};

export type CriticalJobRow = {
  id: number;
  address: string;
  rep: string;
  balance: number;
  daysPastTerms: number;
  heatScore: number;
};

export type RepRow = {
  name: string;
  jobCount: number;
  totalOutstanding: number;
  oldestDaysPastTerms: number;
  criticalCount: number;
};

export type JobRow = {
  id: number;
  address: string;
  rep: string;
  region: string;
  balance: number;
  daysPastTerms: number;
  bucket: string;
  heatScore: number;
  heatBand: string;
  anomalyCount: number;
};

const ANOMALY_LABEL: Record<AnomalyFlag, string> = {
  'balance-exceeds-price': 'Balance exceeds price',
  'no-cert-of-completion': 'No cert of completion',
  'insurance-final-check-stuck': 'Insurance final check stuck',
  'retail-no-payment': 'Retail — no payments',
  'duplicate-address': 'Duplicate address',
  'no-commission-request': 'No commission request',
  'impossible-payments': 'Impossible payments',
  'archived-with-balance': 'Archived but owing',
  'warranty-voided-with-balance': 'Warranty voided',
};

/**
 * GM-facing close-out asks. Lives next to the labels so the PDF / email
 * stay consistent. Spec questions referenced inline.
 */
const CLOSE_OUT_ASK: Record<AnomalyFlag, string> = {
  'no-cert-of-completion':
    'Get the rep to upload the COC — many insurers won’t cut the final check without it.',
  'insurance-final-check-stuck':
    'Call the carrier’s mortgagee desk; final-check release is the unlock.',
  'no-commission-request':
    'Push the rep to file commission so we can close the job in books.',
  'retail-no-payment':
    'Re-engage the homeowner directly — these have aged with zero payments in.',
  'balance-exceeds-price':
    'Reconcile the price vs. balance mismatch with the original contract.',
  'impossible-payments':
    'Audit payments — values look out of range; likely a data-entry error.',
  'archived-with-balance':
    'Reopen the job in RoofLink or write off the balance with sign-off.',
  'warranty-voided-with-balance':
    'Decide: collect the balance or note it as uncollectible before close.',
  'duplicate-address':
    'Confirm whether these are duplicate records or genuine multi-job sites.',
};

const BUCKET_LABEL: Record<string, string> = {
  'within-terms': 'Within terms',
  '1-30-past': '1–30 days past',
  '31-60-past': '31–60 days past',
  '60-plus-past': '60+ days past',
};

function formatUSD(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatMonthYear(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * Build the AR brief for a given cadence.
 *
 * @param jobs    — full AR job set (already filtered to the AR working set)
 * @param now     — pass-in clock so the function stays pure
 * @param cadence — daily | weekly | monthly framing
 */
export function buildDailyBrief(
  jobs: ARJob[],
  now: Date,
  cadence: BriefCadence = 'daily',
): DailyBriefSection {
  const dateStr = formatDate(now);
  const monthStr = formatMonthYear(now);

  // --- Totals ---------------------------------------------------------
  const totalOutstanding = jobs.reduce((s, j) => s + j.balance, 0);
  const pastTermsJobs = jobs.filter((j) => j.daysPastTerms > 0);
  const pastTermsTotal = pastTermsJobs.reduce((s, j) => s + j.balance, 0);
  const criticalJobs = jobs.filter((j) => j.heatBand === 'critical');
  const criticalCount = criticalJobs.length;
  const hotCount = jobs.filter((j) => j.heatBand === 'hot').length;
  const fellThroughCount = jobs.filter((j) => j.fellThroughCracks).length;

  // --- Bucket summary -------------------------------------------------
  const buckets = ['within-terms', '1-30-past', '31-60-past', '60-plus-past'];
  const bucketSummary = buckets.map((b) => {
    const inBucket = jobs.filter((j) => j.agingBucket === b);
    return {
      bucket: b,
      label: BUCKET_LABEL[b] ?? b,
      count: inBucket.length,
      total: inBucket.reduce((s, j) => s + j.balance, 0),
    };
  });

  const sixtyPlus = bucketSummary.find((b) => b.bucket === '60-plus-past');
  const thirtyToSixty = bucketSummary.find((b) => b.bucket === '31-60-past');
  const oneToThirty = bucketSummary.find((b) => b.bucket === '1-30-past');

  // --- Top critical jobs ----------------------------------------------
  const sortedByHeat = [...jobs].sort((a, b) => b.heatScore - a.heatScore);
  const topCriticalJobs: CriticalJobRow[] = sortedByHeat.slice(0, 5).map((j) => ({
    id: j.id,
    address: j.address,
    rep: j.rep?.name ?? '—',
    balance: j.balance,
    daysPastTerms: j.daysPastTerms,
    heatScore: j.heatScore,
  }));

  // --- Anomaly breakdown ----------------------------------------------
  const anomalyCounts = new Map<AnomalyFlag, number>();
  for (const j of jobs) {
    for (const flag of j.anomalies) {
      anomalyCounts.set(flag, (anomalyCounts.get(flag) ?? 0) + 1);
    }
  }
  const anomalyBreakdown = [...anomalyCounts.entries()]
    .map(([flag, count]) => ({ flag, label: ANOMALY_LABEL[flag], count }))
    .sort((a, b) => b.count - a.count);
  const totalAnomalies = anomalyBreakdown.reduce((s, a) => s + a.count, 0);

  // --- Top reps to watch ----------------------------------------------
  const repMap = new Map<string, RepRow>();
  for (const j of jobs) {
    if (!j.rep?.name) continue;
    const existing = repMap.get(j.rep.name) ?? {
      name: j.rep.name,
      jobCount: 0,
      totalOutstanding: 0,
      oldestDaysPastTerms: 0,
      criticalCount: 0,
    };
    existing.jobCount += 1;
    existing.totalOutstanding += j.balance;
    existing.oldestDaysPastTerms = Math.max(
      existing.oldestDaysPastTerms,
      j.daysPastTerms,
    );
    if (j.heatBand === 'critical') existing.criticalCount += 1;
    repMap.set(j.rep.name, existing);
  }
  const repsByOutstanding = [...repMap.values()].sort(
    (a, b) => b.totalOutstanding - a.totalOutstanding,
  );
  // Daily / weekly: 5 reps. Monthly: 10 (close-out accountability).
  const topRepsCount = cadence === 'monthly' ? 10 : cadence === 'weekly' ? 8 : 5;
  const topReps = repsByOutstanding.slice(0, topRepsCount);
  const repsOverFiftyK = repsByOutstanding.filter((r) => r.totalOutstanding > 50_000)
    .length;

  // --- Full job list (for PDF) ---------------------------------------
  const fullJobList: JobRow[] = [...jobs]
    .sort((a, b) => b.daysPastTerms - a.daysPastTerms)
    .map((j) => ({
      id: j.id,
      address: j.address,
      rep: j.rep?.name ?? '—',
      region: j.region ?? '—',
      balance: j.balance,
      daysPastTerms: j.daysPastTerms,
      bucket: BUCKET_LABEL[j.agingBucket] ?? j.agingBucket,
      heatScore: j.heatScore,
      heatBand: j.heatBand,
      anomalyCount: j.anomalies.length,
    }));

  // --- Weekly: jobs that just slipped past terms ----------------------
  const weekHighlights: WeekHighlight[] =
    cadence === 'weekly'
      ? [...jobs]
          .filter((j) => j.daysPastTerms > 0 && j.daysPastTerms <= 7)
          .sort((a, b) => b.balance - a.balance)
          .slice(0, 8)
          .map((j) => ({
            id: j.id,
            address: j.address,
            rep: j.rep?.name ?? '—',
            balance: j.balance,
            daysPastTerms: j.daysPastTerms,
            bucket: BUCKET_LABEL[j.agingBucket] ?? j.agingBucket,
          }))
      : [];

  // --- Monthly: close-out checklist ----------------------------------
  // Five anomaly flags that an AR specialist would chase before close.
  const closeOutFlags: AnomalyFlag[] = [
    'insurance-final-check-stuck',
    'no-cert-of-completion',
    'no-commission-request',
    'retail-no-payment',
    'balance-exceeds-price',
  ];
  const closeOutItems: CloseOutItem[] =
    cadence === 'monthly'
      ? closeOutFlags
          .map((flag) => {
            const matching = jobs.filter((j) => j.anomalies.includes(flag));
            return {
              flag,
              label: ANOMALY_LABEL[flag],
              count: matching.length,
              totalBalance: matching.reduce((s, j) => s + j.balance, 0),
              ask: CLOSE_OUT_ASK[flag],
            };
          })
          .filter((c) => c.count > 0)
      : [];
  const closeOutTotalBalance = closeOutItems.reduce((s, c) => s + c.totalBalance, 0);
  const closeOutTotalCount = closeOutItems.reduce((s, c) => s + c.count, 0);

  // --- Cadence-specific framing ---------------------------------------
  const subjectByCadence: Record<BriefCadence, string> = {
    daily: `Vera's daily AR brief — ${dateStr}`,
    weekly: `Vera's weekly AR summary — week of ${dateStr}`,
    monthly: `Vera's monthly AR close — ${monthStr}`,
  };

  const briefTitleByCadence: Record<BriefCadence, string> = {
    daily: 'Daily AR Brief',
    weekly: 'Weekly AR Summary',
    monthly: 'Monthly AR Close',
  };

  const briefSubtitleByCadence: Record<BriefCadence, string> = {
    daily: dateStr,
    weekly: `Week of ${dateStr}`,
    monthly: monthStr,
  };

  let headline: string;
  if (cadence === 'daily') {
    headline =
      criticalCount > 0
        ? `${criticalCount} ${criticalCount === 1 ? 'job is' : 'jobs are'} in the critical band today. Total past terms: ${formatUSD(pastTermsTotal)}.`
        : `No critical jobs today. Total past terms: ${formatUSD(pastTermsTotal)}.`;
  } else if (cadence === 'weekly') {
    const slipping = oneToThirty?.count ?? 0;
    headline =
      weekHighlights.length > 0
        ? `${weekHighlights.length} ${weekHighlights.length === 1 ? 'job' : 'jobs'} just slipped past terms this week. ${slipping} ${slipping === 1 ? 'job sits' : 'jobs sit'} in the 1–30 bucket — they’re the next dominoes.`
        : `Quiet week — no new past-terms slippage. Watch the ${slipping} ${slipping === 1 ? 'job' : 'jobs'} sitting in 1–30.`;
  } else {
    headline =
      closeOutTotalCount > 0
        ? `${closeOutTotalCount} stuck items totaling ${formatUSD(closeOutTotalBalance)} need to clear before ${monthStr} closes.`
        : `Close-out is clean for ${monthStr}. No stuck items.`;
  }

  // KPIs vary by cadence — order and labels reflect the framing of each.
  const kpis: BriefKPI[] =
    cadence === 'daily'
      ? [
          {
            label: 'Total outstanding',
            value: formatUSD(totalOutstanding),
            hint: `${jobs.length} AR jobs`,
          },
          {
            label: 'Past terms',
            value: formatUSD(pastTermsTotal),
            hint: `${pastTermsJobs.length} jobs`,
          },
          {
            label: 'Critical jobs',
            value: String(criticalCount),
            hint: 'Heat 76+',
            emphasis: criticalCount > 0 ? 'critical' : 'default',
          },
          {
            label: 'Anomalies flagged',
            value: String(totalAnomalies),
            hint: `${anomalyBreakdown.length} rule${anomalyBreakdown.length === 1 ? '' : 's'}`,
          },
        ]
      : cadence === 'weekly'
        ? [
            {
              label: 'New past terms',
              value: String(weekHighlights.length),
              hint: 'Within last 7 days',
              emphasis: weekHighlights.length > 0 ? 'accent' : 'default',
            },
            {
              label: 'In the 1–30 bucket',
              value: String(oneToThirty?.count ?? 0),
              hint: formatUSD(oneToThirty?.total ?? 0),
            },
            {
              label: 'Hot + critical',
              value: String(hotCount + criticalCount),
              hint: `${criticalCount} critical · ${hotCount} hot`,
              emphasis: criticalCount > 0 ? 'critical' : 'default',
            },
            {
              label: 'Reps over $50k',
              value: String(repsOverFiftyK),
              hint: 'Outstanding balance',
            },
          ]
        : [
            {
              label: 'Open AR balance',
              value: formatUSD(totalOutstanding),
              hint: `${jobs.length} jobs`,
            },
            {
              label: 'Past terms total',
              value: formatUSD(pastTermsTotal),
              hint: `${pastTermsJobs.length} jobs · ${formatUSD(sixtyPlus?.total ?? 0)} over 60d`,
            },
            {
              label: 'Stuck items',
              value: String(closeOutTotalCount),
              hint: formatUSD(closeOutTotalBalance),
              emphasis: closeOutTotalCount > 0 ? 'critical' : 'default',
            },
            {
              label: 'Fell-through jobs',
              value: String(fellThroughCount),
              hint: 'Need a personal touch',
            },
          ];

  // --- Markdown body --------------------------------------------------
  const lines: string[] = [];
  lines.push('Hi,');
  lines.push('');
  lines.push(buildOpener(cadence, dateStr, monthStr));
  lines.push('');
  lines.push(`**Headline:** ${headline}`);
  lines.push('');

  if (cadence === 'monthly' && closeOutItems.length > 0) {
    lines.push('**Close-out checklist — clear before books close:**');
    for (const c of closeOutItems) {
      lines.push(
        `- **${c.label}** — ${c.count} ${c.count === 1 ? 'job' : 'jobs'} · ${formatUSD(c.totalBalance)}. ${c.ask}`,
      );
    }
    lines.push('');
  }

  if (cadence === 'weekly' && weekHighlights.length > 0) {
    lines.push('**Just slipped past terms this week:**');
    for (const w of weekHighlights) {
      lines.push(
        `- **${w.address}** (${w.rep}) — ${formatUSD(w.balance)}, ${w.daysPastTerms}d past`,
      );
    }
    lines.push('');
  }

  if (topCriticalJobs.length > 0) {
    lines.push(
      cadence === 'weekly'
        ? '**Hottest jobs going into next week:**'
        : cadence === 'monthly'
          ? '**Critical jobs to settle before month-end:**'
          : '**Top jobs to focus on:**',
    );
    for (const j of topCriticalJobs) {
      const days = j.daysPastTerms > 0 ? `${j.daysPastTerms}d past` : 'within terms';
      lines.push(
        `- **${j.address}** (${j.rep}) — ${formatUSD(j.balance)}, ${days}, heat ${j.heatScore}`,
      );
    }
    lines.push('');
  }

  if (cadence !== 'monthly' && anomalyBreakdown.length > 0) {
    lines.push('**What looks strange:**');
    for (const a of anomalyBreakdown.slice(0, 4)) {
      lines.push(`- ${a.label} — ${a.count} ${a.count === 1 ? 'job' : 'jobs'}`);
    }
    lines.push('');
  }

  if (topReps.length > 0) {
    lines.push(
      cadence === 'monthly'
        ? '**Per-rep accountability for the month:**'
        : cadence === 'weekly'
          ? '**Reps to address this week:**'
          : '**Reps with the most outstanding:**',
    );
    for (const r of topReps) {
      const note = r.criticalCount > 0 ? `, ${r.criticalCount} critical` : '';
      lines.push(
        `- **${r.name}** — ${formatUSD(r.totalOutstanding)} across ${r.jobCount} ${r.jobCount === 1 ? 'job' : 'jobs'}${note}, oldest ${r.oldestDaysPastTerms}d`,
      );
    }
    lines.push('');
  }

  lines.push(buildClose(cadence));
  lines.push('');
  lines.push('— Vera');

  return {
    subject: subjectByCadence[cadence],
    markdown: lines.join('\n'),
    data: {
      cadence,
      asOf: now,
      briefTitle: briefTitleByCadence[cadence],
      briefSubtitle: briefSubtitleByCadence[cadence],
      headline,
      kpis,
      closeOutItems,
      weekHighlights,
      totals: {
        arJobCount: jobs.length,
        totalOutstanding,
        pastTermsTotal,
        pastTermsCount: pastTermsJobs.length,
        criticalCount,
      },
      bucketSummary,
      topCriticalJobs,
      anomalyBreakdown,
      topReps,
      fullJobList,
    },
  };
}

function buildOpener(cadence: BriefCadence, dateStr: string, monthStr: string): string {
  if (cadence === 'daily') return `Here's where AR stands as of ${dateStr}.`;
  if (cadence === 'weekly')
    return `Here's the AR week in review, looking back from ${dateStr}.`;
  return `Here's the month-end AR rollup for ${monthStr}.`;
}

function buildClose(cadence: BriefCadence): string {
  if (cadence === 'daily')
    return 'The attached PDF has the full job list, anomaly breakdown, and per-rep summary.';
  if (cadence === 'weekly')
    return 'The attached PDF has the new-past-terms detail, this week’s critical queue, and per-rep accountability.';
  return 'The attached PDF has the close-out checklist, per-rep accountability, and the full month-end job list.';
}
