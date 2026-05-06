import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  ClipboardCheck,
  GaugeCircle,
  ListChecks,
  MessageCircle,
  Palette,
  Trophy,
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
    title: 'Rep leaderboard',
    body: "Seven metrics, six time windows. Sortable by dollars, count, oldest age, average heat, install value, commissions, or installs completed. Use it for one-on-ones and to spot patterns.",
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
              <Button size="lg">
                Open the dashboard
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/docs">
              <Button size="lg" variant="secondary">
                <BookOpen className="h-4 w-4" />
                Read how I work
              </Button>
            </Link>
            <Link href="/design">
              <Button size="lg" variant="secondary">
                <Palette className="h-4 w-4" />
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

        {/* Vera quote */}
        <section className="mt-24 vera-rise-delay-2">
          <VeraQuote>
            Good morning. I&apos;m watching three jobs more closely than usual today —
            Mike Ahrend&apos;s McMackin install crossed into the Hot band overnight, and
            Brandon Roberts has two cert-of-completion gaps I&apos;d clear before lunch.
          </VeraQuote>
        </section>

        {/* Tail CTA */}
        <section className="mt-24 vera-rise-delay-3">
          <div className="bg-bg-card border-border rounded-[var(--radius-card)] border p-10 text-center">
            <p className="text-text-muted text-[0.65rem] font-semibold tracking-[0.18em] uppercase">
              Ready when you are
            </p>
            <p className="font-display mt-3 text-3xl tracking-tight md:text-4xl">
              Open the briefing, or read the handbook first.
            </p>
            <p className="text-text-secondary mx-auto mt-4 max-w-xl text-sm leading-relaxed">
              Every default I use, every score I assign, every report I run is
              explained on{' '}
              <Link href="/docs" className="text-accent underline-offset-4 hover:underline">
                the handbook page
              </Link>
              . Trust before autonomy — your call.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link href="/dashboard">
                <Button>
                  Open the dashboard
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/docs">
                <Button variant="secondary">
                  <BookOpen className="h-4 w-4" />
                  Read the handbook
                </Button>
              </Link>
            </div>
          </div>
        </section>

        <footer className="text-text-muted border-border mt-24 flex flex-wrap items-center justify-between gap-3 border-t pt-8 text-xs">
          <span>Vera MVP · built around Priority Roofs export.</span>
          <span className="flex gap-5">
            <Link href="/docs" className="hover:text-text-primary transition-colors">
              How I work
            </Link>
            <Link href="/design" className="hover:text-text-primary transition-colors">
              Design system
            </Link>
            <Link href="/dashboard" className="hover:text-text-primary transition-colors">
              Dashboard
            </Link>
          </span>
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
