'use client';

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Info,
  Send,
} from 'lucide-react';
import {
  Button,
  Card,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  TimePicker,
  Tooltip,
} from '@vera/ui';

/**
 * Scheduler — preview of the recurring report scheduling experience.
 *
 * Per CLAUDE.md §6.7 (email send policy): one-shot Send now goes through
 * /api/brief/send → Resend immediately. Recurring schedules are stored in
 * localStorage and visualised here, but the cron service that would honour
 * them is not yet wired up. The banner at the top makes that explicit.
 */

type ReportId = 'daily' | 'weekly' | 'monthly';

type ReportConfig = {
  id: ReportId;
  enabled: boolean;
  recipient: string;
  time: string; // 24-hour HH:mm
  /** Weekly: 0=Sun..6=Sat. Monthly: 'last' or '1'..'28'. */
  cadenceValue?: string;
};

type HighlightId =
  | 'bucket-change'
  | 'heat-band-change'
  | 'category-change'
  | 'new-anomaly'
  | 'paid-off'
  | 'new-rep';

type SchedulerState = {
  reports: Record<ReportId, ReportConfig>;
  highlights: Record<HighlightId, boolean>;
};

const STORAGE_KEY = 'vera-scheduler-v1';

const DEFAULT_STATE: SchedulerState = {
  reports: {
    daily: {
      id: 'daily',
      enabled: true,
      recipient: '',
      time: '08:00',
    },
    weekly: {
      id: 'weekly',
      enabled: false,
      recipient: '',
      time: '09:00',
      cadenceValue: '1', // Monday
    },
    monthly: {
      id: 'monthly',
      enabled: false,
      recipient: '',
      time: '17:00',
      cadenceValue: 'last',
    },
  },
  highlights: {
    'bucket-change': true,
    'heat-band-change': true,
    'category-change': true,
    'new-anomaly': true,
    'paid-off': true,
    'new-rep': true,
  },
};

const REPORT_META: Record<
  ReportId,
  { title: string; description: string; cadenceLabel: string }
> = {
  daily: {
    title: 'Daily AR brief',
    description:
      "Vera's morning rollup of past-terms jobs, anomalies, and reps to watch.",
    cadenceLabel: 'Every weekday',
  },
  weekly: {
    title: 'Weekly summary',
    description:
      "A wider snapshot of the week's AR movement — what shifted, what closed, what slipped.",
    cadenceLabel: 'Once a week',
  },
  monthly: {
    title: 'Monthly close',
    description:
      'End-of-month rollup with the full job table, anomaly history, and per-rep accountability.',
    cadenceLabel: 'Once a month',
  },
};

const HIGHLIGHT_META: Array<{ id: HighlightId; label: string; hint: string }> = [
  {
    id: 'bucket-change',
    label: 'Job moved between aging buckets',
    hint: "e.g. within-terms → 1–30 past, or 31–60 → 60+",
  },
  {
    id: 'heat-band-change',
    label: 'Heat score band changed',
    hint: 'cool / warm / hot / critical transitions',
  },
  {
    id: 'category-change',
    label: 'Job category changed',
    hint: 'Insurance ↔ retail, residential ↔ commercial',
  },
  {
    id: 'new-anomaly',
    label: 'New anomaly flagged',
    hint: 'Any of the nine anomaly rules tripping for the first time',
  },
  {
    id: 'paid-off',
    label: 'Job paid off',
    hint: 'Balance dropped to zero — the job left the AR set',
  },
  {
    id: 'new-rep',
    label: 'New rep assigned',
    hint: 'Ownership change since the last run',
  },
];

const DAY_OF_WEEK_OPTIONS = [
  { value: '1', label: 'Mondays' },
  { value: '2', label: 'Tuesdays' },
  { value: '3', label: 'Wednesdays' },
  { value: '4', label: 'Thursdays' },
  { value: '5', label: 'Fridays' },
  { value: '6', label: 'Saturdays' },
  { value: '0', label: 'Sundays' },
];

const DAY_OF_MONTH_OPTIONS = [
  { value: '1', label: '1st of the month' },
  { value: '15', label: '15th of the month' },
  { value: 'last-business', label: 'Last business day' },
  { value: 'last', label: 'Last day of the month' },
];

