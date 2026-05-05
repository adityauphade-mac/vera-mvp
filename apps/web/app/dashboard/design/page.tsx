import {
  AgingChip,
  AnomalyTag,
  BarChart,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  HeatMeter,
  MetricTile,
  MissingStepTag,
  VeraQuote,
} from '@vera/ui';

export default function DesignSystemPreview() {
  return (
    <main className="bg-bg-base min-h-screen px-8 py-16">
      <div className="mx-auto max-w-5xl space-y-16">
        <header className="space-y-3 vera-rise">
          <p className="text-text-muted text-xs tracking-wider uppercase">
            Internal · Design system preview
          </p>
          <h1 className="text-5xl font-medium tracking-tight">Vera, in pieces.</h1>
          <p className="text-text-secondary max-w-2xl text-lg">
            Every component lives here in every state, so we can keep the warm fintech
            language honest as the dashboard grows.
          </p>
        </header>

        <Section title="Vera's voice">
          <VeraQuote>
            Good morning. I&apos;m watching three jobs more closely than usual today —
            Mike Ahrend&apos;s McMackin install crossed into the Hot band overnight.
          </VeraQuote>
        </Section>

        <Section title="Metric tiles">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <MetricTile label="Total AR" value="$1.42M" hint="Across 130 installs" />
            <MetricTile label="Critical" value="36" emphasis="critical" hint="Need executive eyes" />
            <MetricTile label="Hot" value="28" emphasis="accent" hint="Vera will draft" />
            <MetricTile label="Fell through" value="27" hint="Weekly sweep" />
          </div>
        </Section>

        <Section title="Heat meter — every band">
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
        </Section>

        <Section title="Bar chart">
          <Card>
            <BarChart
              data={[
                { label: 'Within terms', value: 18, color: 'var(--color-text-muted)' },
                { label: '1–30 past', value: 32, color: 'var(--color-heat-warm)' },
                { label: '31–60 past', value: 44, color: 'var(--color-heat-hot)' },
                { label: '60+ past', value: 36, color: 'var(--color-heat-critical)' },
              ]}
            />
          </Card>
        </Section>

        <Section title="Aging buckets">
          <div className="flex flex-wrap gap-2">
            <AgingChip bucket="within-terms" />
            <AgingChip bucket="1-30-past" />
            <AgingChip bucket="31-60-past" />
            <AgingChip bucket="60-plus-past" />
          </div>
        </Section>

        <Section title="Missing-step tags">
          <div className="flex flex-wrap gap-2">
            <MissingStepTag label="cert of completion" />
            <MissingStepTag label="final check" />
            <MissingStepTag label="commission request" />
          </div>
        </Section>

        <Section title="Anomaly tags">
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
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap gap-3">
            <Button>Generate weekly digest</Button>
            <Button variant="secondary">Open job</Button>
            <Button variant="ghost">Dismiss</Button>
            <Button variant="link">Read the spec</Button>
            <Button size="sm">Small</Button>
            <Button size="lg">Large</Button>
          </div>
        </Section>

        <Section title="Card composition">
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
          </Card>
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 vera-rise-delay-1">
      <h2 className="text-text-secondary text-sm tracking-wider uppercase">{title}</h2>
      {children}
    </section>
  );
}
