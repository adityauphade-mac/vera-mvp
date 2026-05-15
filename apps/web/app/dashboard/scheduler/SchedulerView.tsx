'use client';

import { useEffect, useState } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryState, parseAsStringEnum } from 'nuqs';
import { CalendarClock, Send, Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  EmailChipInput,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  SkeletonText,
  Switch,
  Tab,
  Tabs,
  TabsContent,
  TabsList,
  TimePicker,
  toast,
  useConfirm,
} from '@vera/ui';
import {
  dailyScheduleSchema,
  monthlyScheduleSchema,
  weeklyScheduleSchema,
  type DailyScheduleValues,
  type MonthlyScheduleValues,
  type WeeklyScheduleValues,
} from '@vera/types';
import { DataSyncSection } from './DataSyncSection';
import { AutomationTab } from './AutomationTab';

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
 *
 * Form state: React Hook Form + Zod (`@vera/types` schedule schemas). Three
 * `useForm` instances — one per cadence — so each cadence's save is
 * independent and each cadence carries its own validation state.
 */

type ReportId = 'daily' | 'weekly' | 'monthly';

const RECIPIENTS_CAP = 6;

type ServerSchedule = {
  id: number;
  tenantId: number;
  cadence: ReportId;
  dayOfWeek: number | null;
  dayOfMonth: string | null;
  timeLocal: string;
  timezone: string;
  recipients: string[];
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

type StoredForms = {
  daily: DailyScheduleValues;
  weekly: WeeklyScheduleValues;
  monthly: MonthlyScheduleValues;
};

type SchedulerStorage = {
  forms: StoredForms;
  highlights: Record<HighlightId, boolean>;
};

const STORAGE_KEY = 'vera-scheduler-v2';

const DEFAULT_FORMS: StoredForms = {
  daily: {
    cadence: 'daily',
    timeLocal: '08:00',
    recipients: [],
    enabled: true,
  },
  weekly: {
    cadence: 'weekly',
    dayOfWeek: 1,
    timeLocal: '09:00',
    recipients: [],
    enabled: true,
  },
  monthly: {
    cadence: 'monthly',
    dayOfMonth: 'last',
    timeLocal: '17:00',
    recipients: [],
    enabled: true,
  },
};

const DEFAULT_HIGHLIGHTS: Record<HighlightId, boolean> = {
  'bucket-change': true,
  'heat-band-change': true,
  'category-change': true,
  'new-anomaly': true,
  'paid-off': true,
  'new-rep': true,
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

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function recipientsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function summarizeRecipients(list: readonly string[]): string {
  if (list.length === 0) return 'no recipients';
  const [first, ...rest] = list;
  if (first === undefined) return 'no recipients';
  if (rest.length === 0) return first;
  if (list.length <= 3) return list.join(', ');
  return `${first} + ${rest.length} more`;
}

function loadStorage(): SchedulerStorage {
  if (typeof window === 'undefined') {
    return { forms: DEFAULT_FORMS, highlights: DEFAULT_HIGHLIGHTS };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { forms: DEFAULT_FORMS, highlights: DEFAULT_HIGHLIGHTS };
    const parsed = JSON.parse(raw) as Partial<SchedulerStorage> & {
      // v1 schema fallback — the previous shape was { reports, highlights }
      // with `reports[id] = { time, recipients, cadenceValue }`. Migrate
      // through best-effort so the user's draft survives the upgrade.
      reports?: Record<
        ReportId,
        { time?: string; recipients?: string[]; cadenceValue?: string }
      >;
    };

    if (parsed.forms) {
      // v2 shape: trust it as long as the fields look right.
      const f = parsed.forms;
      return {
        forms: {
          daily: { ...DEFAULT_FORMS.daily, ...f.daily, cadence: 'daily' },
          weekly: { ...DEFAULT_FORMS.weekly, ...f.weekly, cadence: 'weekly' },
          monthly: { ...DEFAULT_FORMS.monthly, ...f.monthly, cadence: 'monthly' },
        },
        highlights: { ...DEFAULT_HIGHLIGHTS, ...(parsed.highlights ?? {}) },
      };
    }

    // v1 fallback: migrate the old { reports } shape into the new forms shape.
    if (parsed.reports) {
      const daily = parsed.reports.daily ?? {};
      const weekly = parsed.reports.weekly ?? {};
      const monthly = parsed.reports.monthly ?? {};
      const dowRaw = weekly.cadenceValue ?? '1';
      const dowNum = Number.parseInt(dowRaw, 10);
      return {
        forms: {
          daily: {
            cadence: 'daily',
            timeLocal: daily.time ?? DEFAULT_FORMS.daily.timeLocal,
            recipients: Array.isArray(daily.recipients) ? daily.recipients : [],
            enabled: true,
          },
          weekly: {
            cadence: 'weekly',
            dayOfWeek: Number.isFinite(dowNum) ? dowNum : 1,
            timeLocal: weekly.time ?? DEFAULT_FORMS.weekly.timeLocal,
            recipients: Array.isArray(weekly.recipients) ? weekly.recipients : [],
            enabled: true,
          },
          monthly: {
            cadence: 'monthly',
            dayOfMonth:
              (monthly.cadenceValue as MonthlyScheduleValues['dayOfMonth']) ??
              DEFAULT_FORMS.monthly.dayOfMonth,
            timeLocal: monthly.time ?? DEFAULT_FORMS.monthly.timeLocal,
            recipients: Array.isArray(monthly.recipients)
              ? monthly.recipients
              : [],
            enabled: true,
          },
        },
        highlights: { ...DEFAULT_HIGHLIGHTS, ...(parsed.highlights ?? {}) },
      };
    }

    return { forms: DEFAULT_FORMS, highlights: DEFAULT_HIGHLIGHTS };
  } catch {
    return { forms: DEFAULT_FORMS, highlights: DEFAULT_HIGHLIGHTS };
  }
}

function saveStorage(storage: SchedulerStorage): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storage));
}