function loadState(): SchedulerState {
  if (typeof window === 'undefined') return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw);
    return {
      reports: {
        daily: { ...DEFAULT_STATE.reports.daily, ...(parsed.reports?.daily ?? {}) },
        weekly: { ...DEFAULT_STATE.reports.weekly, ...(parsed.reports?.weekly ?? {}) },
        monthly: {
          ...DEFAULT_STATE.reports.monthly,
          ...(parsed.reports?.monthly ?? {}),
        },
      },
      highlights: { ...DEFAULT_STATE.highlights, ...(parsed.highlights ?? {}) },
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function saveState(state: SchedulerState): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

type SendOutcome =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'success'; to: string; pdfBytes: number; id: string }
  | { kind: 'error'; message: string };

export function SchedulerView() {
  const [state, setState] = useState<SchedulerState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);
  const [outcomes, setOutcomes] = useState<Record<ReportId, SendOutcome>>({
    daily: { kind: 'idle' },
    weekly: { kind: 'idle' },
    monthly: { kind: 'idle' },
  });

  // Hydrate from localStorage after first render to avoid SSR mismatch
  useEffect(() => {
    setState(loadState());
    setHydrated(true);
  }, []);

  function update(next: SchedulerState) {
    setState(next);
    saveState(next);
  }

  function updateReport(id: ReportId, patch: Partial<ReportConfig>) {
    update({
      ...state,
      reports: {
        ...state.reports,
        [id]: { ...state.reports[id], ...patch },
      },
    });
  }

  function toggleHighlight(id: HighlightId, on: boolean) {
    update({
      ...state,
      highlights: { ...state.highlights, [id]: on },
    });
  }

  async function sendNow(id: ReportId) {
    const cfg = state.reports[id];
    if (!isValidEmail(cfg.recipient)) {
      setOutcomes((o) => ({
        ...o,
        [id]: { kind: 'error', message: 'Enter a valid recipient email first.' },
      }));
      return;
    }
    setOutcomes((o) => ({ ...o, [id]: { kind: 'pending' } }));
    try {
      const res = await fetch('/api/brief/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: cfg.recipient, cadence: id }),
      });
      const json = await res.json();
      if (!res.ok) {
        setOutcomes((o) => ({
          ...o,
          [id]: { kind: 'error', message: json?.error?.message ?? 'Send failed.' },
        }));
        return;
      }
      setOutcomes((o) => ({
        ...o,
        [id]: {
          kind: 'success',
          to: json.to,
          pdfBytes: json.pdfBytes,
          id: json.id,
        },
      }));
    } catch (e) {
      setOutcomes((o) => ({
        ...o,
        [id]: {
          kind: 'error',
          message:
            e instanceof Error
              ? e.message
              : 'Network error — could not reach the server.',
        },
      }));
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      {/* Preview banner */}
      <div className="border-accent/30 bg-accent/5 vera-rise flex items-start gap-3 rounded-2xl border px-5 py-4">
        <Info className="text-accent mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-1">
          <p className="text-text-primary text-sm font-medium">
            Preview of the scheduling experience
          </p>
          <p className="text-text-secondary text-xs leading-relaxed">
            The recurring delivery service isn&apos;t wired up yet —
            toggling a report on, picking a cadence, or changing what gets
            highlighted is saved to your browser but doesn&apos;t schedule
            real cron sends. <strong>Send now</strong> does fire a real email
            via Resend.
          </p>
        </div>
      </div>

      {/* Header */}
      <header className="vera-rise space-y-3">
        <p className="text-text-muted text-xs tracking-[0.2em] uppercase">
          Configuration · scheduler
        </p>
        <h1 className="font-display text-4xl tracking-tight md:text-5xl">
          When Vera reports, and to whom.
        </h1>
        <p className="text-text-secondary max-w-2xl text-sm leading-relaxed">
          Pick the cadences you want, who they go to, and what counts as a
          highlight when something changes between runs. Each row remembers
          its setting in your browser.
        </p>
      </header>

      {/* Reports */}
      <section className="vera-rise-delay-1 space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-text-secondary text-sm tracking-[0.2em] uppercase">
            Reports
          </h2>
          <p className="text-text-muted text-xs">3 cadences available</p>
        </div>

        <ReportRow
          report={state.reports.daily}
          outcome={outcomes.daily}
          hydrated={hydrated}
          onChange={(patch) => updateReport('daily', patch)}
          onSendNow={() => sendNow('daily')}
        />
        <ReportRow
          report={state.reports.weekly}
          outcome={outcomes.weekly}
          hydrated={hydrated}
          onChange={(patch) => updateReport('weekly', patch)}
          onSendNow={() => sendNow('weekly')}
        />
        <ReportRow
          report={state.reports.monthly}
          outcome={outcomes.monthly}
          hydrated={hydrated}
          onChange={(patch) => updateReport('monthly', patch)}
          onSendNow={() => sendNow('monthly')}
        />
      </section>

      {/* Highlights */}
      <section className="vera-rise-delay-2 space-y-4">
        <div className="space-y-1">
          <h2 className="text-text-secondary text-sm tracking-[0.2em] uppercase">
            What gets highlighted
          </h2>
          <p className="text-text-muted text-xs">
            When a report runs, these are the changes since the last run that
            Vera will call out at the top of the email and PDF.
          </p>
        </div>

        <Card>
          <div className="divide-border divide-y">
            {HIGHLIGHT_META.map((h) => {
              const checked = state.highlights[h.id] ?? false;
              return (
                <div
                  key={h.id}
                  className="flex items-start justify-between gap-4 py-3.5 first:pt-0 last:pb-0"
                >
                  <div className="space-y-0.5">
                    <p className="text-text-primary text-sm font-medium">
                      {h.label}
                    </p>
                    <p className="text-text-muted text-xs">{h.hint}</p>
                  </div>
                  <Switch
                    checked={checked}
                    onCheckedChange={(v) => toggleHighlight(h.id, v)}
                    aria-label={`Toggle highlight: ${h.label}`}
                  />
                </div>
              );
            })}
          </div>
        </Card>
      </section>
    </div>
  );
}

