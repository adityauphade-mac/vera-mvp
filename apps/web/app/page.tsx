import Link from 'next/link';
import {
  AlertTriangle,
  ClipboardCheck,
  GaugeCircle,
  ListChecks,
  MessageCircle,
  Trophy,
  X,
} from 'lucide-react';
import { Button, VeraQuote } from '@vera/ui';

const FEATURES = [
  {
    icon: AlertTriangle,
    cadence: 'Daily',
    title: 'Aging & anomalies',
    body: "I bucket every unpaid invoice by how late it is, relative to the customer's terms. Then I flag the patterns that worry me — math that doesn't add up, paperwork stuck, work archived but still owing.",
  },
  {
    icon: ListChecks,
    cadence: 'Daily',
    title: 'Milestone tracking',
    body: "For every install, I cross-reference against the certificate of completion, the final check, and the commission request. Whichever ones are missing, I hang as a tag — that's the leak.",
  },
  {
    icon: GaugeCircle,
    cadence: 'Daily',
    title: 'Rep follow-ups',
    body: 'I score every job from 0–100 and surface a draft email for the rep to send. Anything that crosses 76 jumps onto the executive review queue. I never send mail myself; you stay in control.',
  },
  {
    icon: Trophy,
    cadence: 'Weekly',
    title: 'Rep outstanding',
    body: "A leaderboard, sorted however you want — by dollars, by count, by oldest age, by average heat. I'll write a digest you can copy and forward.",
  },
  {
    icon: ClipboardCheck,
    cadence: 'Weekly',
    title: 'Reconciliation',
    body: "I sweep every completed install and ask: is anyone working this? If the answer is no — no recent paperwork, no edit, no commission — I flag it as 'fell through cracks.'",
  },
  {
    icon: MessageCircle,
    cadence: 'Always',
    title: 'Chat',
    body: "Ask me anything inside my AR remit. Who's worst this week? Why is this job critical? Draft me a follow-up for McMackin. I'll show my work.",
  },
];

const ASSUMPTIONS = [
  {
    code: 'Q1',
    title: "A job is in AR only if it's been installed and still owes money.",
    body: 'Anything earlier in the pipeline is a sales question, not an AR one. Of 103,440 records in RoofLink, that filter leaves about 130 — and those are the ones I watch.',
  },
  {
    code: 'Q3',
    title: 'Net 30 for retail. Net 60 for insurance.',
    body: 'Insurance depreciation checks legitimately take 30–90 days post-install. One blanket rule misrepresents both sides.',
  },
  {
    code: 'Q4',
    title: 'Aging buckets are relative to terms, not the calendar.',
    body: 'A 50-day-old insurance job is on time, not late. Buckets read "within terms," "1–30 past," "31–60 past," "60+ past."',
  },
  {
    code: 'Q7',
    title: 'Every escalation shows its math.',
    body: 'Heat score is days past terms (40%) + balance (25%) + rep silence (20%) + anomaly count (15%). Hover any badge and you\'ll see exactly why the number is what it is.',
  },
  {
    code: 'Q9',
    title: 'I draft. You send.',
    body: 'No live emails go out from my account. Every nudge is a draft you can review, edit, and copy. Trust before autonomy.',
  },
];

const OUT_OF_SCOPE = [
  'QuickBooks sync (no QB export was provided)',
  'Real outbound email — drafts only',
  'Per-rep logins — exec view only',
  'Trend reports, departed-rep audits, end-of-month close',
  'Edits back to RoofLink — Vera is read-only',
  'Mobile layouts — desktop dashboard first',
];

