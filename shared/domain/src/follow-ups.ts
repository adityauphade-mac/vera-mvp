import type { ARJob } from '@vera/types';

/** Q9 + Q10: flat-cadence email draft Vera produces for a rep. */
export function generateFollowUpDraft(job: ARJob): { subject: string; body: string } {
  const repName = job.rep?.name ?? 'there';
  const repFirst = repName.split(' ')[0] ?? repName;
  const balance = formatUSD(job.balance);
  const insuranceNote = job.isInsurance
    ? "It's an insurance job, so I'm assuming we're waiting on the depreciation check."
    : "It's a retail job, so payment should be coming directly from the homeowner.";

  const missing = job.missingMilestones.length
    ? `On my end, the records show these still pending: ${job.missingMilestones.join(', ')}.`
    : 'On my end, the paperwork looks current.';

  const subject = `Quick check on ${job.address} (${balance} outstanding)`;

  const body = `Hi ${repFirst},

I'm following up on ${job.address}. Install was on ${formatDate(job.dateCompleted)} — that's ${job.daysSinceInstall} days ago — and we're still showing a balance of ${balance}.

${insuranceNote}

${missing}

Could you share where this stands with the customer? If there's anything I can do to unblock it from this side, just let me know.

— Vera`;

  return { subject, body };
}

function formatUSD(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