function dailyFromServer(row: ServerSchedule): DailyScheduleValues {
  return {
    cadence: 'daily',
    timeLocal: row.timeLocal,
    recipients: row.recipients,
    enabled: row.enabled,
  };
}

function weeklyFromServer(row: ServerSchedule): WeeklyScheduleValues {
  return {
    cadence: 'weekly',
    dayOfWeek: row.dayOfWeek ?? 1,
    timeLocal: row.timeLocal,
    recipients: row.recipients,
    enabled: row.enabled,
  };
}

function monthlyFromServer(row: ServerSchedule): MonthlyScheduleValues {
  return {
    cadence: 'monthly',
    dayOfMonth:
      (row.dayOfMonth as MonthlyScheduleValues['dayOfMonth'] | null) ??
      'last',
    timeLocal: row.timeLocal,
    recipients: row.recipients,
    enabled: row.enabled,
  };
}

/** True iff the form values diverge from the saved server row. */
function isDailyDirty(
  form: DailyScheduleValues,
  server: ServerSchedule,
): boolean {
  if (!recipientsEqual(form.recipients, server.recipients)) return true;
  if (form.timeLocal !== server.timeLocal) return true;
  return false;
}
function isWeeklyDirty(
  form: WeeklyScheduleValues,
  server: ServerSchedule,
): boolean {
  if (!recipientsEqual(form.recipients, server.recipients)) return true;
  if (form.timeLocal !== server.timeLocal) return true;
  if (form.dayOfWeek !== (server.dayOfWeek ?? 1)) return true;
  return false;
}
function isMonthlyDirty(
  form: MonthlyScheduleValues,
  server: ServerSchedule,
): boolean {
  if (!recipientsEqual(form.recipients, server.recipients)) return true;
  if (form.timeLocal !== server.timeLocal) return true;
  if (form.dayOfMonth !== (server.dayOfMonth ?? 'last')) return true;
  return false;
}

type SendOutcome =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'success'; to: string[]; pdfBytes: number; id: string }
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

type TabValue = 'report' | 'sync' | 'automation';

