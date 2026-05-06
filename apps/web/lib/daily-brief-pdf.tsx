import 'server-only';
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Svg,
  Rect,
  renderToBuffer,
} from '@react-pdf/renderer';
import type { DailyBriefData } from '@vera/domain';

/**
 * AR brief PDF — three cadences (daily / weekly / monthly).
 *
 * The header title, subtitle, KPI tiles, headline quote, and section ordering
 * all switch on `data.cadence`. The same warm-CRED palette is shared so the
 * three reports feel like the same product.
 *
 * react-pdf renders to a Buffer in-process; serverless-safe.
 */

const COLORS = {
  bg: '#FAF6EE',
  card: '#FFFFFF',
  text: '#1F1B16',
  secondary: '#5A4F40',
  muted: '#8A7E6E',
  border: '#E5DDD0',
  accent: '#B85C2A',
  warm: '#D9A86A',
  hot: '#C7793E',
  critical: '#A04432',
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 44,
    paddingHorizontal: 36,
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: COLORS.text,
    backgroundColor: COLORS.bg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 14,
    paddingBottom: 10,
    borderBottom: `1pt solid ${COLORS.border}`,
  },
  brand: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: -0.4,
  },
  brandSub: {
    fontSize: 8,
    color: COLORS.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    marginBottom: 2,
  },
  date: {
    fontSize: 9,
    color: COLORS.secondary,
  },
  sectionLabel: {
    fontSize: 8,
    color: COLORS.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    marginBottom: 6,
    marginTop: 12,
  },
  // KPI tiles
  kpiRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  kpi: {
    flex: 1,
    backgroundColor: COLORS.card,
    border: `1pt solid ${COLORS.border}`,
    borderRadius: 6,
    padding: 9,
  },
  kpiLabel: {
    fontSize: 7,
    color: COLORS.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  kpiValue: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.text,
  },
  kpiHint: {
    fontSize: 7,
    color: COLORS.muted,
    marginTop: 3,
  },
  card: {
    backgroundColor: COLORS.card,
    border: `1pt solid ${COLORS.border}`,
    borderRadius: 6,
    padding: 12,
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 6,
  },
  cardSubtitle: {
    fontSize: 8,
    color: COLORS.muted,
    marginBottom: 6,
  },
  // Bar chart
  bar: {
    height: 14,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  barLabel: {
    width: 80,
    fontSize: 8,
    color: COLORS.secondary,
  },
  barTrack: {
    flex: 1,
    height: 8,
    backgroundColor: '#F0E8D8',
    borderRadius: 4,
    marginRight: 6,
    position: 'relative',
  },
  barValue: {
    width: 90,
    fontSize: 8,
    color: COLORS.text,
    textAlign: 'right',
  },
  // Tables
  table: {
    marginTop: 4,
  },
  tHead: {
    flexDirection: 'row',
    paddingVertical: 4,
    borderBottom: `1pt solid ${COLORS.border}`,
  },
  tRow: {
    flexDirection: 'row',
    paddingVertical: 3,
    borderBottom: `0.5pt solid ${COLORS.border}`,
    alignItems: 'center',
  },
  tCell: {
    fontSize: 8,
  },
  tCellH: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  // Close-out checklist
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 6,
    borderBottom: `0.5pt solid ${COLORS.border}`,
  },
  checkBox: {
    width: 9,
    height: 9,
    borderRadius: 2,
    border: `1pt solid ${COLORS.accent}`,
    marginRight: 8,
    marginTop: 2,
  },
  checkBody: {
    flex: 1,
  },
  checkTitle: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.text,
    marginBottom: 2,
  },
  checkAsk: {
    fontSize: 8,
    color: COLORS.secondary,
    lineHeight: 1.35,
  },
  checkMeta: {
    fontSize: 8,
    color: COLORS.muted,
    width: 110,
    textAlign: 'right',
  },
  // Footer
  footer: {
    position: 'absolute',
    bottom: 18,
    left: 36,
    right: 36,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7,
    color: COLORS.muted,
  },
  veraQuote: {
    fontSize: 9,
    fontStyle: 'italic',
    color: COLORS.secondary,
    paddingLeft: 8,
    borderLeft: `2pt solid ${COLORS.accent}`,
    marginBottom: 12,
  },
  // Full-job list (page 2+) — flat, no card wrapper, so page breaks are clean.
  flatTable: {
    marginTop: 4,
  },
  flatHeader: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottom: `1pt solid ${COLORS.border}`,
    backgroundColor: COLORS.card,
  },
  flatRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    borderBottom: `0.5pt solid ${COLORS.border}`,
    alignItems: 'center',
    backgroundColor: COLORS.card,
  },
});