function ReportRow({
  report,
  outcome,
  hydrated,
  onChange,
  onSendNow,
}: {
  report: ReportConfig;
  outcome: SendOutcome;
  hydrated: boolean;
  onChange: (patch: Partial<ReportConfig>) => void;
  onSendNow: () => void;
}) {
  const meta = REPORT_META[report.id];
  const cadenceLine = describeCadence(report);
  const recipientValid = report.recipient ? isValidEmail(report.recipient) : true;

  return (
    <Card>
      <div className="space-y-5">
        {/* Title row */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="bg-accent/10 text-accent flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
              <CalendarClock className="h-4 w-4" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h3 className="font-display text-xl tracking-tight">{meta.title}</h3>
                <span
                  className={
                    report.enabled
                      ? 'border-accent/30 bg-accent/10 text-accent rounded-full border px-2 py-0.5 text-[0.65rem] tracking-[0.18em] uppercase'
                      : 'border-border bg-bg-base text-text-muted rounded-full border px-2 py-0.5 text-[0.65rem] tracking-[0.18em] uppercase'
                  }
                >
                  {report.enabled ? 'Active' : 'Paused'}
                </span>
              </div>
              <p className="text-text-secondary text-sm leading-relaxed">
                {meta.description}
              </p>
              {hydrated ? (
                <p className="text-text-muted text-xs">
                  <span className="tabular-nums">{cadenceLine}</span>
                </p>
              ) : null}
            </div>
          </div>
          <Switch
            checked={report.enabled}
            onCheckedChange={(v) => onChange({ enabled: v })}
            aria-label={`Toggle ${meta.title}`}
          />
        </div>

        {/* Config row */}
        <div className="border-border bg-bg-base/40 grid grid-cols-1 gap-4 rounded-2xl border p-4 md:grid-cols-3">
          {report.id === 'weekly' ? (
            <Field label="Day of week">
              <ShadcnSelect
                value={report.cadenceValue ?? '1'}
                onChange={(v) => onChange({ cadenceValue: v })}
                options={DAY_OF_WEEK_OPTIONS}
                ariaLabel="Day of week"
              />
            </Field>
          ) : null}
          {report.id === 'monthly' ? (
            <Field label="Day of month">
              <ShadcnSelect
                value={report.cadenceValue ?? 'last'}
                onChange={(v) => onChange({ cadenceValue: v })}
                options={DAY_OF_MONTH_OPTIONS}
                ariaLabel="Day of month"
              />
            </Field>
          ) : null}

          <Field label="Time">
            <TimePicker
              value={report.time}
              onChange={(v) => onChange({ time: v })}
              ariaLabel={`Time for ${REPORT_META[report.id].title}`}
            />
          </Field>

          <Field
            label="Recipient"
            className={report.id === 'daily' ? 'md:col-span-2' : ''}
            error={
              report.recipient && !recipientValid
                ? 'Enter a valid email address'
                : undefined
            }
          >
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="who-gets-this@example.com"
              value={report.recipient}
              onChange={(e) => onChange({ recipient: e.target.value })}
              className={
                report.recipient && !recipientValid
                  ? 'border-heat-critical focus:border-heat-critical bg-bg-card text-text-primary placeholder:text-text-muted w-full rounded-xl border px-4 py-2.5 text-sm outline-none transition-colors'
                  : 'border-border focus:border-accent bg-bg-card text-text-primary placeholder:text-text-muted w-full rounded-xl border px-4 py-2.5 text-sm outline-none transition-colors'
              }
            />
          </Field>
        </div>

        {/* Action row */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1">
            {outcome.kind === 'success' ? (
              <div className="border-accent/30 bg-accent/5 flex items-center gap-2 rounded-xl border px-3 py-2">
                <CheckCircle2 className="text-accent h-3.5 w-3.5 shrink-0" />
                <p className="text-text-primary text-xs">
                  Sent to <strong>{outcome.to}</strong> · PDF{' '}
                  {(outcome.pdfBytes / 1024).toFixed(1)} KB
                </p>
              </div>
            ) : null}
            {outcome.kind === 'error' ? (
              <div className="border-heat-critical/40 bg-heat-critical/5 flex items-center gap-2 rounded-xl border px-3 py-2">
                <AlertCircle className="text-heat-critical h-3.5 w-3.5 shrink-0" />
                <p className="text-text-primary text-xs">{outcome.message}</p>
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Tooltip
              content="Recurring scheduling isn't wired up yet — coming with the cron + persistence layer in V2."
              side="top"
            >
              <span>
                <Button type="button" variant="secondary" disabled>
                  <CalendarClock className="mr-2 h-3.5 w-3.5" />
                  Schedule
                </Button>
              </span>
            </Tooltip>
            <Button
              type="button"
              onClick={onSendNow}
              disabled={
                !report.recipient ||
                !recipientValid ||
                outcome.kind === 'pending'
              }
            >
              {outcome.kind === 'pending' ? (
                <>Sending…</>
              ) : (
                <>
                  <Send className="mr-2 h-3.5 w-3.5" />
                  Send now
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function Field({
  label,
  children,
  error,
  className,
}: {
  label: string;
  children: React.ReactNode;
  error?: string;
  className?: string;
}) {
  return (
    <div className={'space-y-1.5 ' + (className ?? '')}>
      <label className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
        {label}
      </label>
      {children}
      {error ? (
        <p
          role="alert"
          className="text-heat-critical flex items-center gap-1.5 text-xs"
        >
          <AlertCircle className="h-3 w-3" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ShadcnSelect({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  ariaLabel: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function describeCadence(report: ReportConfig): string {
  const time = formatTime12h(report.time);
  if (report.id === 'daily') return `Every weekday at ${time}`;
  if (report.id === 'weekly') {
    const day =
      DAY_OF_WEEK_OPTIONS.find((o) => o.value === report.cadenceValue)?.label ??
      'Mondays';
    return `${day} at ${time}`;
  }
  const day =
    DAY_OF_MONTH_OPTIONS.find((o) => o.value === report.cadenceValue)?.label ??
    'Last day of the month';
  return `${day} at ${time}`;
}

function formatTime12h(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':');
  const h24 = parseInt(hStr ?? '0', 10);
  const m = parseInt(mStr ?? '0', 10);
  const meridiem = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${meridiem}`;
}