export function SchedulerView() {
  const [tab, setTab] = useQueryState(
    'tab',
    parseAsStringEnum<TabValue>(['report', 'sync', 'automation']).withDefault(
      'report',
    ),
  );

  const [hydrated, setHydrated] = useState(false);
  const [timezone, setTimezone] = useState(SSR_FALLBACK_TIMEZONE);
  // `false` until the first /api/schedules response lands. Drives the
  // skeleton rows below — without this we'd briefly render every row as
  // "Not scheduled" before the real server state swaps in.
  // See CLAUDE.md "Loading states: skeleton-first" for the convention.
  const [serverRowsLoaded, setServerRowsLoaded] = useState(false);
  // Server-known schedules. `null` means "no row" — that's state A for
  // that cadence. The form-vs-server diff drives every visible affordance.
  const [serverRows, setServerRows] = useState<
    Record<ReportId, ServerSchedule | null>
  >({ daily: null, weekly: null, monthly: null });
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
  // Highlights stay as `useState` (no save action — toggling persists to
  // localStorage on the spot). See A-3 plan §3c decision criterion.
  const [highlights, setHighlights] = useState<Record<HighlightId, boolean>>(
    DEFAULT_HIGHLIGHTS,
  );
  const confirm = useConfirm();

  // One RHF instance per cadence. The discriminated-union schema means each
  // form's values include its `cadence` literal; using the cadence-specific
  // schemas individually keeps TypeScript narrowing tight in each handler.
  const dailyForm = useForm<DailyScheduleValues>({
    resolver: zodResolver(dailyScheduleSchema),
    mode: 'onChange',
    defaultValues: DEFAULT_FORMS.daily,
  });
  const weeklyForm = useForm<WeeklyScheduleValues>({
    resolver: zodResolver(weeklyScheduleSchema),
    mode: 'onChange',
    defaultValues: DEFAULT_FORMS.weekly,
  });
  const monthlyForm = useForm<MonthlyScheduleValues>({
    resolver: zodResolver(monthlyScheduleSchema),
    mode: 'onChange',
    defaultValues: DEFAULT_FORMS.monthly,
  });

  // Persist every form change to localStorage as a draft buffer. Server is
  // still source of truth on mount — local values are only a fallback if the
  // network blip.
  useEffect(() => {
    const sub = dailyForm.watch((values) => {
      const storage: SchedulerStorage = {
        forms: {
          daily: values as DailyScheduleValues,
          weekly: weeklyForm.getValues(),
          monthly: monthlyForm.getValues(),
        },
        highlights,
      };
      saveStorage(storage);
    });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyForm, weeklyForm, monthlyForm, highlights]);
  useEffect(() => {
    const sub = weeklyForm.watch((values) => {
      const storage: SchedulerStorage = {
        forms: {
          daily: dailyForm.getValues(),
          weekly: values as WeeklyScheduleValues,
          monthly: monthlyForm.getValues(),
        },
        highlights,
      };
      saveStorage(storage);
    });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyForm, weeklyForm, monthlyForm, highlights]);
  useEffect(() => {
    const sub = monthlyForm.watch((values) => {
      const storage: SchedulerStorage = {
        forms: {
          daily: dailyForm.getValues(),
          weekly: weeklyForm.getValues(),
          monthly: values as MonthlyScheduleValues,
        },
        highlights,
      };
      saveStorage(storage);
    });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyForm, weeklyForm, monthlyForm, highlights]);

  useEffect(() => {
    const local = loadStorage();
    // Seed each form from the localStorage draft (if any) before the server
    // fetch resolves.
    dailyForm.reset(local.forms.daily);
    weeklyForm.reset(local.forms.weekly);
    monthlyForm.reset(local.forms.monthly);
    setHighlights(local.highlights);
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
        // Server wins over localStorage for any cadence with a row
        // (CLAUDE.md rule #10).
        if (byCadence.daily) dailyForm.reset(dailyFromServer(byCadence.daily));
        if (byCadence.weekly) weeklyForm.reset(weeklyFromServer(byCadence.weekly));
        if (byCadence.monthly)
          monthlyForm.reset(monthlyFromServer(byCadence.monthly));
      } catch {
        /* network blip — leave the form on localStorage values */
      } finally {
        if (!cancelled) setServerRowsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleHighlight(id: HighlightId, on: boolean) {
    setHighlights((prev) => {
      const next = { ...prev, [id]: on };
      saveStorage({
        forms: {
          daily: dailyForm.getValues(),
          weekly: weeklyForm.getValues(),
          monthly: monthlyForm.getValues(),
        },
        highlights: next,
      });
      return next;
    });
  }
  // Keep toggleHighlight referenced even when the highlights section is
  // hidden so a future flip doesn't ship dead code.
  void toggleHighlight;

  async function sendNow(id: ReportId, recipients: string[]) {
    const briefTitle = REPORT_META[id].title;
    if (recipients.length === 0 || !recipients.every(isValidEmail)) {
      toast.error(`Couldn't send the ${briefTitle}`, {
        description: 'Add at least one valid recipient first.',
      });
      return;
    }
    setOutcomes((o) => ({ ...o, [id]: { kind: 'pending' } }));
    try {
      const res = await fetch('/api/brief/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: recipients, cadence: id }),
      });
      const json = await res.json();
      if (!res.ok) {
        setOutcomes((o) => ({ ...o, [id]: { kind: 'idle' } }));
        toast.error(`Couldn't send the ${briefTitle}`, {
          description: json?.error?.message ?? 'Unknown error',
        });
        return;
      }
      const sentTo: string[] = Array.isArray(json.to) ? json.to : recipients;
      setOutcomes((o) => ({
        ...o,
        [id]: {
          kind: 'success',
          to: sentTo,
          pdfBytes: json.pdfBytes,
          id: json.id,
        },
      }));
      toast.success(`${briefTitle} sent`, {
        description: `Delivered to ${summarizeRecipients(sentTo)} · PDF ${(json.pdfBytes / 1024).toFixed(1)} KB`,
      });
    } catch (e) {
      setOutcomes((o) => ({ ...o, [id]: { kind: 'idle' } }));
      toast.error(`Couldn't send the ${briefTitle}`, {
        description: e instanceof Error ? e.message : 'Network error',
      });
    }
  }

  type SaveBody = {
    timeLocal: string;
    timezone: string;
    recipients: string[];
    enabled: boolean;
    dayOfWeek?: number;
    dayOfMonth?: MonthlyScheduleValues['dayOfMonth'];
  };

  async function saveSchedule(id: ReportId, body: SaveBody) {
    const briefTitle = REPORT_META[id].title;
    setScheduleOutcomes((o) => ({ ...o, [id]: { kind: 'pending' } }));
    try {
      const res = await fetch(`/api/schedules/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setScheduleOutcomes((o) => ({ ...o, [id]: { kind: 'idle' } }));
        toast.error(`Couldn't save the ${briefTitle}`, {
          description:
            typeof json?.error === 'string'
              ? json.error
              : `Save failed (HTTP ${res.status})`,
        });
        return;
      }
      const saved: ServerSchedule = json.schedule;
      setServerRows((rows) => ({ ...rows, [id]: saved }));
      // Re-seed the form from the saved server row — covers the case where
      // the server snapped the time to a 15-minute grid.
      if (id === 'daily') dailyForm.reset(dailyFromServer(saved));
      if (id === 'weekly') weeklyForm.reset(weeklyFromServer(saved));
      if (id === 'monthly') monthlyForm.reset(monthlyFromServer(saved));
      setScheduleOutcomes((o) => ({
        ...o,
        [id]: { kind: 'saved', nextRunAt: saved.nextRunAt ?? '' },
      }));
      toast.success(`${briefTitle} scheduled`, {
        description: saved.nextRunAt
          ? `Next run ${formatNextRun(saved.nextRunAt, timezone)}`
          : undefined,
      });
    } catch (e) {
      setScheduleOutcomes((o) => ({ ...o, [id]: { kind: 'idle' } }));
      toast.error(`Couldn't save the ${briefTitle}`, {
        description: e instanceof Error ? e.message : 'Network error',
      });
    }
  }

  async function onSubmitDaily(values: DailyScheduleValues) {
    await saveSchedule('daily', {
      timeLocal: values.timeLocal,
      timezone,
      recipients: values.recipients,
      enabled: serverRows.daily?.enabled ?? values.enabled,
    });
  }
  async function onSubmitWeekly(values: WeeklyScheduleValues) {
    await saveSchedule('weekly', {
      timeLocal: values.timeLocal,
      timezone,
      recipients: values.recipients,
      enabled: serverRows.weekly?.enabled ?? values.enabled,
      dayOfWeek: values.dayOfWeek,
    });
  }
  async function onSubmitMonthly(values: MonthlyScheduleValues) {
    await saveSchedule('monthly', {
      timeLocal: values.timeLocal,
      timezone,
      recipients: values.recipients,
      enabled: serverRows.monthly?.enabled ?? values.enabled,
      dayOfMonth: values.dayOfMonth,
    });
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
      const body: SaveBody = {
        timeLocal: row.timeLocal,
        timezone: row.timezone,
        recipients: row.recipients,
        enabled: nextEnabled,
      };
      if (id === 'weekly') body.dayOfWeek = row.dayOfWeek ?? 1;
      if (id === 'monthly')
        body.dayOfMonth =
          (row.dayOfMonth as MonthlyScheduleValues['dayOfMonth'] | null) ??
          'last';

      const res = await fetch(`/api/schedules/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      const briefTitle = REPORT_META[id].title;
      if (!res.ok) {
        setServerRows((rows) => ({ ...rows, [id]: previous }));
        setScheduleOutcomes((o) => ({ ...o, [id]: { kind: 'idle' } }));
        toast.error(`Couldn't ${nextEnabled ? 'resume' : 'pause'} ${briefTitle}`, {
          description:
            typeof json?.error === 'string'
              ? json.error
              : `HTTP ${res.status}`,
        });
        return;
      }
      const saved: ServerSchedule = json.schedule;
      setServerRows((rows) => ({ ...rows, [id]: saved }));
      if (id === 'daily') dailyForm.reset(dailyFromServer(saved));
      if (id === 'weekly') weeklyForm.reset(weeklyFromServer(saved));
      if (id === 'monthly') monthlyForm.reset(monthlyFromServer(saved));
      setScheduleOutcomes((o) => ({
        ...o,
        [id]: nextEnabled
          ? { kind: 'resumed', nextRunAt: saved.nextRunAt ?? '' }
          : { kind: 'paused' },
      }));
      toast.success(nextEnabled ? `${briefTitle} resumed` : `${briefTitle} paused`, {
        description:
          nextEnabled && saved.nextRunAt
            ? `Next run ${formatNextRun(saved.nextRunAt, timezone)}`
            : undefined,
      });
    } catch (e) {
      setServerRows((rows) => ({ ...rows, [id]: previous }));
      setScheduleOutcomes((o) => ({ ...o, [id]: { kind: 'idle' } }));
      toast.error(`Couldn't update ${REPORT_META[id].title}`, {
        description: e instanceof Error ? e.message : 'Network error',
      });
    }
  }

  async function removeSchedule(id: ReportId) {
    if (!serverRows[id]) return;
    const briefTitle = REPORT_META[id].title;
    const ok = await confirm({
      title: 'Remove this schedule',
      description: `Automatic sends will stop for the ${briefTitle}. You can still trigger one manually with Send now.`,
      confirmLabel: 'Remove schedule',
      destructive: true,
    });
    if (!ok) return;

    setScheduleOutcomes((o) => ({ ...o, [id]: { kind: 'pending' } }));
    try {
      const res = await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setScheduleOutcomes((o) => ({ ...o, [id]: { kind: 'idle' } }));
        toast.error(`Couldn't remove ${briefTitle}`, {
          description:
            typeof json?.error === 'string'
              ? json.error
              : `HTTP ${res.status}`,
        });
        return;
      }
      setServerRows((rows) => ({ ...rows, [id]: null }));
      // Reset the form back to defaults so the next "Schedule" press starts
      // clean rather than re-saving the just-removed row.
      if (id === 'daily') dailyForm.reset(DEFAULT_FORMS.daily);
      if (id === 'weekly') weeklyForm.reset(DEFAULT_FORMS.weekly);
      if (id === 'monthly') monthlyForm.reset(DEFAULT_FORMS.monthly);
      setScheduleOutcomes((o) => ({ ...o, [id]: { kind: 'removed' } }));
      toast.success(`${briefTitle} schedule removed`);
    } catch (e) {
      setScheduleOutcomes((o) => ({ ...o, [id]: { kind: 'idle' } }));
      toast.error(`Couldn't remove ${briefTitle}`, {
        description: e instanceof Error ? e.message : 'Network error',
      });
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-10">
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

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as TabValue)}
        name="scheduler"
        className="vera-rise-delay-1 gap-6"
      >
        <TabsList aria-label="Scheduler sections">
          <Tab value="report">Reports</Tab>
          <Tab value="sync">Data sync</Tab>
          <Tab value="automation">Automation</Tab>
        </TabsList>

        <TabsContent value="report" className="space-y-4 pt-6">
          <p className="text-text-muted text-xs">3 cadences available</p>
          {serverRowsLoaded ? (
            <>
              <DailyReportRow
                form={dailyForm}
                serverRow={serverRows.daily}
                outcome={outcomes.daily}
                scheduleOutcome={scheduleOutcomes.daily}
                hydrated={hydrated}
                timezone={timezone}
                onSendNow={(recipients) => sendNow('daily', recipients)}
                onSubmit={onSubmitDaily}
                onToggleEnabled={(v) => setEnabled('daily', v)}
                onRemove={() => removeSchedule('daily')}
              />
              <WeeklyReportRow
                form={weeklyForm}
                serverRow={serverRows.weekly}
                outcome={outcomes.weekly}
                scheduleOutcome={scheduleOutcomes.weekly}
                hydrated={hydrated}
                timezone={timezone}
                onSendNow={(recipients) => sendNow('weekly', recipients)}
                onSubmit={onSubmitWeekly}
                onToggleEnabled={(v) => setEnabled('weekly', v)}
                onRemove={() => removeSchedule('weekly')}
              />
              <MonthlyReportRow
                form={monthlyForm}
                serverRow={serverRows.monthly}
                outcome={outcomes.monthly}
                scheduleOutcome={scheduleOutcomes.monthly}
                hydrated={hydrated}
                timezone={timezone}
                onSendNow={(recipients) => sendNow('monthly', recipients)}
                onSubmit={onSubmitMonthly}
                onToggleEnabled={(v) => setEnabled('monthly', v)}
                onRemove={() => removeSchedule('monthly')}
              />
            </>
          ) : (
            (['daily', 'weekly', 'monthly'] as ReportId[]).map((id) => (
              <ReportRowSkeleton key={id} cadence={id} />
            ))
          )}
        </TabsContent>

        <TabsContent value="sync" className="space-y-4 pt-6">
          <DataSyncSection />
        </TabsContent>

        <TabsContent value="automation" className="space-y-4 pt-6">
          <AutomationTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ============================================================================
 * Per-cadence row components. Each owns its own RHF form; the parent passes
 * the form instance in so the parent's submit handler (which knows the
 * timezone) can run.
 * ========================================================================== */