function fmtUSD(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function bucketColor(bucket: string): string {
  if (bucket === '60+ days past') return COLORS.critical;
  if (bucket === '31–60 days past') return COLORS.hot;
  if (bucket === '1–30 days past') return COLORS.warm;
  return COLORS.muted;
}

function BriefHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <View style={styles.header} fixed>
      <View>
        <Text style={styles.brandSub}>Vera · Lead AR Intelligence</Text>
        <Text style={styles.brand}>{title}</Text>
      </View>
      <Text style={styles.date}>{subtitle}</Text>
    </View>
  );
}

function BriefFooter() {
  return (
    <View style={styles.footer} fixed>
      <Text>Vera Calloway · Priority Roofs</Text>
      <Text
        render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
      />
    </View>
  );
}

function KPI({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: 'critical' | 'accent' | 'default';
}) {
  const valueColor =
    emphasis === 'critical'
      ? COLORS.critical
      : emphasis === 'accent'
        ? COLORS.accent
        : COLORS.text;
  return (
    <View style={styles.kpi}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={[styles.kpiValue, { color: valueColor }]}>{value}</Text>
      {hint ? <Text style={styles.kpiHint}>{hint}</Text> : null}
    </View>
  );
}

function BucketChart({
  buckets,
}: {
  buckets: DailyBriefData['bucketSummary'];
}) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <View style={styles.card} wrap={false}>
      <Text style={styles.cardTitle}>Where things stand</Text>
      {buckets.map((b) => {
        const widthPct = `${Math.round((b.count / max) * 100)}%`;
        return (
          <View key={b.bucket} style={styles.bar}>
            <Text style={styles.barLabel}>{b.label}</Text>
            <View style={styles.barTrack}>
              <Svg width="100%" height="8">
                <Rect
                  x="0"
                  y="0"
                  width={widthPct}
                  height="8"
                  fill={bucketColor(b.label)}
                  rx="2"
                />
              </Svg>
            </View>
            <Text style={styles.barValue}>
              {b.count} {b.count === 1 ? 'job' : 'jobs'} · {fmtUSD(b.total)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function CloseOutCard({
  rows,
}: {
  rows: DailyBriefData['closeOutItems'];
}) {
  if (rows.length === 0) return null;
  return (
    <View style={styles.card} wrap={false}>
      <Text style={styles.cardTitle}>Close-out checklist</Text>
      <Text style={styles.cardSubtitle}>
        Stuck items to clear before the books close.
      </Text>
      {rows.map((c) => (
        <View key={c.flag} style={styles.checkRow} wrap={false}>
          <View style={styles.checkBox} />
          <View style={styles.checkBody}>
            <Text style={styles.checkTitle}>{c.label}</Text>
            <Text style={styles.checkAsk}>{c.ask}</Text>
          </View>
          <Text style={styles.checkMeta}>
            {c.count} {c.count === 1 ? 'job' : 'jobs'}
            {'\n'}
            {fmtUSD(c.totalBalance)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function WeekSlippedCard({
  rows,
}: {
  rows: DailyBriefData['weekHighlights'];
}) {
  if (rows.length === 0) return null;
  return (
    <View style={styles.card} wrap={false}>
      <Text style={styles.cardTitle}>Just slipped past terms this week</Text>
      <View style={styles.tHead}>
        <Text style={[styles.tCellH, { flex: 3 }]}>Address</Text>
        <Text style={[styles.tCellH, { flex: 2 }]}>Rep</Text>
        <Text style={[styles.tCellH, { flex: 1.3, textAlign: 'right' }]}>
          Balance
        </Text>
        <Text style={[styles.tCellH, { width: 50, textAlign: 'right' }]}>
          Days
        </Text>
      </View>
      {rows.map((j) => (
        <View key={j.id} style={styles.tRow} wrap={false}>
          <Text style={[styles.tCell, { flex: 3 }]}>{j.address}</Text>
          <Text style={[styles.tCell, { flex: 2 }]}>{j.rep}</Text>
          <Text style={[styles.tCell, { flex: 1.3, textAlign: 'right' }]}>
            {fmtUSD(j.balance)}
          </Text>
          <Text
            style={[
              styles.tCell,
              { width: 50, textAlign: 'right', color: COLORS.warm },
            ]}
          >
            {j.daysPastTerms}d
          </Text>
        </View>
      ))}
    </View>
  );
}

function TopCriticalCard({
  title,
  rows,
}: {
  title: string;
  rows: DailyBriefData['topCriticalJobs'];
}) {
  if (rows.length === 0) return null;
  return (
    <View style={styles.card} wrap={false}>
      <Text style={styles.cardTitle}>{title}</Text>
      <View style={styles.tHead}>
        <Text style={[styles.tCellH, { flex: 3 }]}>Address</Text>
        <Text style={[styles.tCellH, { flex: 2 }]}>Rep</Text>
        <Text style={[styles.tCellH, { flex: 1.3, textAlign: 'right' }]}>Balance</Text>
        <Text style={[styles.tCellH, { width: 50, textAlign: 'right' }]}>Days</Text>
        <Text style={[styles.tCellH, { width: 40, textAlign: 'right' }]}>Heat</Text>
      </View>
      {rows.map((j) => (
        <View key={j.id} style={styles.tRow} wrap={false}>
          <Text style={[styles.tCell, { flex: 3 }]}>{j.address}</Text>
          <Text style={[styles.tCell, { flex: 2 }]}>{j.rep}</Text>
          <Text style={[styles.tCell, { flex: 1.3, textAlign: 'right' }]}>
            {fmtUSD(j.balance)}
          </Text>
          <Text style={[styles.tCell, { width: 50, textAlign: 'right' }]}>
            {j.daysPastTerms > 0 ? `${j.daysPastTerms}d` : '—'}
          </Text>
          <Text
            style={[
              styles.tCell,
              {
                width: 40,
                textAlign: 'right',
                color: j.heatScore >= 76 ? COLORS.critical : COLORS.text,
                fontFamily: 'Helvetica-Bold',
              },
            ]}
          >
            {j.heatScore}
          </Text>
        </View>
      ))}
    </View>
  );
}

function AnomaliesCard({
  rows,
}: {
  rows: DailyBriefData['anomalyBreakdown'];
}) {
  if (rows.length === 0) return null;
  return (
    <View style={styles.card} wrap={false}>
      <Text style={styles.cardTitle}>What looks strange</Text>
      {rows.map((a) => (
        <View key={a.flag} style={styles.tRow}>
          <Text style={[styles.tCell, { flex: 3 }]}>{a.label}</Text>
          <Text
            style={[
              styles.tCell,
              { width: 60, textAlign: 'right', fontFamily: 'Helvetica-Bold' },
            ]}
          >
            {a.count} {a.count === 1 ? 'job' : 'jobs'}
          </Text>
        </View>
      ))}
    </View>
  );
}

function TopRepsCard({
  title,
  rows,
}: {
  title: string;
  rows: DailyBriefData['topReps'];
}) {
  if (rows.length === 0) return null;
  return (
    <View style={styles.card} wrap={false}>
      <Text style={styles.cardTitle}>{title}</Text>
      <View style={styles.tHead}>
        <Text style={[styles.tCellH, { flex: 3 }]}>Rep</Text>
        <Text style={[styles.tCellH, { flex: 1.5, textAlign: 'right' }]}>
          Outstanding
        </Text>
        <Text style={[styles.tCellH, { width: 40, textAlign: 'right' }]}>Jobs</Text>
        <Text style={[styles.tCellH, { width: 60, textAlign: 'right' }]}>
          Critical
        </Text>
        <Text style={[styles.tCellH, { width: 60, textAlign: 'right' }]}>
          Oldest
        </Text>
      </View>
      {rows.map((r) => (
        <View key={r.name} style={styles.tRow} wrap={false}>
          <Text style={[styles.tCell, { flex: 3 }]}>{r.name}</Text>
          <Text style={[styles.tCell, { flex: 1.5, textAlign: 'right' }]}>
            {fmtUSD(r.totalOutstanding)}
          </Text>
          <Text style={[styles.tCell, { width: 40, textAlign: 'right' }]}>
            {r.jobCount}
          </Text>
          <Text
            style={[
              styles.tCell,
              {
                width: 60,
                textAlign: 'right',
                color: r.criticalCount > 0 ? COLORS.critical : COLORS.muted,
              },
            ]}
          >
            {r.criticalCount}
          </Text>
          <Text style={[styles.tCell, { width: 60, textAlign: 'right' }]}>
            {r.oldestDaysPastTerms}d
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Full job list — rendered FLAT (no card wrapper) so page breaks don't
 * leave half-drawn rounded boxes hanging off the bottom of a page. Each
 * row uses wrap={false} so a row never splits across pages, and the
 * table header repeats on every page via `fixed` placement.
 */
function FullJobListPage({ rows }: { rows: DailyBriefData['fullJobList'] }) {
  return (
    <>
      <Text style={styles.sectionLabel}>
        Full job list — sorted by days past terms
      </Text>
      <View style={styles.flatHeader} fixed>
        <Text style={[styles.tCellH, { flex: 2.5, paddingLeft: 8 }]}>Address</Text>
        <Text style={[styles.tCellH, { flex: 1.6 }]}>Rep</Text>
        <Text style={[styles.tCellH, { flex: 1 }]}>Region</Text>
        <Text style={[styles.tCellH, { flex: 1.3, textAlign: 'right' }]}>
          Balance
        </Text>
        <Text style={[styles.tCellH, { width: 35, textAlign: 'right' }]}>
          Days
        </Text>
        <Text style={[styles.tCellH, { width: 36, textAlign: 'right' }]}>
          Heat
        </Text>
        <Text
          style={[styles.tCellH, { width: 36, textAlign: 'right', paddingRight: 8 }]}
        >
          !
        </Text>
      </View>
      <View style={styles.flatTable}>
        {rows.map((j) => (
          <View key={j.id} style={styles.flatRow} wrap={false}>
            <Text style={[styles.tCell, { flex: 2.5, paddingLeft: 8 }]}>
              {j.address}
            </Text>
            <Text style={[styles.tCell, { flex: 1.6 }]}>{j.rep}</Text>
            <Text style={[styles.tCell, { flex: 1 }]}>{j.region}</Text>
            <Text style={[styles.tCell, { flex: 1.3, textAlign: 'right' }]}>
              {fmtUSD(j.balance)}
            </Text>
            <Text style={[styles.tCell, { width: 35, textAlign: 'right' }]}>
              {j.daysPastTerms > 0 ? `${j.daysPastTerms}d` : '—'}
            </Text>
            <Text
              style={[
                styles.tCell,
                {
                  width: 36,
                  textAlign: 'right',
                  color:
                    j.heatBand === 'critical'
                      ? COLORS.critical
                      : j.heatBand === 'hot'
                        ? COLORS.hot
                        : COLORS.text,
                  fontFamily:
                    j.heatBand === 'critical' || j.heatBand === 'hot'
                      ? 'Helvetica-Bold'
                      : 'Helvetica',
                },
              ]}
            >
              {j.heatScore}
            </Text>
            <Text
              style={[
                styles.tCell,
                {
                  width: 36,
                  textAlign: 'right',
                  paddingRight: 8,
                  color: j.anomalyCount > 0 ? COLORS.hot : COLORS.muted,
                },
              ]}
            >
              {j.anomalyCount > 0 ? j.anomalyCount : ''}
            </Text>
          </View>
        ))}
      </View>
    </>
  );
}

export function DailyBriefPDF({ data }: { data: DailyBriefData }) {
  const {
    cadence,
    briefTitle,
    briefSubtitle,
    headline,
    kpis,
    bucketSummary,
    topCriticalJobs,
    anomalyBreakdown,
    topReps,
    closeOutItems,
    weekHighlights,
    fullJobList,
  } = data;

  const documentTitle = `Vera ${briefTitle} — ${fmtDate(data.asOf)}`;

  const criticalCardTitle =
    cadence === 'weekly'
      ? 'Hottest jobs going into next week'
      : cadence === 'monthly'
        ? 'Critical jobs to settle before month-end'
        : 'Top jobs to focus on';

  const repsCardTitle =
    cadence === 'monthly'
      ? 'Per-rep accountability for the month'
      : cadence === 'weekly'
        ? 'Reps to address this week'
        : 'Reps with the most outstanding';

  return (
    <Document title={documentTitle} author="Vera Calloway" subject={briefTitle}>
      {/* Page 1 — cover / summary */}
      <Page size="LETTER" style={styles.page}>
        <BriefHeader title={briefTitle} subtitle={briefSubtitle} />

        <Text style={styles.veraQuote}>{headline}</Text>

        <View style={styles.kpiRow}>
          {kpis.map((k) => (
            <KPI
              key={k.label}
              label={k.label}
              value={k.value}
              hint={k.hint}
              emphasis={k.emphasis}
            />
          ))}
        </View>

        {/* Cadence-specific section ordering */}
        {cadence === 'monthly' ? (
          <>
            <CloseOutCard rows={closeOutItems} />
            <BucketChart buckets={bucketSummary} />
            <TopCriticalCard title={criticalCardTitle} rows={topCriticalJobs} />
            <TopRepsCard title={repsCardTitle} rows={topReps} />
          </>
        ) : cadence === 'weekly' ? (
          <>
            <WeekSlippedCard rows={weekHighlights} />
            <BucketChart buckets={bucketSummary} />
            <TopCriticalCard title={criticalCardTitle} rows={topCriticalJobs} />
            <TopRepsCard title={repsCardTitle} rows={topReps} />
            <AnomaliesCard rows={anomalyBreakdown} />
          </>
        ) : (
          <>
            <BucketChart buckets={bucketSummary} />
            <TopCriticalCard title={criticalCardTitle} rows={topCriticalJobs} />
            <AnomaliesCard rows={anomalyBreakdown} />
            <TopRepsCard title={repsCardTitle} rows={topReps} />
          </>
        )}

        <BriefFooter />
      </Page>

      {/* Page 2+ — full job list (header is fixed, repeats on each page) */}
      <Page size="LETTER" style={styles.page}>
        <BriefHeader title={briefTitle} subtitle={briefSubtitle} />
        <FullJobListPage rows={fullJobList} />
        <BriefFooter />
      </Page>
    </Document>
  );
}

/** Render the PDF to a Buffer for email attachment. */
export async function renderDailyBriefPDF(data: DailyBriefData): Promise<Buffer> {
  return renderToBuffer(<DailyBriefPDF data={data} />);
}
