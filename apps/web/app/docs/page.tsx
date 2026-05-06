import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ClipboardCheck,
  GaugeCircle,
  ListChecks,
  Trophy,
  X,
} from 'lucide-react';
import { Button, VeraQuote } from '@vera/ui';
import { PageNav } from '../_components/PageNav';

const SECTIONS = [
  { id: 'what-vera-is', label: 'Who I am' },
  { id: 'ar', label: 'AR & payment terms' },
  { id: 'heat', label: 'How Heat works' },
  { id: 'reports', label: 'How each report works' },
  { id: 'assumptions', label: 'Default assumptions' },
  { id: 'out-of-scope', label: "What's out of scope" },
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
    body: "Heat score is days past terms (40%) + balance (25%) + rep silence (20%) + anomaly count (15%). Hover any badge and you'll see exactly why the number is what it is.",
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
  'Edits back to RoofLink — I\'m read-only',
  'Mobile layouts — desktop dashboard first',
];

export default function DocsPage() {
  return (
    <main className="bg-bg-base min-h-screen">
      {/* Top bar — same shape as /design, no dashboard chrome */}
      <header className="border-border bg-bg-base/85 sticky top-0 z-30 flex h-[72px] items-center justify-between border-b px-8 backdrop-blur">
        <div>
          <p className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
            Vera Calloway · Handbook
          </p>
          <p className="font-display text-xl tracking-tight">How I work</p>
        </div>
        <Link
          href="/"
          className="text-text-secondary hover:text-text-primary inline-flex items-center gap-2 text-sm transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to landing page
        </Link>
      </header>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-12 px-8 py-14 lg:grid-cols-[200px_1fr]">
        {/* TOC */}
        <aside className="hidden lg:block">
          <PageNav sections={SECTIONS} />
        </aside>

        <div className="space-y-20">
          <header className="space-y-4 vera-rise">
            <p className="text-text-muted text-xs tracking-[0.2em] uppercase">
              The handbook
            </p>
            <h1 className="font-display text-5xl tracking-tight md:text-6xl">
              How I think, in detail.
            </h1>
            <p className="text-text-secondary max-w-2xl text-lg leading-relaxed">
              Everything explanatory lives here — what AR means, how payment terms
              work, how I compute heat scores, what each daily and weekly report
              does. The landing page is short on purpose; this is where you come
              to challenge my math.
            </p>
          </header>

          {/* WHO I AM */}
          <section id="what-vera-is" className="space-y-6 vera-rise-delay-1 scroll-mt-24">
            <SectionHeader eyebrow="Who I am" title="A read-only AR specialist." />
            <div className="bg-bg-card border-border rounded-[var(--radius-card)] border p-8 space-y-4">
              <p className="text-text-primary text-lg leading-relaxed">
                I&apos;m Vera Calloway, an AI Accounts Receivable specialist for a roofing
                company. I watch every install, notice when payment is sitting somewhere
                it shouldn&apos;t, and draft the follow-ups before you ask.
              </p>
              <p className="text-text-secondary leading-relaxed">
                I&apos;m <span className="text-text-primary font-medium">observe + draft only</span>:
                no autosend, no real outbound email, no edits back to RoofLink, no
                database writes. RoofLink stays the source of truth — I just read it,
                pattern-match, and surface what matters. Every default I use is
                visible in the UI so you can spot and challenge it.
              </p>
              <ul className="text-text-secondary mt-4 space-y-2.5 text-sm leading-relaxed">
                <Bullet>I read from a daily snapshot of the RoofLink export.</Bullet>
                <Bullet>I draft emails you can copy / open in your mail client.</Bullet>
                <Bullet>I never send, post, or modify anything on your behalf.</Bullet>
                <Bullet>I show the four numbers behind every heat score I assign.</Bullet>
              </ul>
            </div>
          </section>

          {/* AR + PAYMENT TERMS */}
          <section id="ar" className="space-y-6 vera-rise-delay-1 scroll-mt-24">
            <SectionHeader
              eyebrow="AR & payment terms"
              title="What 'in AR' actually means."
            />

            <div className="bg-bg-card border-border rounded-[var(--radius-card)] border p-8">
              <p className="text-text-primary text-lg leading-relaxed">
                <span className="font-semibold">AR — Accounts Receivable</span> is
                the accounting term for money customers owe you that you haven&apos;t
                collected yet.
              </p>
              <p className="text-text-secondary mt-4 leading-relaxed">
                When a roofing company finishes a $15,000 job and the customer
                hasn&apos;t paid (or only paid part), that unpaid amount sits as AR
                until it&apos;s either collected or written off. Every dollar in AR
                is a dollar you&apos;ve already spent — materials, labor, commission
                — but haven&apos;t recovered. So AR is cash-flow risk: companies can
                be profitable on paper and still go broke if AR balloons.
              </p>
              <p className="text-text-secondary mt-4 leading-relaxed">
                Of 103,440 records in your RoofLink export, only{' '}
                <span className="text-text-primary font-medium">130 jobs</span> meet
                the strict definition I use: the roof is on the house{' '}
                <em>and</em> there&apos;s still money owed. Those 130 are my
                working set.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_3fr]">
              <div className="space-y-4">
                <p className="font-display text-text-primary text-3xl leading-tight font-medium tracking-tight">
                  How long does the customer have to pay?
                </p>
                <p className="text-text-secondary leading-relaxed">
                  Different jobs follow different timelines. A retail homeowner pays
                  within 30 days. An insurance carrier&apos;s depreciation check
                  legitimately takes 30–90 days. So the rule splits:
                </p>
                <ul className="text-text-secondary space-y-2 text-sm">
                  <li>
                    <span className="text-text-primary font-medium">Net 30</span> for
                    retail / cash jobs
                  </li>
                  <li>
                    <span className="text-text-primary font-medium">Net 60</span> for
                    insurance jobs
                  </li>
                </ul>
                <p className="text-text-muted text-sm leading-relaxed">
                  Both clocks start at the install date. &quot;Within terms&quot; just
                  means the clock hasn&apos;t expired yet.
                </p>
              </div>

              <div className="bg-bg-card border-border overflow-hidden rounded-[var(--radius-card)] border">
                <table className="w-full text-sm">
                  <thead className="bg-bg-subtle text-text-secondary text-[0.65rem] tracking-[0.15em] uppercase">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Job type</th>
                      <th className="px-4 py-3 text-left font-semibold">Installed</th>
                      <th className="px-4 py-3 text-right font-semibold">Days past</th>
                      <th className="px-4 py-3 text-left font-semibold">Bucket</th>
                    </tr>
                  </thead>
                  <tbody>
                    <NetRow type="Retail" days={25} terms={30} bucket="Within terms" />
                    <NetRow type="Retail" days={40} terms={30} bucket="1–30 past" />
                    <NetRow type="Retail" days={95} terms={30} bucket="60+ past" />
                    <NetRow type="Insurance" days={50} terms={60} bucket="Within terms" />
                    <NetRow type="Insurance" days={75} terms={60} bucket="1–30 past" />
                    <NetRow type="Insurance" days={130} terms={60} bucket="60+ past" />
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* HOW HEAT WORKS */}
          <section id="heat" className="space-y-6 vera-rise-delay-1 scroll-mt-24">
            <SectionHeader eyebrow="How heat works" title="A 0–100 score on every AR job." />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_4fr]">
              <div className="space-y-4">
                <p className="text-text-secondary leading-relaxed">
                  Every job earns a heat score from four ingredients I weigh:
                </p>
                <ul className="text-text-secondary space-y-2 text-sm leading-relaxed">
                  <li>
                    <span className="text-text-primary font-medium">Days past terms</span> ·
                    40% — capped at 60+ days
                  </li>
                  <li>
                    <span className="text-text-primary font-medium">Balance size</span> ·
                    25% — log-scaled so $1k feels different from $50k
                  </li>
                  <li>
                    <span className="text-text-primary font-medium">Rep silence</span> ·
                    20% — growing if no one has touched the record in 14+ days
                  </li>
                  <li>
                    <span className="text-text-primary font-medium">Anomaly flags</span> ·
                    15% — one anomaly is a hint, three is a pattern
                  </li>
                </ul>
                <p className="text-text-muted pt-2 text-sm">
                  Hover any heat meter on the dashboard to see the four numbers behind
                  a job&apos;s score.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <HeatBandCard
                  band="Cool"
                  range="0–25"
                  meaning="On track. Fresh installs with paperwork moving. I won't bother you about these."
                  color="var(--color-heat-cool)"
                />
                <HeatBandCard
                  band="Warm"
                  range="26–50"
                  meaning="Visible but not nudged yet. The rep should know they exist; I'm keeping watch."
                  color="var(--color-heat-warm)"
                />
                <HeatBandCard
                  band="Hot"
                  range="51–75"
                  meaning="I'll draft a follow-up email for the rep today. Past terms + balance + something off."
                  color="var(--color-heat-hot)"
                />
                <HeatBandCard
                  band="Critical"
                  range="76+"
                  meaning="Auto-flows to the Executive Review Queue. Needs a personal touch, not just a rep nudge."
                  color="var(--color-heat-critical)"
                />
              </div>
            </div>
          </section>

          {/* HOW EACH REPORT WORKS */}
          <section id="reports" className="space-y-6 vera-rise-delay-1 scroll-mt-24">
            <SectionHeader
              eyebrow="How each report works"
              title="Five reports, two cadences."
            />

            <div className="space-y-6">
              <ReportExplainer
                icon={AlertTriangle}
                cadence="Daily"
                title="Aging & anomalies"
                question="How late are my unpaid invoices, and is anything weird?"
                summary="Every AR job sorted by how far past terms. Plus a panel of strange patterns I flagged this morning — math errors, paperwork stuck, work archived but still owing."
                tiles={[
                  { label: 'Within terms', meaning: "The customer's payment clock hasn't run out yet. Net 30 retail / Net 60 insurance, from install date." },
                  { label: '1–30 past', meaning: 'Jobs 1–30 days past terms. First nudge territory.' },
                  { label: '31–60 past', meaning: 'Jobs 31–60 days past terms. Escalation territory.' },
                  { label: '60+ past', meaning: 'Jobs more than 60 days past terms. Likely needs executive intervention.' },
                ]}
              />

              <ReportExplainer
                icon={ListChecks}
                cadence="Daily"
                title="Milestone tracking"
                question="Which jobs are stuck because the paperwork hasn't moved?"
                summary="Cross-references every install against three milestones: certificate of completion, final (insurance depreciation) check, and commission request. Missing ones become tags on the row — that's where the money is stuck."
                tiles={[
                  { label: 'Missing cert of completion', meaning: 'Install done, but no certificate of completion logged after 14 days. The insurer cannot release the final check without this document.' },
                  { label: 'Insurance — final check open', meaning: "Insurance jobs where the depreciation/RCV check hasn't been endorsed yet. The bigger of the two insurance payments." },
                  { label: 'No commission requested', meaning: "Rep hasn't requested commission after 14 days. Often a behavioral signal that the rep believes the job won't collect." },
                  { label: 'Paperwork current', meaning: 'Jobs with all milestones logged. Nothing for me to chase.' },
                ]}
              />

              <ReportExplainer
                icon={GaugeCircle}
                cadence="Daily"
                title="Follow-ups & escalation"
                question="Who do I need to nudge today?"
                summary="Two queues for two audiences. Hot jobs (heat 51–75) get a draft email I write for the rep — they chase the customer. Critical jobs (76+) skip the rep entirely and go to the executive review queue — they need a personal touch from you."
                tiles={[
                  { label: 'Hot — for reps', meaning: 'Heat 51–75. I draft the follow-up; the rep sends. The rep is still the right person to chase this.' },
                  { label: 'Critical — exec review', meaning: 'Heat 76+. Too far gone for a rep nudge. Personal touch from the office: call the homeowner, write off, or use as a learning moment.' },
                  { label: 'Total in heat', meaning: "Hot + Critical combined. Cool / Warm jobs stay visible elsewhere but don't need follow-up today." },
                  { label: 'Total dollars in heat', meaning: 'Sum of balances across Hot and Critical. The dollar exposure on jobs that need active follow-up today.' },
                ]}
              />

              <ReportExplainer
                icon={Trophy}
                cadence="Weekly"
                title="Rep leaderboard"
                question="Which rep is sitting on the most uncollected money?"
                summary="A leaderboard of every rep with at least one open job. Sortable by seven metrics — outstanding, AR job count, oldest aging, average heat, install value, commissions earned, installs completed. Filter by region or job type to slice it. Use it for one-on-ones, weekly stand-ups, or to spot patterns."
                tiles={[
                  { label: 'Reps with AR', meaning: 'Number of distinct reps owning at least one AR job. Drops if you filter by region or job type.' },
                  { label: 'Total outstanding', meaning: "Sum of outstanding balances across the reps shown. Equals the dashboard's Total AR when no filters applied." },
                  { label: 'Installs · period', meaning: 'Number of installs completed in the selected period (this month, last month, 30d, 90d, 12m, all time).' },
                  { label: 'Commissions · period', meaning: 'Sum of commission amounts on installs completed in the selected period.' },
                ]}
              />

              <ReportExplainer
                icon={ClipboardCheck}
                cadence="Weekly"
                title="Reconciliation — fell through cracks"
                question="Are any completed installs being totally ignored?"
                summary={"Once a week I walk every completed install and ask: is anyone actually working on this? I look for any sign of life in the last 14 days — an endorsed insurance check, a certificate of completion, a commission request, or even just a record edit. If none of those exist, the job has fallen through cracks. Aging shows what's late; reconciliation shows what's forgotten."}
                tiles={[
                  { label: 'Stuck jobs', meaning: 'Jobs with zero recent activity across all four signals. The forgotten list.' },
                  { label: 'Locked up', meaning: 'Total dollars in stuck jobs. Revenue already worked (materials + labor + commission paid out) but not actively being collected.' },
                  { label: 'Reps affected', meaning: 'Distinct reps with at least one stuck job. High = systemic; low = concentrated.' },
                  { label: 'Oldest install', meaning: 'Days since the oldest stuck install. Past 12 months, recovery rates drop sharply.' },
                ]}
              />
            </div>
          </section>

          {/* DEFAULT ASSUMPTIONS */}
          <section id="assumptions" className="space-y-6 vera-rise-delay-1 scroll-mt-24">
            <SectionHeader
              eyebrow="Default assumptions"
              title="Default carefully. Show your work."
            />
            <p className="text-text-secondary max-w-3xl leading-relaxed">
              Every default I use is surfaced so you can challenge it. The Q
              codes correspond to questions in <code>SPEC.md</code>.
            </p>
            <ol className="space-y-7">
              {ASSUMPTIONS.map((a) => (
                <Assumption key={a.code} {...a} />
              ))}
            </ol>
          </section>

          {/* OUT OF SCOPE */}
          <section id="out-of-scope" className="space-y-6 vera-rise-delay-1 scroll-mt-24">
            <SectionHeader
              eyebrow="What's out of scope"
              title="What this MVP doesn't do."
            />
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

          {/* Vera quote + CTA */}
          <section className="vera-rise-delay-2 space-y-8">
            <VeraQuote>
              Good morning. I&apos;m watching three jobs more closely than usual today —
              Mike Ahrend&apos;s McMackin install crossed into the Hot band overnight, and
              Brandon Roberts has two cert-of-completion gaps I&apos;d clear before lunch.
            </VeraQuote>
            <div className="flex flex-wrap gap-3">
              <Link href="/dashboard">
                <Button size="lg">
                  Open the dashboard
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/">
                <Button size="lg" variant="secondary">
                  <ArrowLeft className="h-4 w-4" />
                  Back to landing page
                </Button>
              </Link>
            </div>
          </section>

          <footer className="text-text-muted border-border mt-16 border-t pt-8 text-xs">
            Vera MVP · handbook · built around Priority Roofs export.
          </footer>
        </div>
      </div>
    </main>
  );
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="border-border border-b pb-3">
      <p className="text-text-muted text-[0.65rem] font-semibold tracking-[0.18em] uppercase">
        {eyebrow}
      </p>
      <p className="font-display mt-1 text-3xl tracking-tight">{title}</p>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className="bg-accent/40 mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        aria-hidden="true"
      />
      <span>{children}</span>
    </li>
  );
}