type SendOutcomeForRow = SendOutcome;

function ReportRowChrome({
  reportId,
  serverRow,
  outcome,
  scheduleOutcome,
  hydrated,
  timezone,
  cadenceLine,
  recipients,
  saveDisabled,
  saveLabel,
  isSubmitting,
  onToggleEnabled,
  onRemove,
  onSendNow,
  children,
}: {
  reportId: ReportId;
  serverRow: ServerSchedule | null;
  outcome: SendOutcomeForRow;
  scheduleOutcome: ScheduleOutcome;
  hydrated: boolean;
  timezone: string;
  cadenceLine: string;
  recipients: string[];
  saveDisabled: boolean;
  saveLabel: string;
  isSubmitting: boolean;
  onToggleEnabled: (next: boolean) => void;
  onRemove: () => void;
  onSendNow: (recipients: string[]) => void;
  children: React.ReactNode;
}) {
  const meta = REPORT_META[reportId];
  const allRecipientsParse = recipients.every(isValidEmail);
  const hasRecipient = recipients.length > 0;
  const recipientsOk = hasRecipient && allRecipientsParse;

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
  const dimBodyClass = isPaused ? 'opacity-60' : '';

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
                <h3 className="font-display text-lg tracking-tight sm:text-xl">
                  {meta.title}
                </h3>
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
                  recipients={serverRow.recipients}
                />
              ) : null}
            </div>
          </div>

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

        <div className={`space-y-5 transition-opacity ${dimBodyClass}`}>
          {children}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1" />
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
                type="submit"
                variant="secondary"
                disabled={saveDisabled || isSubmitting}
              >
                <CalendarClock className="mr-2 h-3.5 w-3.5" />
                <span className="whitespace-nowrap">{saveLabel}</span>
              </Button>
              <Button
                type="button"
                onClick={() => onSendNow(recipients)}
                disabled={!recipientsOk || outcome.kind === 'pending'}
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

