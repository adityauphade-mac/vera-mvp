'use client';

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Send,
  Trash2,
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
} from '@vera/ui';

/**
 * Scheduler — recurring report delivery configuration.
 *
 * Three states per cadence, each with one primary action:
 *   A. Unscheduled (no DB row) — form open, primary "Schedule".
 *      No on/off switch: there is nothing yet to pause.
 *   B. Scheduled  (DB row, enabled=true)  — primary "Save changes"
 *      (enabled only when the form diverges from the row).
 *      Switch flips to Paused via an immediate server PUT.
 *      Remove is the destructive secondary.
 *   C. Paused     (DB row, enabled=false) — same as B, with the form
 *      visibly dimmed so the operator can scan the page and see what's
 *      live at a glance. Editing a paused row is fine; only the cron
 *      worker treats `enabled=false` as "don't fire".
 *
 * The server `Schedule` table is the single source of truth (one row per
 * tenantId+cadence, enforced by a unique index). localStorage only
 * buffers in-flight form edits across reloads.
 */

type ReportId = 'daily' | 'weekly' | 'monthly';

type ReportConfig = {
  id: ReportId;
  recipient: string;
  time: string; // 24-hour HH:mm
  /** Weekly: 0=Sun..6=Sat. Monthly: 'last' or '1'..'28' or 'last-business'. */
  cadenceValue?: string;
};

