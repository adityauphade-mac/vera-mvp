import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ClipboardCheck,
  Filter,
  GaugeCircle,
  Home,
  ListChecks,
  Search,
  Trophy,
  X,
} from 'lucide-react';
import {
  AgingChip,
  AnomalyTag,
  BarChart,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  DonutChart,
  HeatMeter,
  HeatScoreBadge,
  MetricTile,
  MissingStepTag,
  Table,
  TableCell,
  TableHead,
  TableRow,
  TableShell,
  Tooltip,
  VeraQuote,
} from '@vera/ui';
import {
  DesignDemo,
  PaginationDemo,
  TableWithPaginationDemo,
  FilterMenuDemo,
  TabsDemo,
  ToastModalDemo,
  InfiniteScrollDemo,
} from './_demo';
import { PageNav } from '../_components/PageNav';

const SECTIONS = [
  { id: 'foundations', label: 'Foundations' },
  { id: 'voice', label: 'Voice' },
  { id: 'metrics', label: 'Metric tiles' },
  { id: 'heat', label: 'Heat — meters & badges' },
  { id: 'charts', label: 'Charts' },
  { id: 'tags', label: 'Chips & tags' },
  { id: 'buttons', label: 'Buttons' },
  { id: 'cards', label: 'Cards' },
  { id: 'tables', label: 'Tables' },
  { id: 'pagination', label: 'Pagination' },
  { id: 'filters', label: 'Filter menu' },
  { id: 'tabs', label: 'Tabs' },
  { id: 'toasts-modals', label: 'Toasts & modals' },
  { id: 'infinite-scroll', label: 'Infinite scroll' },
  { id: 'empty', label: 'Empty states' },
  { id: 'tooltips', label: 'Tooltips' },
  { id: 'overlays', label: 'Modals & sheets' },
  { id: 'icons', label: 'Iconography' },
  { id: 'animations', label: 'Animations' },
];