function DailyReportRow({
  form,
  serverRow,
  outcome,
  scheduleOutcome,
  hydrated,
  timezone,
  onSubmit,
  onSendNow,
  onToggleEnabled,
  onRemove,
}: {
  form: UseFormReturn<DailyScheduleValues>;
  serverRow: ServerSchedule | null;
  outcome: SendOutcome;
  scheduleOutcome: ScheduleOutcome;
  hydrated: boolean;
  timezone: string;
  onSubmit: (values: DailyScheduleValues) => Promise<void>;
  onSendNow: (recipients: string[]) => void;
  onToggleEnabled: (next: boolean) => void;
  onRemove: () => void;
}) {
  const values = form.watch();
  const tzLabel = tzAbbreviation(timezone);
  const cadenceLine = describeDailyCadence(values.timeLocal, tzLabel);
  const dirty = serverRow ? isDailyDirty(values, serverRow) : true;
  const saveDisabled =
    !form.formState.isValid ||
    scheduleOutcome.kind === 'pending' ||
    (serverRow !== null && !dirty);
  const saveLabel = (() => {
    if (form.formState.isSubmitting || scheduleOutcome.kind === 'pending') {
      return serverRow ? 'Saving…' : 'Scheduling…';
    }
    return serverRow ? 'Save changes' : 'Schedule';
  })();

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <ReportRowChrome
          reportId="daily"
          serverRow={serverRow}
          outcome={outcome}
          scheduleOutcome={scheduleOutcome}
          hydrated={hydrated}
          timezone={timezone}
          cadenceLine={cadenceLine}
          recipients={values.recipients}
          saveDisabled={saveDisabled}
          saveLabel={saveLabel}
          isSubmitting={form.formState.isSubmitting}
          onToggleEnabled={onToggleEnabled}
          onRemove={onRemove}
          onSendNow={onSendNow}
        >
          <div className="border-border bg-bg-base/40 grid grid-cols-1 gap-4 rounded-2xl border p-4">
            <FormField
              control={form.control}
              name="timeLocal"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <FieldLabel>Time (your local time)</FieldLabel>
                  <FormControl>
                    <TimePicker
                      value={field.value}
                      onChange={field.onChange}
                      ariaLabel="Time for Daily AR brief"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <RecipientsField
            control={form.control}
            ariaLabel="Recipients for Daily AR brief"
          />
        </ReportRowChrome>
      </form>
    </Form>
  );
}