type ServerSchedule = {
  id: number;
  tenantId: number;
  cadence: ReportId;
  dayOfWeek: number | null;
  dayOfMonth: string | null;
  timeLocal: string;
  timezone: string;
  recipient: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
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

const STORAGE_KEY = 'vera-scheduler-v2';

const DEFAULT_STATE: SchedulerState = {
  reports: {
    daily: { id: 'daily', recipient: '', time: '08:00' },
    weekly: { id: 'weekly', recipient: '', time: '09:00', cadenceValue: '1' },
    monthly: {
      id: 'monthly',
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
  { title: string; description: string }
> = {
  daily: {
    title: 'Daily AR brief',
    description:
      "Vera's morning rollup of past-terms jobs, anomalies, and reps to watch.",
  },
  weekly: {
    title: 'Weekly summary',
    description:
      "A wider snapshot of the week's AR movement — what shifted, what closed, what slipped.",
  },
  monthly: {
    title: 'Monthly close',
    description:
      'End-of-month rollup with the full job table, anomaly history, and per-rep accountability.',
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

function reportFromServer(row: ServerSchedule): ReportConfig {
  return {
    id: row.cadence,
    recipient: row.recipient,
    time: row.timeLocal,
    cadenceValue:
      row.cadence === 'weekly'
        ? String(row.dayOfWeek ?? 1)
        : row.cadence === 'monthly'
          ? row.dayOfMonth ?? 'last'
          : undefined,
  };
}

/** True iff the user's form differs from the saved server row. */
function isDirty(form: ReportConfig, server: ServerSchedule): boolean {
  if (form.recipient !== server.recipient) return true;
  if (form.time !== server.timeLocal) return true;
  if (form.id === 'weekly') {
    const serverDow = server.dayOfWeek === null ? null : String(server.dayOfWeek);
    if ((form.cadenceValue ?? null) !== serverDow) return true;
  }
  if (form.id === 'monthly') {
    if ((form.cadenceValue ?? null) !== (server.dayOfMonth ?? null)) return true;
  }
  return false;
}

type SendOutcome =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'success'; to: string; pdfBytes: number; id: string }
  | { kind: 'error'; message: string };

type ScheduleOutcome =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'saved'; nextRunAt: string }
  | { kind: 'paused' }
  | { kind: 'resumed'; nextRunAt: string }
  | { kind: 'removed' }
  | { kind: 'error'; message: string };

const SSR_FALLBACK_TIMEZONE = 'America/Chicago';

function resolveTimezone(): string {
  if (typeof window === 'undefined') return SSR_FALLBACK_TIMEZONE;
  return (
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? SSR_FALLBACK_TIMEZONE
  );
}

function tzAbbreviation(timezone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'short',
    });
    const part = fmt.formatToParts(new Date()).find((p) => p.type === 'timeZoneName');
    return part?.value ?? '';
  } catch {
    return '';
  }
}

export function SchedulerView() {
  const [state, setState] = useState<SchedulerState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);
  const [timezone, setTimezone] = useState(SSR_FALLBACK_TIMEZONE);
  // Server-known schedules. `null` means "no row" — that's state A for
  // that cadence. The form-vs-server diff drives every visible affordance.
  const [serverRows, setServerRows] = useState<Record<ReportId, ServerSchedule | null>>({
    daily: null,
    weekly: null,
    monthly: null,
  });
  const [outcomes, setOutcomes] = useState<Record<ReportId, SendOutcome>>({
    daily: { kind: 'idle' },
    weekly: { kind: 'idle' },
    monthly: { kind: 'idle' },
  });
  const [scheduleOutcomes, setScheduleOutcomes] = useState<
    Record<ReportId, ScheduleOutcome>
  >({
    daily: { kind: 'idle' },
    weekly: { kind: 'idle' },
    monthly: { kind: 'idle' },
  });

  useEffect(() => {
    const local = loadState();
    setState(local);
    setTimezone(resolveTimezone());
    setHydrated(true);

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/schedules', { cache: 'no-store' });
        if (!res.ok) return;
        const json = (await res.json()) as { schedules: ServerSchedule[] };
        if (cancelled) return;
        const byCadence: Record<ReportId, ServerSchedule | null> = {
          daily: null,
          weekly: null,
          monthly: null,
        };
        for (const row of json.schedules) {
          if (row.cadence in byCadence) byCadence[row.cadence] = row;
        }
        setServerRows(byCadence);
        // For cadences that have a server row, server wins over localStorage.
        // For cadences without one, leave the local draft alone (user may
        // have been typing).
        setState((prev) => {
          const next = { ...prev, reports: { ...prev.reports } };
          for (const id of ['daily', 'weekly', 'monthly'] as ReportId[]) {
            const row = byCadence[id];
            if (row) next.reports[id] = reportFromServer(row);
          }
          saveState(next);
          return next;
        });
      } catch {
        /* network blip — leave the form on localStorage values */
      }
    })();
    return () => {
      cancelled = true;
    };
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

  /**
   * Persist the form to the server. Creates the row in state A or rewrites
   * it in B/C. Always preserves the current `enabled` state — the switch
   * owns that flag, not the form.
   */
  async function saveSchedule(id: ReportId) {
    const cfg = state.reports[id];
    if (!isValidEmail(cfg.recipient)) {
      setScheduleOutcomes((o) => ({
        ...o,
        [id]: { kind: 'error', message: 'Enter a valid recipient email first.' },
      }));
      return;
    }

    const dayOfWeek =
      id === 'weekly' && cfg.cadenceValue !== undefined
        ? Number(cfg.cadenceValue)
        : null;
    const dayOfMonth = id === 'monthly' ? cfg.cadenceValue ?? null : null;
    const enabled = serverRows[id]?.enabled ?? true;

    setScheduleOutcomes((o) => ({ ...o, [id]: { kind: 'pending' } }));
    try {
      const res = await fetch(`/api/schedules/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dayOfWeek,
          dayOfMonth,
          timeLocal: cfg.time,
          timezone,
          recipient: cfg.recipient,
          enabled,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setScheduleOutcomes((o) => ({
          ...o,
          [id]: {
            kind: 'error',
            message:
              typeof json?.error === 'string'
                ? json.error
                : `Save failed (HTTP ${res.status}).`,
          },
        }));
        return;
      }
      const saved: ServerSchedule = json.schedule;
      setServerRows((rows) => ({ ...rows, [id]: saved }));
      setScheduleOutcomes((o) => ({
        ...o,
        [id]: { kind: 'saved', nextRunAt: saved.nextRunAt ?? '' },
      }));
    } catch (e) {
      setScheduleOutcomes((o) => ({
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

  /**
   * Flip enabled on the existing server row. Optimistic: update the local
   * `serverRows` view immediately so the switch + pill move together; on
   * error, roll back and surface the message.
   */
  async function setEnabled(id: ReportId, nextEnabled: boolean) {
    const row = serverRows[id];
    if (!row) return; // Switch should not be visible in state A.
    const previous = row;
    const optimistic: ServerSchedule = { ...row, enabled: nextEnabled };
    setServerRows((rows) => ({ ...rows, [id]: optimistic }));
    setScheduleOutcomes((o) => ({ ...o, [id]: { kind: 'pending' } }));
    try {
      const res = await fetch(`/api/schedules/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dayOfWeek: row.dayOfWeek,
          dayOfMonth: row.dayOfMonth,
          timeLocal: row.timeLocal,
          timezone: row.timezone,
          recipient: row.recipient,
          enabled: nextEnabled,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        // Roll back.
        setServerRows((rows) => ({ ...rows, [id]: previous }));
        setScheduleOutcomes((o) => ({
          ...o,
          [id]: {
            kind: 'error',
            message:
              typeof json?.error === 'string'
                ? json.error
                : `Could not ${nextEnabled ? 'resume' : 'pause'} schedule.`,
          },
        }));
        return;
      }
      const saved: ServerSchedule = json.schedule;
      setServerRows((rows) => ({ ...rows, [id]: saved }));
      setScheduleOutcomes((o) => ({
        ...o,
        [id]: nextEnabled
          ? { kind: 'resumed', nextRunAt: saved.nextRunAt ?? '' }
          : { kind: 'paused' },
      }));
    } catch (e) {
      setServerRows((rows) => ({ ...rows, [id]: previous }));
      setScheduleOutcomes((o) => ({
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

  async function removeSchedule(id: ReportId) {
    if (!serverRows[id]) return;
    const confirmed =
      typeof window !== 'undefined'
        ? window.confirm(
            `Remove the ${REPORT_META[id].title}? Future automatic sends will stop. Send now still works.`,
          )
        : true;
    if (!confirmed) return;

    setScheduleOutcomes((o) => ({ ...o, [id]: { kind: 'pending' } }));
    try {
      const res = await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setScheduleOutcomes((o) => ({
          ...o,
          [id]: {
            kind: 'error',
            message:
              typeof json?.error === 'string'
                ? json.error
                : `Remove failed (HTTP ${res.status}).`,
          },
        }));
        return;
      }
      setServerRows((rows) => ({ ...rows, [id]: null }));
      setScheduleOutcomes((o) => ({ ...o, [id]: { kind: 'removed' } }));
    } catch (e) {
      setScheduleOutcomes((o) => ({
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
      {/* Cron reliability advisory — see notes in OPERATIONS.md. */}
      <div
        role="status"
        className="border-heat-warm/40 bg-heat-warm/5 vera-rise flex items-start gap-3 rounded-2xl border px-5 py-4"
      >
        <AlertTriangle className="text-heat-warm mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-1">
          <p className="text-text-primary text-sm font-medium">
            Automatic dispatch may be delayed
          </p>
          <p className="text-text-secondary text-xs leading-relaxed">
            We rely on GitHub Actions cron for recurring sends. New
            workflows can sit in a multi-hour onboarding throttle before the
            first auto-fire. Scheduled rows here will queue and send the
            moment GitHub picks them up. For guaranteed immediate delivery,
            use <strong>Send now</strong>.
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
          highlight when something changes between runs. Each cadence is a
          single schedule — changing the recipient replaces the previous one,
          it doesn&apos;t add another.
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

        {(['daily', 'weekly', 'monthly'] as ReportId[]).map((id) => (
          <ReportRow
            key={id}
            report={state.reports[id]}
            serverRow={serverRows[id]}
            outcome={outcomes[id]}
            scheduleOutcome={scheduleOutcomes[id]}
            hydrated={hydrated}
            timezone={timezone}
            onChange={(patch) => updateReport(id, patch)}
            onSendNow={() => sendNow(id)}
            onSave={() => saveSchedule(id)}
            onToggleEnabled={(v) => setEnabled(id, v)}
            onRemove={() => removeSchedule(id)}
          />
        ))}
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
  serverRow,
  outcome,
  scheduleOutcome,
  hydrated,
  timezone,
  onChange,
  onSendNow,
  onSave,
  onToggleEnabled,
  onRemove,
}: {
  report: ReportConfig;
  serverRow: ServerSchedule | null;
  outcome: SendOutcome;
  scheduleOutcome: ScheduleOutcome;
  hydrated: boolean;
  timezone: string;
  onChange: (patch: Partial<ReportConfig>) => void;
  onSendNow: () => void;
  onSave: () => void;
  onToggleEnabled: (next: boolean) => void;
  onRemove: () => void;
}) {
  const meta = REPORT_META[report.id];
  const tzLabel = tzAbbreviation(timezone);
  const cadenceLine = describeCadence(report, tzLabel);
  const recipientValid = report.recipient ? isValidEmail(report.recipient) : true;

  // Status pill follows server state. State A = "Not scheduled"; otherwise
  // "Scheduled" or "Paused" depending on `enabled` on the row. The pill is
  // single-purpose: "what will the cron worker do right now?".
  let statusLabel: string;
  let statusActive: boolean;
  if (!serverRow) {
    statusLabel = 'Not scheduled';
    statusActive = false;
  } else if (serverRow.enabled) {
    statusLabel = 'Scheduled';
    statusActive = true;
  } else {
    statusLabel = 'Paused';
    statusActive = false;
  }

  const hasServerRow = serverRow !== null;
  const isPaused = hasServerRow && !serverRow.enabled;
  // Dimmed body for paused rows — at-a-glance signal that this isn't live.
  const dimBodyClass = isPaused ? 'opacity-60' : '';

  // Save-button enablement. State A: any valid recipient. State B/C: only
  // when the form has actually diverged from the server row.
  const dirty = serverRow ? isDirty(report, serverRow) : true;
  const saveDisabled =
    !report.recipient ||
    !recipientValid ||
    scheduleOutcome.kind === 'pending' ||
    (hasServerRow && !dirty);

  const saveLabel = (() => {
    if (scheduleOutcome.kind === 'pending') {
      return hasServerRow ? 'Saving…' : 'Scheduling…';
    }
    return hasServerRow ? 'Save changes' : 'Schedule';
  })();

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
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-lg tracking-tight sm:text-xl">{meta.title}</h3>
                <span
                  className={
                    statusActive
                      ? 'border-accent/30 bg-accent/10 text-accent rounded-full border px-2 py-0.5 text-[0.65rem] tracking-[0.18em] uppercase'
                      : 'border-border bg-bg-base text-text-muted rounded-full border px-2 py-0.5 text-[0.65rem] tracking-[0.18em] uppercase'
                  }
                >
                  {statusLabel}
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
              {hydrated && serverRow ? (
                <ServerRunLine
                  nextRunAt={serverRow.nextRunAt}
                  lastRunAt={serverRow.lastRunAt}
                  timezone={timezone}
                  recipient={serverRow.recipient}
                />
              ) : null}
            </div>
          </div>

          {/* Switch only appears once there's something to pause. In state A
              it would be meaningless — there's no row yet. */}
          {hasServerRow ? (
            <div className="flex flex-col items-end gap-1">
              <Switch
                checked={serverRow.enabled}
                onCheckedChange={(v) => onToggleEnabled(v)}
                disabled={scheduleOutcome.kind === 'pending'}
                aria-label={
                  serverRow.enabled
                    ? `Pause ${meta.title}`
                    : `Resume ${meta.title}`
                }
              />
              <p className="text-text-muted max-w-[14rem] text-right text-[0.65rem] leading-tight">
                {serverRow.enabled
                  ? 'On — Vera will send on the schedule below.'
                  : 'Paused — no automatic sends. A dispatch already in flight may still complete.'}
              </p>
            </div>
          ) : null}
        </div>

        {/* Editable body. Dimmed when paused so an operator scanning the
            page can see at a glance what's live. */}
        <div className={`space-y-5 transition-opacity ${dimBodyClass}`}>
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

            <Field label="Time (your local time)">
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
                placeholder="gm@yourcompany.com"
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
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
              {scheduleOutcome.kind === 'saved' && scheduleOutcome.nextRunAt ? (
                <div className="border-accent/30 bg-accent/5 flex items-center gap-2 rounded-xl border px-3 py-2">
                  <CheckCircle2 className="text-accent h-3.5 w-3.5 shrink-0" />
                  <p className="text-text-primary text-xs">
                    Saved — next run{' '}
                    <strong>{formatNextRun(scheduleOutcome.nextRunAt, timezone)}</strong>.
                  </p>
                </div>
              ) : null}
              {scheduleOutcome.kind === 'paused' ? (
                <div className="border-border bg-bg-base/40 flex items-center gap-2 rounded-xl border px-3 py-2">
                  <CheckCircle2 className="text-text-muted h-3.5 w-3.5 shrink-0" />
                  <p className="text-text-primary text-xs">
                    Paused — no automatic sends until you resume.
                  </p>
                </div>
              ) : null}
              {scheduleOutcome.kind === 'resumed' && scheduleOutcome.nextRunAt ? (
                <div className="border-accent/30 bg-accent/5 flex items-center gap-2 rounded-xl border px-3 py-2">
                  <CheckCircle2 className="text-accent h-3.5 w-3.5 shrink-0" />
                  <p className="text-text-primary text-xs">
                    Resumed — next run{' '}
                    <strong>{formatNextRun(scheduleOutcome.nextRunAt, timezone)}</strong>.
                  </p>
                </div>
              ) : null}
              {scheduleOutcome.kind === 'removed' ? (
                <div className="border-border bg-bg-base/40 flex items-center gap-2 rounded-xl border px-3 py-2">
                  <CheckCircle2 className="text-text-muted h-3.5 w-3.5 shrink-0" />
                  <p className="text-text-primary text-xs">
                    Removed — no automatic sends for this cadence.
                  </p>
                </div>
              ) : null}
              {scheduleOutcome.kind === 'error' ? (
                <div className="border-heat-critical/40 bg-heat-critical/5 flex items-center gap-2 rounded-xl border px-3 py-2">
                  <AlertCircle className="text-heat-critical h-3.5 w-3.5 shrink-0" />
                  <p className="text-text-primary text-xs">{scheduleOutcome.message}</p>
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {hasServerRow ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onRemove}
                  disabled={scheduleOutcome.kind === 'pending'}
                  aria-label={`Remove ${meta.title}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="ml-1.5 whitespace-nowrap">Remove</span>
                </Button>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                onClick={onSave}
                disabled={saveDisabled}
              >
                <CalendarClock className="mr-2 h-3.5 w-3.5" />
                <span className="whitespace-nowrap">{saveLabel}</span>
              </Button>
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
                  <span className="whitespace-nowrap">Sending…</span>
                ) : (
                  <>
                    <Send className="mr-2 h-3.5 w-3.5" />
                    <span className="whitespace-nowrap">Send now</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

/**
 * Show the server-known recipient + next/last run for this cadence. This
 * is the operator's check that what they think is scheduled is actually
 * what the cron worker will fire. Hidden until we know the row exists.
 */
function ServerRunLine({
  nextRunAt,
  lastRunAt,
  timezone,
  recipient,
}: {
  nextRunAt: string | null;
  lastRunAt: string | null;
  timezone: string;
  recipient: string;
}) {
  return (
    <p className="text-text-muted text-xs">
      <span>To <strong className="text-text-secondary">{recipient}</strong></span>
      {nextRunAt ? (
        <>
          <span className="mx-1.5">·</span>
          <span>Next {formatNextRun(nextRunAt, timezone)}</span>
        </>
      ) : null}
      {lastRunAt ? (
        <>
          <span className="mx-1.5">·</span>
          <span>Last {formatNextRun(lastRunAt, timezone)}</span>
        </>
      ) : null}
    </p>
  );
}

function formatNextRun(iso: string, timezone = resolveTimezone()): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
    timeZoneName: 'short',
  });
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

function describeCadence(report: ReportConfig, tzLabel: string): string {
  const time = tzLabel
    ? `${formatTime12h(report.time)} ${tzLabel}`
    : formatTime12h(report.time);
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