export default function DesignSystemPreview() {
  return (
    <main className="bg-bg-base min-h-screen">
      {/* Top bar — outside the dashboard chrome */}
      <header className="border-border bg-bg-base/85 sticky top-0 z-30 flex h-[72px] items-center justify-between border-b px-8 backdrop-blur">
        <div>
          <p className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
            Internal · Vera UI
          </p>
          <p className="font-display text-xl tracking-tight">Design system</p>
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
              Vera, in pieces.
            </p>
            <h1 className="font-display text-5xl tracking-tight md:text-6xl">
              Every component, every state.
            </h1>
            <p className="text-text-secondary max-w-2xl text-lg leading-relaxed">
              The whole design system on one page so the warm-fintech voice stays
              honest as the dashboard grows. Tokens, typography, primitives, charts,
              overlays — all live.
            </p>
          </header>

          {/* FOUNDATIONS */}
          <Section id="foundations" title="Foundations" subtitle="Tokens, palette, typography, spacing">
            <Subsection title="Color palette">
              <ColorRow
                title="Surfaces"
                swatches={[
                  ['bg-base', '#f5efe6', 'Page background'],
                  ['bg-card', '#fffcf7', 'Card surface'],
                  ['bg-elevated', '#ffffff', 'Modal / popover'],
                  ['bg-subtle', '#ece4d3', 'Hover / chrome'],
                ]}
              />
              <ColorRow
                title="Text"
                swatches={[
                  ['text-primary', '#1f1b16', 'Headlines, body'],
                  ['text-secondary', '#6e6258', 'Supporting copy'],
                  ['text-muted', '#9c8e80', 'Labels, hints'],
                ]}
              />
              <ColorRow
                title="Lines & accents"
                swatches={[
                  ['border', '#e8decf', 'Dividers, outlines'],
                  ['accent', '#c8854e', 'Primary action'],
                  ['accent-soft', '#e8c5a0', 'Accent on tint'],
                  ['success', '#7a8f6f', 'Positive states'],
                ]}
              />
              <ColorRow
                title="Heat bands"
                swatches={[
                  ['heat-cool', '#7a8f6f', '0–25 · Cool'],
                  ['heat-warm', '#c9a05f', '26–50 · Warm'],
                  ['heat-hot', '#c8714c', '51–75 · Hot'],
                  ['heat-critical', '#a14535', '76–100 · Critical'],
                ]}
              />
            </Subsection>

            <Subsection title="Typography">
              <Card>
                <div className="space-y-5">
                  <TypeRow label="Display · 5xl" className="font-display text-5xl tracking-tight">
                    Where each install actually stands
                  </TypeRow>
                  <TypeRow label="Display · 4xl" className="font-display text-4xl tracking-tight">
                    Who I&apos;d nudge today
                  </TypeRow>
                  <TypeRow label="Display · 2xl" className="font-display text-2xl tracking-tight">
                    606 McMackin Street
                  </TypeRow>
                  <TypeRow label="Body · lg" className="text-text-secondary text-lg">
                    A thoughtful companion for accounts receivable in the roofing business.
                  </TypeRow>
                  <TypeRow label="Body · base" className="text-text-primary text-base">
                    Insurance final check still missing — I&apos;d nudge Brandon today.
                  </TypeRow>
                  <TypeRow label="Body · sm" className="text-text-secondary text-sm">
                    Brandon Roberts · Dallas · Insurance · 47 days post-install
                  </TypeRow>
                  <TypeRow label="Caption · xs" className="text-text-muted text-xs">
                    Vera will draft a follow-up; nothing autosends.
                  </TypeRow>
                  <TypeRow label="Eyebrow · 0.65rem" className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
                    Daily · job milestone tracking
                  </TypeRow>
                </div>
              </Card>
            </Subsection>

            <Subsection title="Radii & shadows">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="bg-bg-card border-border rounded-[var(--radius-input)] border p-6 text-center">
                  <p className="font-display text-xl">0.75rem</p>
                  <p className="text-text-muted mt-1 text-xs uppercase tracking-[0.18em]">
                    radius-input
                  </p>
                </div>
                <div className="bg-bg-card border-border rounded-[var(--radius-card)] border p-6 text-center shadow-[0_2px_4px_-2px_rgba(31,27,22,0.04),0_4px_12px_-4px_rgba(31,27,22,0.05)]">
                  <p className="font-display text-xl">1.25rem</p>
                  <p className="text-text-muted mt-1 text-xs uppercase tracking-[0.18em]">
                    radius-card · soft shadow
                  </p>
                </div>
                <div className="bg-bg-card border-border rounded-full border px-6 py-6 text-center">
                  <p className="font-display text-xl">9999px</p>
                  <p className="text-text-muted mt-1 text-xs uppercase tracking-[0.18em]">
                    pill / chip
                  </p>
                </div>
              </div>
            </Subsection>
          </Section>

          {/* VERA QUOTE */}
          <Section id="voice" title="Vera's voice" subtitle="A thoughtful narrator, not a dashboard widget">
            <VeraQuote>
              Good morning. I&apos;m watching three jobs more closely than usual today —
              Mike Ahrend&apos;s McMackin install crossed into the Hot band overnight.
            </VeraQuote>
          </Section>

          {/* METRIC TILES */}
          <Section id="metrics" title="Metric tiles" subtitle="Headline numbers in three emphasis levels">
            <Subsection title="Emphasis variants — default, accent, critical">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <MetricTile
                  label="Total AR"
                  value="$1.42M"
                  hint="Across 130 installs"
                  tooltip="Sum of outstanding balances across every job currently in AR."
                />
                <MetricTile
                  label="Critical"
                  value="36"
                  emphasis="critical"
                  hint="Need executive eyes"
                  tooltip="Heat 76+ jobs that warrant a personal touch from the office."
                />
                <MetricTile
                  label="Hot"
                  value="28"
                  emphasis="accent"
                  hint="Vera will draft"
                  tooltip="Heat 51–75 jobs where Vera will draft a follow-up email to the rep."
                />
                <MetricTile label="Fell through" value="27" hint="Weekly sweep" />
              </div>
              <p className="text-text-muted mt-3 text-xs">
                Tiles in the same row stretch to a uniform height. <code>hint</code> always reserves space (renders an invisible spacer when omitted).
              </p>
            </Subsection>

            <Subsection title="Value type variants">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <MetricTile label="Currency" value="$1,278,629" hint="Total outstanding" />
                <MetricTile label="Integer" value={130} hint="Jobs in AR" />
                <MetricTile label="Compact" value="$496K" hint="Commissions YTD" />
                <MetricTile
                  label="Empty"
                  value={<span className="text-text-muted">—</span>}
                  hint="No data yet"
                />
              </div>
              <p className="text-text-muted mt-3 text-xs">
                <code>value</code> accepts any <code>ReactNode</code>: strings, numbers, or
                inline elements (badges, icons, em-dashes for empty states).
              </p>
            </Subsection>
          </Section>

          {/* HEAT */}
          <Section
            id="heat"
            title="Heat — meters & badges"
            subtitle="Two presentations of the composite score"
          >
            <Subsection title="HeatMeter · default">
              <Card>
                <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
                  <HeatMeter
                    score={18}
                    band="cool"
                    breakdown={{ daysComponent: 0, dollarComponent: 14, silenceComponent: 0, anomalyComponent: 4 }}
                  />
                  <HeatMeter
                    score={42}
                    band="warm"
                    breakdown={{ daysComponent: 12, dollarComponent: 20, silenceComponent: 5, anomalyComponent: 5 }}
                  />
                  <HeatMeter
                    score={65}
                    band="hot"
                    breakdown={{ daysComponent: 28, dollarComponent: 22, silenceComponent: 5, anomalyComponent: 10 }}
                  />
                  <HeatMeter
                    score={88}
                    band="critical"
                    breakdown={{ daysComponent: 38, dollarComponent: 25, silenceComponent: 15, anomalyComponent: 10 }}
                  />
                </div>
              </Card>
            </Subsection>

            <Subsection title="HeatMeter · compact (table-row variant)">
              <Card>
                <div className="space-y-3">
                  <HeatMeter
                    score={18}
                    band="cool"
                    breakdown={{ daysComponent: 0, dollarComponent: 14, silenceComponent: 0, anomalyComponent: 4 }}
                    variant="compact"
                  />
                  <HeatMeter
                    score={42}
                    band="warm"
                    breakdown={{ daysComponent: 12, dollarComponent: 20, silenceComponent: 5, anomalyComponent: 5 }}
                    variant="compact"
                  />
                  <HeatMeter
                    score={65}
                    band="hot"
                    breakdown={{ daysComponent: 28, dollarComponent: 22, silenceComponent: 5, anomalyComponent: 10 }}
                    variant="compact"
                  />
                  <HeatMeter
                    score={88}
                    band="critical"
                    breakdown={{ daysComponent: 38, dollarComponent: 25, silenceComponent: 15, anomalyComponent: 10 }}
                    variant="compact"
                  />
                </div>
              </Card>
            </Subsection>

            <Subsection title="HeatScoreBadge · two sizes">
              <div className="flex flex-wrap items-center gap-3">
                <HeatScoreBadge score={18} band="cool" size="sm" />
                <HeatScoreBadge score={42} band="warm" size="sm" />
                <HeatScoreBadge score={65} band="hot" size="sm" />
                <HeatScoreBadge score={88} band="critical" size="sm" />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <HeatScoreBadge score={18} band="cool" />
                <HeatScoreBadge score={42} band="warm" />
                <HeatScoreBadge score={65} band="hot" />
                <HeatScoreBadge score={88} band="critical" />
              </div>
            </Subsection>
          </Section>

          {/* CHARTS */}
          <Section id="charts" title="Charts" subtitle="Pure SVG, no Recharts dep">
            <Subsection title="BarChart · horizontal">
              <Card>
                <BarChart
                  data={[
                    { label: 'Within terms', value: 18, color: 'var(--color-text-muted)' },
                    { label: '1–30 past', value: 32, color: 'var(--color-heat-warm)', hint: '$72,400' },
                    { label: '31–60 past', value: 44, color: 'var(--color-heat-hot)', hint: '$324,200' },
                    { label: '60+ past', value: 36, color: 'var(--color-heat-critical)', hint: '$754,000' },
                  ]}
                  format={(n) => `${n} jobs`}
                />
              </Card>
            </Subsection>

            <Subsection title="DonutChart">
              <Card>
                <DonutChart
                  data={[
                    { label: 'Cool', value: 22, color: 'var(--color-heat-cool)' },
                    { label: 'Warm', value: 44, color: 'var(--color-heat-warm)' },
                    { label: 'Hot', value: 28, color: 'var(--color-heat-hot)' },
                    { label: 'Critical', value: 36, color: 'var(--color-heat-critical)' },
                  ]}
                  centerLabel="In AR"
                  centerValue="130"
                  format={(n) => `${n} jobs`}
                />
              </Card>
            </Subsection>
          </Section>

          {/* CHIPS & TAGS */}
          <Section id="tags" title="Chips & tags" subtitle="Aging buckets, missing milestones, anomaly flags">
            <Subsection title="Aging buckets">
              <div className="flex flex-wrap gap-2">
                <AgingChip bucket="within-terms" />
                <AgingChip bucket="1-30-past" />
                <AgingChip bucket="31-60-past" />
                <AgingChip bucket="60-plus-past" />
              </div>
            </Subsection>

            <Subsection title="Missing-step tags">
              <div className="flex flex-wrap gap-2">
                <MissingStepTag label="cert of completion" />
                <MissingStepTag label="final check" />
                <MissingStepTag label="commission request" />
              </div>
            </Subsection>

            <Subsection title="Anomaly tags · all 9 flags">
              <div className="flex flex-wrap gap-2">
                <AnomalyTag flag="balance-exceeds-price" />
                <AnomalyTag flag="no-cert-of-completion" />
                <AnomalyTag flag="insurance-final-check-stuck" />
                <AnomalyTag flag="retail-no-payment" />
                <AnomalyTag flag="duplicate-address" />
                <AnomalyTag flag="no-commission-request" />
                <AnomalyTag flag="impossible-payments" />
                <AnomalyTag flag="archived-with-balance" />
                <AnomalyTag flag="warranty-voided-with-balance" />
              </div>
            </Subsection>
          </Section>

          {/* BUTTONS */}
          <Section id="buttons" title="Buttons" subtitle="Four variants, four sizes">
            <Subsection title="Variants">
              <div className="flex flex-wrap items-center gap-3">
                <Button>Generate digest</Button>
                <Button variant="secondary">Open job</Button>
                <Button variant="ghost">Dismiss</Button>
                <Button variant="link">Read the spec</Button>
                <Button disabled>Disabled</Button>
              </div>
            </Subsection>

            <Subsection title="Sizes">
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm">Small</Button>
                <Button size="md">Medium</Button>
                <Button size="lg">Large</Button>
                <Button size="icon" aria-label="icon">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </div>
            </Subsection>
          </Section>

          {/* CARDS */}
          <Section id="cards" title="Cards" subtitle="Plain, with header, and richly composed">
            <Subsection title="Plain card">
              <Card>
                <p className="text-text-secondary">
                  A plain Card just gives content the warm cream surface, the soft border,
                  and the generous padding.
                </p>
              </Card>
            </Subsection>

            <Subsection title="Card with header">
              <Card>
                <CardHeader>
                  <CardTitle>Heat distribution</CardTitle>
                  <CardDescription>How the 130 active AR jobs split across the four heat bands today.</CardDescription>
                </CardHeader>
                <p className="text-text-secondary text-sm">
                  Cool 22 · Warm 44 · Hot 28 · Critical 36. Critical accounts for $711K of
                  the $1.42M outstanding.
                </p>
              </Card>
            </Subsection>

            <Subsection title="Job card · rich composition">
              <Card>
                <CardHeader>
                  <CardTitle>606 McMackin Street</CardTitle>
                  <CardDescription>Brandon Roberts · Dallas · Insurance</CardDescription>
                </CardHeader>
                <div className="flex flex-wrap items-center gap-3">
                  <AgingChip bucket="31-60-past" />
                  <MissingStepTag label="final check" />
                  <MissingStepTag label="commission request" />
                </div>
                <div className="mt-4">
                  <HeatMeter
                    score={72}
                    band="hot"
                    breakdown={{ daysComponent: 30, dollarComponent: 22, silenceComponent: 10, anomalyComponent: 10 }}
                  />
                </div>
                <p className="text-text-secondary mt-4 text-sm">
                  $14,995 outstanding · install was 47 days ago. Insurance final check still
                  missing — I&apos;d nudge Brandon today.
                </p>
                <div className="mt-5 flex gap-2">
                  <Button size="sm">Draft email</Button>
                  <Button size="sm" variant="secondary">Open job</Button>
                </div>
              </Card>
            </Subsection>
          </Section>

          {/* TABLES */}
          <Section id="tables" title="Tables" subtitle="TableShell, sticky head, footer slot">
            <TableShell maxHeight={320}>
              <Table>
                <TableHead
                  columns={[
                    { key: 'job', label: 'Job', tooltip: 'Address and classification.' },
                    { key: 'rep', label: 'Rep', width: '160px' },
                    { key: 'balance', label: 'Balance', align: 'right', width: '120px' },
                    { key: 'aging', label: 'Aging', width: '120px' },
                    { key: 'heat', label: 'Heat', align: 'right', width: '180px' },
                  ]}
                />
                <tbody>
                  {[
                    {
                      job: '606 McMackin Street',
                      sub: 'Dallas · Insurance',
                      rep: 'Brandon Roberts',
                      bal: '$14,995',
                      bucket: '31-60-past' as const,
                      heat: { score: 72, band: 'hot' as const },
                    },
                    {
                      job: '224 Roy Rogers Lane',
                      sub: 'Shreveport · Insurance',
                      rep: 'Clemente Mandujano',
                      bal: '$5,333',
                      bucket: '60-plus-past' as const,
                      heat: { score: 88, band: 'critical' as const },
                    },
                    {
                      job: '1487 Streamside Drive',
                      sub: 'Dallas · Retail',
                      rep: 'Hernan Cubillos',
                      bal: '$6,201',
                      bucket: '1-30-past' as const,
                      heat: { score: 42, band: 'warm' as const },
                    },
                  ].map((r) => (
                    <TableRow key={r.job}>
                      <TableCell>
                        <p className="text-text-primary font-medium">{r.job}</p>
                        <p className="text-text-muted mt-0.5 text-xs">{r.sub}</p>
                      </TableCell>
                      <TableCell className="text-text-secondary">{r.rep}</TableCell>
                      <TableCell align="right" className="tabular-nums">{r.bal}</TableCell>
                      <TableCell>
                        <AgingChip bucket={r.bucket} />
                      </TableCell>
                      <TableCell align="right">
                        <div className="flex justify-end">
                          <HeatMeter
                            score={r.heat.score}
                            band={r.heat.band}
                            breakdown={{ daysComponent: 28, dollarComponent: 22, silenceComponent: 5, anomalyComponent: 10 }}
                            variant="compact"
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </tbody>
              </Table>
            </TableShell>
          </Section>

          {/* PAGINATION */}
          <Section id="pagination" title="Pagination" subtitle="TablePagination — rows-per-page dropdown, ellipsis, prev/next">
            <Subsection title="Standalone — short list (≤5 pages)">
              <Card>
                <PaginationDemo total={68} initialPageSize={25} />
              </Card>
              <p className="text-text-muted mt-2 text-xs">
                With 5 or fewer pages, every page number renders. No ellipsis.
              </p>
            </Subsection>

            <Subsection title="Standalone — long list (ellipsis kicks in)">
              <Card>
                <PaginationDemo total={4280} initialPageSize={25} />
              </Card>
              <p className="text-text-muted mt-2 text-xs">
                Past 5 pages: <code>1 … (n−1) n (n+1) … last</code>. The rows-per-page
                dropdown opens upward and supports 10 / 25 / 50 / 100.
              </p>
            </Subsection>

            <Subsection title="Integrated — TableShell footer slot">
              <TableWithPaginationDemo />
              <p className="text-text-muted mt-2 text-xs">
                Pass a <code>TablePagination</code> into <code>TableShell.footer</code> to get
                the unified card chrome. Used on Aging, Milestones, Reconciliation, and Rep
                Leaderboard.
              </p>
            </Subsection>
          </Section>

          {/* FILTER MENU */}
          <Section id="filters" title="Filter menu" subtitle="FilterMenu + TableToolbar — chip groups and searchable dropdowns">
            <Subsection title="Live — open and try it">
              <FilterMenuDemo />
              <p className="text-text-muted mt-2 text-xs">
                Both the popover and the inner Rep dropdown render to <code>document.body</code>{' '}
                so they escape every overflow / stacking trap. Marked with{' '}
                <code>data-filter-popover</code> so the click-outside handler keeps them
                grouped.
              </p>
            </Subsection>

            <Subsection title="Trigger states">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="border-border text-text-secondary hover:bg-bg-base hover:text-text-primary inline-flex h-9 items-center gap-2 rounded-full border bg-transparent px-3.5 text-sm font-medium transition-colors"
                >
                  <Filter className="h-3.5 w-3.5" />
                  Filter
                </button>
                <button
                  type="button"
                  className="border-accent text-accent inline-flex h-9 items-center gap-2 rounded-full border bg-transparent px-3.5 text-sm font-medium"
                >
                  <Filter className="h-3.5 w-3.5" />
                  Filter
                  <span className="bg-accent ml-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[0.65rem] font-semibold text-white tabular-nums">
                    3
                  </span>
                </button>
              </div>
              <p className="text-text-muted mt-2 text-xs">
                Default · with active filter count.
              </p>
            </Subsection>
          </Section>

          {/* TABS */}
          <Section
            id="tabs"
            title="Tabs"
            subtitle="Shared underline-style tabs · used on Scheduler + Follow-ups"
          >
            <TabsDemo />
            <p className="text-text-muted mt-2 text-xs">
              Use <code>Tabs / TabsList / Tab / TabsContent</code> from{' '}
              <code>@vera/ui</code>. Controlled (pass <code>value</code> +{' '}
              <code>onValueChange</code> — e.g. wired to a <code>useQueryState</code>) or
              uncontrolled (just <code>defaultValue</code>). Underline is{' '}
              <code>border-accent</code> with primary text on the active tab; idle tabs are
              secondary. ARIA roles wired correctly — keyboard navigation works.
            </p>
          </Section>

          {/* TOASTS + MODALS */}
          <Section
            id="toasts-modals"
            title="Toasts & confirm modals"
            subtitle="Transient feedback + replacement for window.confirm()"
          >
            <ToastModalDemo />
            <p className="text-text-muted mt-2 text-xs">
              <code>toast()</code> and <code>useConfirm()</code> from{' '}
              <code>@vera/ui</code>. Sonner-backed, themed in{' '}
              <code>globals.css</code> under <code>[data-sonner-toaster]</code> with Vera
              tokens. Five toast states share the modal chrome but use{' '}
              <strong>distinct silhouettes</strong> (filled circle / octagon / triangle /
              rounded square / arc) so users tell info vs error apart by shape, not just
              color. Info is the one cool tone in the palette — slate blue{' '}
              <code>--color-info</code>.
            </p>
            <p className="text-text-muted mt-3 text-xs">
              Two modal flavors share visual chrome (centered, bg-card, rounded card
              radius, p-7, shadow) but differ in layout:
            </p>
            <ul className="text-text-muted mt-1 list-none space-y-2 text-xs leading-relaxed">
              <li>
                <strong className="text-text-primary">
                  &lt;Modal&gt; — content surface, no icon.
                </strong>{' '}
                Big <code>font-display</code> title, body owns the layout. Use for chat
                (Ask Vera), info dialogs, custom forms. See <em>Modals &amp; sheets</em>{' '}
                below for the canonical example.
              </li>
              <li>
                <strong className="text-text-primary">
                  &lt;ConfirmDialog&gt; — action confirmation, with icon.
                </strong>{' '}
                Icon block + title rendered in <strong>uppercase eyebrow typography</strong>{' '}
                (imperative, not a question — &quot;Cancel this run&quot;, not &quot;Cancel
                this run?&quot;) + description as the body, left-aligned. Use via{' '}
                <code>useConfirm()</code>.
              </li>
            </ul>
          </Section>

          {/* INFINITE SCROLL */}
          <Section
            id="infinite-scroll"
            title="Infinite scroll"
            subtitle="Card-list pagination via IntersectionObserver"
          >
            <InfiniteScrollDemo />
            <p className="text-text-muted mt-2 text-xs">
              Sentinel below the list with <code>IntersectionObserver(rootMargin: 320px)</code>{' '}
              bumps a local <code>visibleCount</code> by chunk size as it scrolls into view.
              Footer reads &quot;Showing X of Y · scroll to load more&quot; while loading,
              &quot;All N loaded&quot; once done.
            </p>
          </Section>

          {/* EMPTY STATES */}
          <Section id="empty" title="Empty states" subtitle="What we show when filters or queries return nothing">
            <Subsection title="No filter matches">
              <Card>
                <p className="text-text-secondary">
                  No jobs match the current filters.
                </p>
              </Card>
            </Subsection>

            <Subsection title="Queue is clear">
              <Card>
                <p className="text-text-secondary">
                  Executive queue is clear in this view. Nothing has crossed the Critical threshold.
                  Try clearing filters.
                </p>
              </Card>
            </Subsection>

            <Subsection title="Reconciliation — clean board">
              <Card>
                <p className="text-text-secondary">
                  Nothing fell through this week. Every completed install has at least one
                  fresh signal — paperwork, an endorsed check, a commission request, or a
                  recent edit.
                </p>
              </Card>
            </Subsection>
          </Section>

          {/* TOOLTIPS */}
          <Section id="tooltips" title="Tooltips" subtitle="Portaled — escape every overflow / stacking trap">
            <div className="flex flex-wrap items-center gap-6">
              <Tooltip content="Top tooltips render above the trigger.">
                <span className="text-accent cursor-help underline-offset-4 underline decoration-dotted">
                  Hover me · top
                </span>
              </Tooltip>
              <Tooltip content="Bottom tooltips render below the trigger." side="bottom">
                <span className="text-accent cursor-help underline-offset-4 underline decoration-dotted">
                  Hover me · bottom
                </span>
              </Tooltip>
              <Tooltip
                content={
                  <span className="block">
                    <span className="block font-semibold">Rich content allowed:</span>
                    <span className="mt-1 block text-white/80">
                      icons, multi-line, even small lists.
                    </span>
                  </span>
                }
              >
                <Button size="sm" variant="secondary">
                  Rich tooltip
                </Button>
              </Tooltip>
            </div>
          </Section>

          {/* MODALS & SHEETS */}
          <Section id="overlays" title="Modals & sheets" subtitle="Right-side sheet and centered modal">
            <DesignDemo />
          </Section>

          {/* ICONOGRAPHY */}
          <Section id="icons" title="Iconography" subtitle="lucide-react · sized at h-4 / h-3.5">
            <Card>
              <div className="grid grid-cols-2 gap-y-5 sm:grid-cols-4 lg:grid-cols-6">
                {[
                  { Icon: Home, name: 'Home' },
                  { Icon: AlertTriangle, name: 'AlertTriangle' },
                  { Icon: ListChecks, name: 'ListChecks' },
                  { Icon: GaugeCircle, name: 'GaugeCircle' },
                  { Icon: Trophy, name: 'Trophy' },
                  { Icon: ClipboardCheck, name: 'ClipboardCheck' },
                  { Icon: Filter, name: 'Filter' },
                  { Icon: Search, name: 'Search' },
                  { Icon: ChevronDown, name: 'ChevronDown' },
                  { Icon: ArrowLeft, name: 'ArrowLeft' },
                  { Icon: ArrowRight, name: 'ArrowRight' },
                  { Icon: Check, name: 'Check' },
                  { Icon: X, name: 'X' },
                ].map(({ Icon, name }) => (
                  <div key={name} className="flex flex-col items-center gap-2">
                    <span className="bg-bg-base border-border text-text-primary inline-flex h-10 w-10 items-center justify-center rounded-full border">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="text-text-muted text-[0.65rem] tracking-[0.05em]">
                      {name}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
            <p className="text-text-muted mt-2 text-xs">
              Conventions: <code>h-4 w-4</code> in nav and tile chrome,{' '}
              <code>h-3.5 w-3.5</code> for inline button icons,{' '}
              <code>h-3 w-3</code> for tiny chip glyphs. Icon color usually inherits from
              the surrounding text color.
            </p>
          </Section>

          {/* ANIMATIONS */}
          <Section id="animations" title="Animations" subtitle="Entrance and attention utilities">
            <Card>
              <div className="grid grid-cols-1 divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
                <div className="space-y-3 px-2 py-3 md:px-6 md:py-4">
                  <p className="text-text-muted text-[0.65rem] font-semibold tracking-[0.18em] uppercase">
                    Entrance
                  </p>
                  <AnimRow
                    name="vera-rise"
                    note="Fade + 8px translateY on load. The default for hero, headers, sections."
                  />
                  <AnimRow
                    name="vera-rise-delay-1 / -2 / -3"
                    note="Same as vera-rise with 80 / 160 / 240ms stagger."
                  />
                  <AnimRow
                    name="vera-modal-in"
                    note="translateY 8px + scale 0.96 → 1, 220ms. Used by the centered modal."
                  />
                  <AnimRow
                    name="vera-sheet-in / vera-backdrop-in"
                    note="Slide-from-right + cross-fade for right-side sheets and the backdrop."
                  />
                </div>
                <div className="space-y-3 px-2 py-3 md:px-6 md:py-4">
                  <p className="text-text-muted text-[0.65rem] font-semibold tracking-[0.18em] uppercase">
                    Attention
                  </p>
                  <AnimRow
                    name="vera-fab-pulse"
                    note="Continuous box-shadow pulse on the Ask Vera FAB."
                  />
                  <AnimRow
                    name="vera-callout-in"
                    note="Tooltip-callout for the FAB on first appearance."
                  />
                  <p className="text-text-muted pt-3 text-xs leading-relaxed">
                    All animations honor <code>prefers-reduced-motion</code> — if the user has
                    reduced motion enabled, entrance and attention animations are
                    suppressed.
                  </p>
                </div>
              </div>
            </Card>
          </Section>

          <p className="text-text-muted py-10 text-center text-xs">
            That&apos;s every public component. Add new ones to <code>shared/ui/src/components</code>{' '}
            and surface a section here.
          </p>
        </div>
      </div>
    </main>
  );
}

function Section({
  id,
  title,
  subtitle,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="space-y-6 vera-rise-delay-1 scroll-mt-24">
      <div className="border-border border-b pb-3">
        <p className="text-text-muted text-[0.65rem] font-semibold tracking-[0.18em] uppercase">
          {title}
        </p>
        {subtitle ? (
          <p className="font-display mt-1 text-2xl tracking-tight">{subtitle}</p>
        ) : null}
      </div>
      <div className="space-y-8">{children}</div>
    </section>
  );
}

function Subsection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-text-secondary text-xs font-medium tracking-[0.12em] uppercase">
        {title}
      </h3>
      {children}
    </div>
  );
}

function ColorRow({
  title,
  swatches,
}: {
  title: string;
  swatches: Array<[string, string, string]>;
}) {
  return (
    <Card>
      <p className="text-text-muted mb-4 text-[0.65rem] font-semibold tracking-[0.18em] uppercase">
        {title}
      </p>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {swatches.map(([token, hex, note]) => (
          <div key={token} className="space-y-2">
            <div
              className="border-border h-16 rounded-xl border"
              style={{ background: hex }}
              aria-hidden="true"
            />
            <div className="space-y-0.5">
              <p className="text-text-primary text-sm font-medium">{token}</p>
              <p className="text-text-muted font-mono text-xs uppercase">{hex}</p>
              <p className="text-text-muted text-xs">{note}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function TypeRow({
  label,
  className,
  children,
}: {
  label: string;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-border flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b pb-4 last:border-0 last:pb-0">
      <p className="text-text-muted w-32 shrink-0 text-[0.65rem] font-semibold tracking-[0.18em] uppercase">
        {label}
      </p>
      <p className={className}>{children}</p>
    </div>
  );
}

function AnimRow({ name, note }: { name: string; note: string }) {
  return (
    <div>
      <p className="text-text-primary font-mono text-xs">{name}</p>
      <p className="text-text-secondary mt-1 text-xs leading-relaxed">{note}</p>
    </div>
  );
}