function WeeklyReportRow({
  form,
  serverRow,
  outcome,
  scheduleOutcome,
  hydrated,
  timezone,
  onSubmit,
  onSendNow,
  onToggleEnabled,
  onRemove,
}: {
  form: UseFormReturn<WeeklyScheduleValues>;
  serverRow: ServerSchedule | null;
  outcome: SendOutcome;
  scheduleOutcome: ScheduleOutcome;
  hydrated: boolean;
  timezone: string;
  onSubmit: (values: WeeklyScheduleValues) => Promise<void>;
  onSendNow: (recipients: string[]) => void;
  onToggleEnabled: (next: boolean) => void;
  onRemove: () => void;
}) {
  const values = form.watch();
  const tzLabel = tzAbbreviation(timezone);
  const cadenceLine = describeWeeklyCadence(
    values.dayOfWeek,
    values.timeLocal,
    tzLabel,
  );
  const dirty = serverRow ? isWeeklyDirty(values, serverRow) : true;
  const saveDisabled =
    !form.formState.isValid ||
    scheduleOutcome.kind === 'pending' ||
    (serverRow !== null && !dirty);
  const saveLabel = (() => {
    if (form.formState.isSubmitting || scheduleOutcome.kind === 'pending') {
      return serverRow ? 'Saving…' : 'Scheduling…';
    }
    return serverRow ? 'Save changes' : 'Schedule';
  })();

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <ReportRowChrome
          reportId="weekly"
          serverRow={serverRow}
          outcome={outcome}
          scheduleOutcome={scheduleOutcome}
          hydrated={hydrated}
          timezone={timezone}
          cadenceLine={cadenceLine}
          recipients={values.recipients}
          saveDisabled={saveDisabled}
          saveLabel={saveLabel}
          isSubmitting={form.formState.isSubmitting}
          onToggleEnabled={onToggleEnabled}
          onRemove={onRemove}
          onSendNow={onSendNow}
        >
          <div className="border-border bg-bg-base/40 grid grid-cols-1 gap-4 rounded-2xl border p-4 md:grid-cols-2">
            <FormField
              control={form.control}
              name="dayOfWeek"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <FieldLabel>Day of week</FieldLabel>
                  <FormControl>
                    <ShadcnSelect
                      value={String(field.value)}
                      onChange={(v) => field.onChange(Number.parseInt(v, 10))}
                      options={DAY_OF_WEEK_OPTIONS}
                      ariaLabel="Day of week"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="timeLocal"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <FieldLabel>Time (your local time)</FieldLabel>
                  <FormControl>
                    <TimePicker
                      value={field.value}
                      onChange={field.onChange}
                      ariaLabel="Time for Weekly summary"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <RecipientsField
            control={form.control}
            ariaLabel="Recipients for Weekly summary"
          />
        </ReportRowChrome>
      </form>
    </Form>
  );
}