export default function Landing() {
  return (
    <main className="bg-bg-base min-h-screen">
      <div className="mx-auto max-w-5xl px-6 py-20 md:py-28">
        {/* Hero */}
        <section className="space-y-6 vera-rise">
          <p className="text-text-muted text-xs tracking-[0.2em] uppercase">
            Vera Calloway · Lead AR Intelligence Specialist
          </p>
          <h1 className="font-display text-5xl leading-[1.05] font-medium tracking-tight md:text-7xl">
            I keep an eye on the money <br className="hidden md:block" />
            that hasn&apos;t come home yet.
          </h1>
          <p className="text-text-secondary max-w-2xl text-lg leading-relaxed">
            A thoughtful companion for accounts receivable in the roofing business. I watch
            every install, notice when payment is sitting somewhere it shouldn&apos;t, and
            quietly draft the follow-ups before you ask.
          </p>
          <div className="flex flex-wrap gap-3 pt-4">
            <Link href="/dashboard">
              <Button size="lg">Open the dashboard →</Button>
            </Link>
            <Link href="/dashboard/design">
              <Button size="lg" variant="secondary">
                See the design system
              </Button>
            </Link>
          </div>
        </section>

        {/* What I do */}
        <section className="mt-28 vera-rise-delay-1">
          <h2 className="text-text-secondary mb-8 text-sm tracking-[0.2em] uppercase">
            What I do, every morning
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <FeatureCard key={f.title} {...f} />
            ))}
          </div>
        </section>

        {/* How I think */}
        <section className="mt-28 grid grid-cols-1 gap-12 md:grid-cols-[2fr_3fr] vera-rise-delay-2">
          <div>
            <h2 className="text-text-secondary mb-3 text-sm tracking-[0.2em] uppercase">
              How I think
            </h2>
            <p className="font-display text-4xl leading-tight font-medium tracking-tight">
              Default carefully.
              <br />
              Show your work.
            </p>
          </div>
          <ol className="space-y-7">
            {ASSUMPTIONS.map((a) => (
              <Assumption key={a.code} {...a} />
            ))}
          </ol>
        </section>

        {/* Vera quote */}
        <section className="mt-24 vera-rise-delay-3">
          <VeraQuote>
            Good morning. I&apos;m watching three jobs more closely than usual today —
            Mike Ahrend&apos;s McMackin install crossed into the Hot band overnight, and
            Brandon Roberts has two cert-of-completion gaps I&apos;d clear before lunch.
          </VeraQuote>
        </section>

        {/* Out of scope */}
        <section className="mt-24">
          <h2 className="text-text-secondary mb-5 text-sm tracking-[0.2em] uppercase">
            What this MVP doesn&apos;t do
          </h2>
          <ul className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
            {OUT_OF_SCOPE.map((item) => (
              <li
                key={item}
                className="text-text-secondary flex items-start gap-2.5 text-sm leading-relaxed"
              >
                <span
                  className="bg-text-muted/15 text-text-muted mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                  aria-hidden="true"
                >
                  <X className="h-2.5 w-2.5" />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </section>

        <footer className="text-text-muted border-border mt-32 border-t pt-8 text-xs">
          Vera MVP · built around Priority Roofs export, May 2026.
        </footer>
      </div>
    </main>
  );
}

function FeatureCard({
  icon: Icon,
  cadence,
  title,
  body,
}: {
  icon: typeof AlertTriangle;
  cadence: string;
  title: string;
  body: string;
}) {
  return (
    <div className="bg-bg-card border-border flex h-full flex-col rounded-[var(--radius-card)] border p-7 transition-shadow hover:shadow-[0_4px_16px_-6px_rgba(31,27,22,0.08)]">
      <div className="flex items-center gap-3">
        <span
          className="bg-accent/10 text-accent inline-flex h-8 w-8 items-center justify-center rounded-full"
          aria-hidden="true"
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="bg-accent/10 text-accent rounded-full px-2.5 py-1 text-[0.6rem] font-medium tracking-[0.18em] uppercase">
          {cadence}
        </span>
      </div>
      <h3 className="font-display mt-5 text-2xl font-medium tracking-tight">{title}</h3>
      <p className="text-text-secondary mt-3 flex-1 text-sm leading-relaxed">{body}</p>
    </div>
  );
}

function Assumption({
  code,
  title,
  body,
}: {
  code: string;
  title: string;
  body: string;
}) {
  return (
    <li className="grid grid-cols-[auto_1fr] items-baseline gap-x-4">
      <span className="bg-accent/10 text-accent rounded-full px-2.5 py-1 text-[0.65rem] font-semibold tracking-[0.15em] uppercase tabular-nums">
        {code}
      </span>
      <div className="space-y-1.5">
        <p className="font-display text-text-primary text-lg leading-snug font-medium">
          {title}
        </p>
        <p className="text-text-secondary text-sm leading-relaxed">{body}</p>
      </div>
    </li>
  );
}