function NetRow({
  type,
  days,
  terms,
  bucket,
}: {
  type: string;
  days: number;
  terms: number;
  bucket: string;
}) {
  const past = Math.max(0, days - terms);
  return (
    <tr className="border-border last:border-b-0 border-b">
      <td className="px-4 py-3">
        <span className="text-text-primary font-medium">{type}</span>
        <span className="text-text-muted ml-2 text-xs">Net {terms}</span>
      </td>
      <td className="text-text-secondary px-4 py-3">{days} days ago</td>
      <td className="px-4 py-3 text-right tabular-nums">
        {past === 0 ? <span className="text-text-muted">—</span> : <span>{past}</span>}
      </td>
      <td className="px-4 py-3">
        <span
          className={
            bucket === 'Within terms'
              ? 'text-text-muted'
              : bucket === '60+ past'
                ? 'text-heat-critical font-medium'
                : 'text-heat-warm font-medium'
          }
        >
          {bucket}
        </span>
      </td>
    </tr>
  );
}

function ReportExplainer({
  icon: Icon,
  cadence,
  title,
  question,
  summary,
  tiles,
}: {
  icon: typeof AlertTriangle;
  cadence: string;
  title: string;
  question: string;
  summary: string;
  tiles: Array<{ label: string; meaning: string }>;
}) {
  return (
    <div className="bg-bg-card border-border rounded-[var(--radius-card)] border p-8">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[2fr_3fr]">
        <div>
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
          <p className="text-accent mt-3 text-sm font-medium italic">{question}</p>
          <p className="text-text-secondary mt-4 leading-relaxed">{summary}</p>
        </div>
        <div className="space-y-3">
          <p className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
            What each tile shows
          </p>
          <ul className="border-border divide-border divide-y border-y">
            {tiles.map((t) => (
              <li
                key={t.label}
                className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 py-3"
              >
                <span className="text-text-primary text-sm font-medium whitespace-nowrap">
                  {t.label}
                </span>
                <span className="text-text-secondary text-sm leading-relaxed">{t.meaning}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function HeatBandCard({
  band,
  range,
  meaning,
  color,
}: {
  band: string;
  range: string;
  meaning: string;
  color: string;
}) {
  return (
    <div className="bg-bg-card border-border rounded-[var(--radius-card)] border p-5">
      <div className="flex items-center gap-3">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
        <p className="font-display text-text-primary text-lg font-medium tracking-tight">
          {band}
        </p>
        <span className="text-text-muted ml-auto text-xs tabular-nums">{range}</span>
      </div>
      <p className="text-text-secondary mt-2 text-sm leading-relaxed">{meaning}</p>
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