function MonthlyReportRow({
  form,
  serverRow,
  outcome,
  scheduleOutcome,
  hydrated,
  timezone,
  onSubmit,
  onSendNow,
  onToggleEnabled,
  onRemove,
}: {
  form: UseFormReturn<MonthlyScheduleValues>;
  serverRow: ServerSchedule | null;
  outcome: SendOutcome;
  scheduleOutcome: ScheduleOutcome;
  hydrated: boolean;
  timezone: string;
  onSubmit: (values: MonthlyScheduleValues) => Promise<void>;
  onSendNow: (recipients: string[]) => void;
  onToggleEnabled: (next: boolean) => void;
  onRemove: () => void;
}) {
  const values = form.watch();
  const tzLabel = tzAbbreviation(timezone);
  const cadenceLine = describeMonthlyCadence(
    values.dayOfMonth,
    values.timeLocal,
    tzLabel,
  );
  const dirty = serverRow ? isMonthlyDirty(values, serverRow) : true;
  const saveDisabled =
    !form.formState.isValid ||
    scheduleOutcome.kind === 'pending' ||
    (serverRow !== null && !dirty);
  const saveLabel = (() => {
    if (form.formState.isSubmitting || scheduleOutcome.kind === 'pending') {
      return serverRow ? 'Saving…' : 'Scheduling…';
    }
    return serverRow ? 'Save changes' : 'Schedule';
  })();

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <ReportRowChrome
          reportId="monthly"
          serverRow={serverRow}
          outcome={outcome}
          scheduleOutcome={scheduleOutcome}
          hydrated={hydrated}
          timezone={timezone}
          cadenceLine={cadenceLine}
          recipients={values.recipients}
          saveDisabled={saveDisabled}
          saveLabel={saveLabel}
          isSubmitting={form.formState.isSubmitting}
          onToggleEnabled={onToggleEnabled}
          onRemove={onRemove}
          onSendNow={onSendNow}
        >
          <div className="border-border bg-bg-base/40 grid grid-cols-1 gap-4 rounded-2xl border p-4 md:grid-cols-2">
            <FormField
              control={form.control}
              name="dayOfMonth"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <FieldLabel>Day of month</FieldLabel>
                  <FormControl>
                    <ShadcnSelect
                      value={String(field.value)}
                      onChange={(v) =>
                        field.onChange(
                          v as MonthlyScheduleValues['dayOfMonth'],
                        )
                      }
                      options={DAY_OF_MONTH_OPTIONS}
                      ariaLabel="Day of month"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="timeLocal"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <FieldLabel>Time (your local time)</FieldLabel>
                  <FormControl>
                    <TimePicker
                      value={field.value}
                      onChange={field.onChange}
                      ariaLabel="Time for Monthly close"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <RecipientsField
            control={form.control}
            ariaLabel="Recipients for Monthly close"
          />
        </ReportRowChrome>
      </form>
    </Form>
  );
}

/**
 * Shared recipients field used by every cadence. The control is typed as
 * `any` here because each cadence's form has a different shape, but the
 * `recipients` slot is always `string[]`. Inside the FormField render we
 * narrow the field type explicitly. (No `useState` for the chip values —
 * RHF owns them.)
 */
function RecipientsField({
  control,
  ariaLabel,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any;
  ariaLabel: string;
}) {
  return (
    <div className="border-border bg-bg-base/40 space-y-1.5 rounded-2xl border p-4">
      <label className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
        Recipients
      </label>
      <p className="text-text-secondary text-xs">
        Everyone listed here gets this brief when it sends.
      </p>
      <FormField
        control={control}
        name="recipients"
        render={({ field, fieldState }) => (
          <FormItem>
            <FormControl>
              <EmailChipInput
                value={(field.value ?? []) as string[]}
                onChange={(next) => field.onChange(next)}
                max={RECIPIENTS_CAP}
                placeholder="gm@yourcompany.com"
                ariaLabel={ariaLabel}
                invalid={!!fieldState.error}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
      {children}
    </label>
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
  recipients,
}: {
  nextRunAt: string | null;
  lastRunAt: string | null;
  timezone: string;
  recipients: string[];
}) {
  return (
    <p className="text-text-muted text-xs">
      <span>
        To{' '}
        <strong className="text-text-secondary">
          {summarizeRecipients(recipients)}
        </strong>
      </span>
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

function describeDailyCadence(timeLocal: string, tzLabel: string): string {
  const time = tzLabel
    ? `${formatTime12h(timeLocal)} ${tzLabel}`
    : formatTime12h(timeLocal);
  return `Every weekday at ${time}`;
}

function describeWeeklyCadence(
  dayOfWeek: number,
  timeLocal: string,
  tzLabel: string,
): string {
  const time = tzLabel
    ? `${formatTime12h(timeLocal)} ${tzLabel}`
    : formatTime12h(timeLocal);
  const day =
    DAY_OF_WEEK_OPTIONS.find((o) => o.value === String(dayOfWeek))?.label ??
    'Mondays';
  return `${day} at ${time}`;
}

function describeMonthlyCadence(
  dayOfMonth: MonthlyScheduleValues['dayOfMonth'],
  timeLocal: string,
  tzLabel: string,
): string {
  const time = tzLabel
    ? `${formatTime12h(timeLocal)} ${tzLabel}`
    : formatTime12h(timeLocal);
  const day =
    DAY_OF_MONTH_OPTIONS.find((o) => o.value === dayOfMonth)?.label ??
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

/**
 * Skeleton placeholder for a single cadence row, rendered while the
 * first /api/schedules response is in flight. Same Card chrome + same
 * vertical rhythm as the real ReportRow so the layout doesn't shift
 * when real data lands and the skeleton swaps out.
 *
 * Per CLAUDE.md "Loading states: skeleton-first" — we never render the
 * row's true content (status pill, recipient field, switch) against
 * default values during the loading window. The user sees shimmering
 * placeholders until the server tells us what the actual state is.
 */
function ReportRowSkeleton({ cadence }: { cadence: ReportId }) {
  const meta = REPORT_META[cadence];
  return (
    <Card>
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="bg-bg-base flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
              <Skeleton className="h-4 w-4 rounded" />
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-lg tracking-tight sm:text-xl">
                  {meta.title}
                </h3>
                <Skeleton className="h-4 w-20 rounded-full" />
              </div>
              <p className="text-text-secondary text-sm leading-relaxed">
                {meta.description}
              </p>
              <SkeletonText width="w-64" />
            </div>
          </div>
          <Skeleton className="h-5 w-9 rounded-full" />
        </div>

        <div
          className={`border-border bg-bg-base/40 grid grid-cols-1 gap-4 rounded-2xl border p-4 ${
            cadence === 'daily' ? '' : 'md:grid-cols-2'
          }`}
        >
          {cadence !== 'daily' ? (
            <div className="space-y-1.5">
              <SkeletonText width="w-20" className="h-2" />
              <Skeleton className="h-10 w-full rounded-xl" />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <SkeletonText width="w-16" className="h-2" />
            <Skeleton className="h-10 w-full rounded-xl" />
          </div>
        </div>

        <div className="border-border bg-bg-base/40 space-y-1.5 rounded-2xl border p-4">
          <SkeletonText width="w-20" className="h-2" />
          <SkeletonText width="w-64" />
          <Skeleton className="h-10 w-full rounded-xl" />
        </div>

        <div className="flex items-center justify-end gap-2">
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-10 w-32 rounded-full" />
          <Skeleton className="h-10 w-28 rounded-full" />
        </div>
      </div>
    </Card>
  );
}
