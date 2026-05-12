'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Play,
  Square,
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
  Skeleton,
  SkeletonText,
  Switch,
  TimePicker,
  toast,
  useConfirm,
} from '@vera/ui';

/**
 * "Data sync" section of /dashboard/scheduler — owns its own data flow.
 * Two cards, one per backfill source (rooflink_jobs, rooflink_lineitems).
 *
 * State strategy mirrors the existing ReportRow pattern in SchedulerView:
 * server is source of truth; the local form is a draft until "Save changes"
 * is pressed. The Run-now / Cancel / progress display is a separate
 * lifecycle tied to BackfillRun rows, polled every 5s while active.
 */

type Source = 'rooflink_jobs' | 'rooflink_lineitems';

interface BackfillSchedule {
  id: number;
  tenantId: number;
  source: Source;
  cadence: 'daily' | 'weekly' | 'monthly';
  dayOfWeek: number | null;
  dayOfMonth: string | null;
  timeLocal: string;
  timezone: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastSyncedAt: string | null;
  lastFullSyncAt: string | null;
}

interface BackfillRun {
  id: number;
  tenantId: number;
  source: Source;
  scheduleId: number | null;
  status: 'queued' | 'running' | 'completed' | 'canceled' | 'failed';
  mode: 'full' | 'incremental';
  syncedSince: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  itemsProcessed: number;
  itemsTotal: number | null;
  errorCount: number;
  lastError: string | null;
  promoted: boolean;
}

const SOURCE_META: Record<
  Source,
  { title: string; description: string; approxTotal: number }
> = {
  rooflink_jobs: {
    title: 'Rooflink jobs',
    description:
      'Bulk list of every job. Roll-up totals — gt_price, payments, profit. The breadth source.',
    approxTotal: 103_440,
  },
  rooflink_lineitems: {
    title: 'Rooflink line items',
    description:
      'Per-estimate breakdown — RCV, depreciation, withheld, supplements, change orders. The depth source.',
    approxTotal: 8_492,
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

const CADENCE_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

interface DraftForm {
  cadence: 'daily' | 'weekly' | 'monthly';
  dayOfWeek: string;
  dayOfMonth: string;
  timeLocal: string;
}

const DEFAULT_FORM: DraftForm = {
  cadence: 'weekly',
  dayOfWeek: '1',
  dayOfMonth: 'last',
  timeLocal: '03:00',
};

function resolveTimezone(): string {
  if (typeof window === 'undefined') return 'America/Chicago';
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'America/Chicago';
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

function formatTime(iso: string | null, timezone: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
    timeZoneName: 'short',
  });
}

function formFromSchedule(s: BackfillSchedule): DraftForm {
  return {
    cadence: s.cadence,
    dayOfWeek: String(s.dayOfWeek ?? 1),
    dayOfMonth: s.dayOfMonth ?? 'last',
    timeLocal: s.timeLocal,
  };
}

function isDirty(form: DraftForm, server: BackfillSchedule): boolean {
  if (form.cadence !== server.cadence) return true;
  if (form.timeLocal !== server.timeLocal) return true;
  if (form.cadence === 'weekly') {
    if (Number(form.dayOfWeek) !== (server.dayOfWeek ?? 1)) return true;
  }
  if (form.cadence === 'monthly') {
    if (form.dayOfMonth !== (server.dayOfMonth ?? 'last')) return true;
  }
  return false;
}

export function DataSyncSection() {
  const [timezone, setTimezone] = useState('America/Chicago');
  // `false` until the first /api/backfills response lands. Drives the
  // skeleton rows below — without this we'd briefly render every source
  // card as "Not scheduled" before the real server state swaps in.
  // See CLAUDE.md "Loading states: skeleton-first" for the convention.
  const [schedulesLoaded, setSchedulesLoaded] = useState(false);
  const [schedules, setSchedules] = useState<Record<Source, BackfillSchedule | null>>({
    rooflink_jobs: null,
    rooflink_lineitems: null,
  });
  const [lastPromoted, setLastPromoted] = useState<Record<Source, BackfillRun | null>>({
    rooflink_jobs: null,
    rooflink_lineitems: null,
  });
  /** Most recent run regardless of status — used to surface failures. */
  const [mostRecentRun, setMostRecentRun] = useState<Record<Source, BackfillRun | null>>({
    rooflink_jobs: null,
    rooflink_lineitems: null,
  });
  const [activeRuns, setActiveRuns] = useState<Record<Source, BackfillRun | null>>({
    rooflink_jobs: null,
    rooflink_lineitems: null,
  });
  const [forms, setForms] = useState<Record<Source, DraftForm>>({
    rooflink_jobs: { ...DEFAULT_FORM, timeLocal: '03:00' },
    rooflink_lineitems: { ...DEFAULT_FORM, timeLocal: '03:30' },
  });
  const [pendingAction, setPendingAction] = useState<Record<Source, string | null>>({
    rooflink_jobs: null,
    rooflink_lineitems: null,
  });
  const confirm = useConfirm();

  /** Per-source toast tracking. We store both the stable sonner id (so
   *  successive toast() calls replace the same toast) AND the specific
   *  BackfillRun.id this toast was opened for — that lets us wait until
   *  `mostRecentRun` actually reflects THAT run's terminal status before
   *  promoting to success/error. Without the runId guard, a poll race
   *  where `/api/backfills/active` updates before `/api/backfills` would
   *  cause the loader to disappear via the "unknown state" branch. */
  const toastTrackerRef = useRef<
    Record<Source, { toastId: string; runId: number } | null>
  >({
    rooflink_jobs: null,
    rooflink_lineitems: null,
  });
  /** When itemsProcessed last advanced, so the loader toast can show
   *  "last write Xs ago" the way the inline indicator used to. */
  const lastProgressRef = useRef<
    Record<Source, { processed: number; at: number } | null>
  >({
    rooflink_jobs: null,
    rooflink_lineitems: null,
  });

  function sourceLabel(source: Source): string {
    return SOURCE_META[source].title;
  }

  const loadAll = useCallback(async () => {
    try {
      const res = await fetch('/api/backfills', { cache: 'no-store' });
      if (!res.ok) return;
      const json = (await res.json()) as {
        schedules: BackfillSchedule[];
        runs: Array<{
          source: Source;
          latest: BackfillRun | null;
          lastPromoted: BackfillRun | null;
        }>;
      };
      const sch: Record<Source, BackfillSchedule | null> = {
        rooflink_jobs: null,
        rooflink_lineitems: null,
      };
      for (const row of json.schedules) {
        if (row.source in sch) sch[row.source] = row;
      }
      setSchedules(sch);

      const promoted: Record<Source, BackfillRun | null> = {
        rooflink_jobs: null,
        rooflink_lineitems: null,
      };
      const latestAny: Record<Source, BackfillRun | null> = {
        rooflink_jobs: null,
        rooflink_lineitems: null,
      };
      for (const r of json.runs) {
        promoted[r.source] = r.lastPromoted ?? null;
        latestAny[r.source] = r.latest ?? null;
      }
      setLastPromoted(promoted);
      setMostRecentRun(latestAny);

      // For cadences that have a schedule, prefer the server values over
      // the local form defaults.
      setForms((prev) => {
        const next = { ...prev };
        for (const s of ['rooflink_jobs', 'rooflink_lineitems'] as Source[]) {
          if (sch[s]) next[s] = formFromSchedule(sch[s]!);
        }
        return next;
      });
    } catch {
      /* network blip — leave UI on previous values */
    } finally {
      // Flip schedulesLoaded once — drives the skeleton-off transition.
      // If the fetch failed entirely, we still flip so the page doesn't
      // sit on skeletons forever; the user sees state A everywhere and
      // can save fresh.
      setSchedulesLoaded(true);
    }
  }, []);

  const loadActive = useCallback(async () => {
    try {
      const res = await fetch('/api/backfills/active', { cache: 'no-store' });
      if (!res.ok) return;
      const json = (await res.json()) as {
        active: BackfillRun[];
        recent: BackfillRun[];
      };
      const next: Record<Source, BackfillRun | null> = {
        rooflink_jobs: null,
        rooflink_lineitems: null,
      };
      for (const r of json.active) {
        if (r.source in next) next[r.source] = r;
      }
      setActiveRuns(next);
    } catch {
      /* poll silently */
    }
  }, []);

  // Initial load + timezone resolution.
  useEffect(() => {
    setTimezone(resolveTimezone());
    void loadAll();
    void loadActive();
  }, [loadAll, loadActive]);

  // Persistent-loader toast lifecycle.
  // Each source gets a single sonner toast tied to its stable id. When an
  // active run exists, we keep replacing it with `toast.loading(...)` and
  // the latest progress. When the run terminates, we replace once with a
  // success / error / dismiss. Stays visible across pages because <Toaster>
  // lives in the root layout — limitation: only updates while this section
  // is mounted (i.e., on /dashboard/scheduler).
  useEffect(() => {
    for (const source of ['rooflink_jobs', 'rooflink_lineitems'] as Source[]) {
      const active = activeRuns[source];
      const toastId = `backfill:${source}`;

      if (active && active.status === 'running') {
        // Track when items last advanced.
        const prev = lastProgressRef.current[source];
        if (!prev || active.itemsProcessed !== prev.processed) {
          lastProgressRef.current[source] = {
            processed: active.itemsProcessed,
            at: Date.now(),
          };
        }
        const silenceSec = Math.floor(
          (Date.now() - (lastProgressRef.current[source]?.at ?? Date.now())) / 1000,
        );

        const total = active.itemsTotal;
        const modeLabel =
          active.mode === 'incremental' ? 'incremental sync' : 'full sync';
        const title = `${sourceLabel(source)} · ${modeLabel}`;

        let description: string;
        if (total === null) {
          description = 'Counting records to sync…';
        } else {
          const pctNum = Math.min(100, (active.itemsProcessed / total) * 100);
          const pctStr =
            pctNum < 10 ? pctNum.toFixed(1) : Math.round(pctNum).toString();
          const base = `${active.itemsProcessed.toLocaleString()} / ${total.toLocaleString()} rows · ${pctStr}%`;
          description = silenceSec > 5 ? `${base} · ${silenceSec}s since last write` : base;
        }

        toast.loading(title, { id: toastId, description, duration: Infinity });
        toastTrackerRef.current[source] = { toastId, runId: active.id };
        continue;
      }

      // No active run — but if we previously opened a loader toast, wait
      // until `mostRecentRun` reflects THE SAME run's terminal state
      // before promoting. Otherwise we hit a poll race where the active
      // list updated before `/api/backfills`, and `mostRecentRun` still
      // shows the previous "running" snapshot.
      const tracker = toastTrackerRef.current[source];
      if (!tracker) continue;

      const recent = mostRecentRun[source];
      if (!recent || recent.id !== tracker.runId) {
        // Same toast id still being tracked; just wait for mostRecentRun
        // to catch up. The loader toast stays visible (it last rendered
        // at the final progress numbers).
        continue;
      }

      // mostRecentRun now matches the run we were tracking — safe to promote.
      if (recent.status === 'completed') {
        toast.success(`${sourceLabel(source)} sync complete`, {
          id: tracker.toastId,
          description:
            recent.itemsProcessed === 0
              ? 'No new changes since the last sync'
              : `${recent.itemsProcessed.toLocaleString()} ${recent.itemsProcessed === 1 ? 'record' : 'records'} updated`,
          duration: 5000,
        });
      } else if (recent.status === 'failed') {
        toast.error(`${sourceLabel(source)} sync failed`, {
          id: tracker.toastId,
          description: recent.lastError?.slice(0, 140) ?? 'Unknown error',
          duration: 8000,
        });
      } else if (recent.status === 'canceled') {
        toast.dismiss(tracker.toastId);
      } else {
        // Still 'queued' or 'running' on the same id — keep loader; this
        // path also covers an edge case where activeRuns emptied due to a
        // brief desync. Don't clear the tracker either.
        continue;
      }
      toastTrackerRef.current[source] = null;
      lastProgressRef.current[source] = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRuns, mostRecentRun]);

  // Poll for active runs every 5s while ANY run is active. We use a ref to
  // avoid stale closures.
  const hasActiveRef = useRef(false);
  hasActiveRef.current =
    !!activeRuns.rooflink_jobs || !!activeRuns.rooflink_lineitems;

  useEffect(() => {
    if (!hasActiveRef.current) {
      // Slow poll once a minute even when idle, so a scheduled tick that
      // arrives without user action also reflects in the UI quickly.
      const slow = setInterval(() => void loadActive(), 30_000);
      return () => clearInterval(slow);
    }
    const fast = setInterval(() => {
      void loadActive();
      // Run-now → completed transition also needs a refresh of latestRuns.
      void loadAll();
    }, 5_000);
    return () => clearInterval(fast);
  }, [loadActive, loadAll, activeRuns.rooflink_jobs, activeRuns.rooflink_lineitems]);

  async function saveSchedule(source: Source) {
    setPendingAction((p) => ({ ...p, [source]: 'save' }));
    const form = forms[source];
    try {
      const res = await fetch(`/api/backfills/${source}/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cadence: form.cadence,
          dayOfWeek: form.cadence === 'weekly' ? Number(form.dayOfWeek) : null,
          dayOfMonth: form.cadence === 'monthly' ? form.dayOfMonth : null,
          timeLocal: form.timeLocal,
          timezone,
          enabled: schedules[source]?.enabled ?? true,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(`Couldn't save the ${sourceLabel(source)} schedule`, {
          description: json.error ?? 'Unknown error',
        });
        return;
      }
      setSchedules((s) => ({ ...s, [source]: json.schedule }));
      toast.success(`${sourceLabel(source)} schedule saved`);
    } catch (e) {
      toast.error(`Couldn't save the ${sourceLabel(source)} schedule`, {
        description: e instanceof Error ? e.message : 'Network error',
      });
    } finally {
      setPendingAction((p) => ({ ...p, [source]: null }));
    }
  }

  async function toggleEnabled(source: Source, next: boolean) {
    const cur = schedules[source];
    if (!cur) return;
    const optimistic = { ...cur, enabled: next };
    setSchedules((s) => ({ ...s, [source]: optimistic }));
    setPendingAction((p) => ({ ...p, [source]: 'toggle' }));
    try {
      const res = await fetch(`/api/backfills/${source}/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cadence: cur.cadence,
          dayOfWeek: cur.dayOfWeek,
          dayOfMonth: cur.dayOfMonth,
          timeLocal: cur.timeLocal,
          timezone: cur.timezone,
          enabled: next,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSchedules((s) => ({ ...s, [source]: cur }));
        toast.error(`Couldn't ${next ? 'resume' : 'pause'} ${sourceLabel(source)}`, {
          description: json.error ?? 'Unknown error',
        });
        return;
      }
      setSchedules((s) => ({ ...s, [source]: json.schedule }));
      toast.success(
        next ? `${sourceLabel(source)} resumed` : `${sourceLabel(source)} paused`,
      );
    } catch (e) {
      setSchedules((s) => ({ ...s, [source]: cur }));
      toast.error(`Couldn't update ${sourceLabel(source)}`, {
        description: e instanceof Error ? e.message : 'Network error',
      });
    } finally {
      setPendingAction((p) => ({ ...p, [source]: null }));
    }
  }

  async function removeSchedule(source: Source) {
    const ok = await confirm({
      title: `Remove ${sourceLabel(source).toLowerCase()} schedule`,
      description: `Automatic runs will stop for ${sourceLabel(source)}. You can still trigger one manually with Run sync.`,
      confirmLabel: 'Remove schedule',
      destructive: true,
    });
    if (!ok) return;
    setPendingAction((p) => ({ ...p, [source]: 'remove' }));
    try {
      const res = await fetch(`/api/backfills/${source}/schedule`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(`Couldn't remove ${sourceLabel(source)} schedule`, {
          description: json.error ?? 'Unknown error',
        });
        return;
      }
      setSchedules((s) => ({ ...s, [source]: null }));
      toast.success(`${sourceLabel(source)} schedule removed`);
    } finally {
      setPendingAction((p) => ({ ...p, [source]: null }));
    }
  }

  async function runNow(source: Source) {
    setPendingAction((p) => ({ ...p, [source]: 'run' }));
    try {
      // The server picks mode automatically — full when no watermark,
      // incremental when a watermark exists.
      const res = await fetch(`/api/backfills/${source}/runs`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(`Couldn't start ${sourceLabel(source)} sync`, {
          description: json.message ?? json.error ?? 'Unknown error',
        });
        return;
      }
      setActiveRuns((r) => ({ ...r, [source]: json.run }));
      // No immediate success toast — the persistent-loader effect above
      // will surface a loading toast for this run on the next render and
      // keep it in sync until the run terminates.
    } catch (e) {
      toast.error(`Couldn't start ${sourceLabel(source)} sync`, {
        description: e instanceof Error ? e.message : 'Network error',
      });
    } finally {
      setPendingAction((p) => ({ ...p, [source]: null }));
    }
  }

  async function cancelRun(source: Source) {
    const run = activeRuns[source];
    if (!run) return;
    const ok = await confirm({
      title: 'Cancel this run',
      description: `${run.itemsProcessed.toLocaleString()} ${run.itemsProcessed === 1 ? 'row' : 'rows'} already fetched for ${sourceLabel(source)} will be deleted.`,
      confirmLabel: 'Cancel run',
      cancelLabel: 'Keep running',
      destructive: true,
    });
    if (!ok) return;
    setPendingAction((p) => ({ ...p, [source]: 'cancel' }));
    try {
      const res = await fetch(`/api/backfills/${source}/runs/${run.id}/cancel`, {
        method: 'POST',
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(`Couldn't cancel ${sourceLabel(source)} run`, {
          description: json.error ?? 'Unknown error',
        });
        return;
      }
      setActiveRuns((r) => ({ ...r, [source]: null }));
      await loadAll();
      toast.success(`${sourceLabel(source)} run canceled`, {
        description: `${run.itemsProcessed.toLocaleString()} partial rows deleted.`,
      });
    } finally {
      setPendingAction((p) => ({ ...p, [source]: null }));
    }
  }

  return (
    <section className="vera-rise-delay-2 space-y-4" data-testid="data-sync-section">
      <div className="flex items-baseline justify-between">
        <h2 className="text-text-secondary text-sm tracking-[0.2em] uppercase">
          Data sync
        </h2>
        <p className="text-text-muted text-xs">2 sources from Rooflink</p>
      </div>

      {(['rooflink_jobs', 'rooflink_lineitems'] as Source[]).map((source) =>
        schedulesLoaded ? (
          <BackfillCard
            key={source}
            source={source}
            schedule={schedules[source]}
            activeRun={activeRuns[source]}
            lastCompletedRun={lastPromoted[source]}
            mostRecentRun={mostRecentRun[source]}
            form={forms[source]}
            timezone={timezone}
            pendingAction={pendingAction[source]}
            onFormChange={(patch) =>
              setForms((f) => ({ ...f, [source]: { ...f[source], ...patch } }))
            }
            onSave={() => saveSchedule(source)}
            onToggleEnabled={(v) => toggleEnabled(source, v)}
            onRemove={() => removeSchedule(source)}
            onRunNow={() => runNow(source)}
            onCancel={() => cancelRun(source)}
          />
        ) : (
          <BackfillCardSkeleton key={source} source={source} />
        ),
      )}
    </section>
  );
}

function BackfillCard({
  source,
  schedule,
  activeRun,
  lastCompletedRun,
  mostRecentRun,
  form,
  timezone,
  pendingAction,
  onFormChange,
  onSave,
  onToggleEnabled,
  onRemove,
  onRunNow,
  onCancel,
}: {
  source: Source;
  schedule: BackfillSchedule | null;
  activeRun: BackfillRun | null;
  lastCompletedRun: BackfillRun | null;
  mostRecentRun: BackfillRun | null;
  form: DraftForm;
  timezone: string;
  pendingAction: string | null;
  onFormChange: (patch: Partial<DraftForm>) => void;
  onSave: () => void;
  onToggleEnabled: (v: boolean) => void;
  onRemove: () => void;
  onRunNow: () => void;
  onCancel: () => void;
}) {
  const meta = SOURCE_META[source];
  const tzLabel = tzAbbreviation(timezone);
  const isRunning = !!activeRun && activeRun.status === 'running';
  const isPaused = !!schedule && !schedule.enabled;
  const dirty = schedule ? isDirty(form, schedule) : true;

  // Status pill
  let statusLabel = 'Not scheduled';
  let statusActive = false;
  if (isRunning) {
    statusLabel = 'Running';
    statusActive = true;
  } else if (schedule && schedule.enabled) {
    statusLabel = 'Scheduled';
    statusActive = true;
  } else if (schedule && !schedule.enabled) {
    statusLabel = 'Paused';
  }

  // Surface the most-recent terminal-state run's error so failures aren't
  // invisible. Only show when there's no active run — the active progress
  // toast (in the corner) takes priority.
  const recentFailure =
    !isRunning &&
    mostRecentRun &&
    (mostRecentRun.status === 'failed' || mostRecentRun.status === 'canceled') &&
    mostRecentRun.lastError
      ? mostRecentRun
      : null;

  const dimBody = isPaused ? 'opacity-60' : '';
  const saveDisabled =
    pendingAction !== null || (schedule !== null && !dirty);

  return (
    <Card data-testid={`backfill-card-${source}`}>
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
                  data-testid={`status-pill-${source}`}
                >
                  {statusLabel}
                </span>
              </div>
              <p className="text-text-secondary text-sm leading-relaxed">
                {meta.description}
              </p>
              {lastCompletedRun ? (
                <p className="text-text-muted text-xs">
                  Last successful run · {formatTime(lastCompletedRun.finishedAt, timezone)} ·{' '}
                  {lastCompletedRun.itemsProcessed.toLocaleString()} rows ·{' '}
                  <span className="font-medium">
                    {lastCompletedRun.mode === 'incremental' ? 'incremental' : 'full sync'}
                  </span>
                </p>
              ) : (
                <p className="text-text-muted text-xs">No successful run yet.</p>
              )}
              {schedule?.lastSyncedAt ? (
                <p
                  className="text-text-muted text-xs"
                  data-testid={`last-synced-${source}`}
                >
                  Next run will fetch records edited after{' '}
                  <strong className="text-text-secondary">
                    {formatTime(schedule.lastSyncedAt, timezone)}
                  </strong>
                  .
                </p>
              ) : null}
            </div>
          </div>

          {schedule ? (
            <div className="flex flex-col items-end gap-1">
              <Switch
                checked={schedule.enabled}
                onCheckedChange={onToggleEnabled}
                disabled={pendingAction !== null}
                aria-label={schedule.enabled ? `Pause ${meta.title}` : `Resume ${meta.title}`}
              />
              <p className="text-text-muted max-w-[14rem] text-right text-[0.65rem] leading-tight">
                {schedule.enabled
                  ? 'On — Vera will refresh on the schedule below.'
                  : 'Paused — no automatic refresh until you resume.'}
              </p>
            </div>
          ) : null}
        </div>

        {/* Progress moved to a persistent sonner toast — the loader stays
            visible across pages and surfaces what's running site-wide. The
            status pill + Cancel button on this card still reflect "Running"
            state for at-a-glance visibility. See DataSyncSection's toast
            lifecycle useEffect for the toast id and update rules. */}

        {/* Last-failure banner — shows when the most recent terminal run had
            an error and there's no active run to drown it out. */}
        {recentFailure ? (
          <div
            className="border-heat-critical/40 bg-heat-critical/5 rounded-2xl border p-4"
            data-testid={`failure-banner-${source}`}
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="text-heat-critical mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-1 text-sm">
                <p className="text-text-primary">
                  Last run <strong>{recentFailure.status}</strong> at{' '}
                  {recentFailure.itemsProcessed.toLocaleString()} rows
                  {recentFailure.finishedAt
                    ? ` · ${formatTime(recentFailure.finishedAt, timezone)}`
                    : ''}
                  .
                </p>
                <p className="text-text-secondary text-xs leading-relaxed">
                  {recentFailure.lastError}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {/* Cadence editor */}
        <div className={`space-y-5 transition-opacity ${dimBody}`}>
          <div className="border-border bg-bg-base/40 grid grid-cols-1 gap-4 rounded-2xl border p-4 md:grid-cols-3">
            <Field label="Cadence">
              <Select
                value={form.cadence}
                onValueChange={(v) =>
                  onFormChange({ cadence: v as 'daily' | 'weekly' | 'monthly' })
                }
              >
                <SelectTrigger aria-label="Cadence">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CADENCE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {form.cadence === 'weekly' ? (
              <Field label="Day of week">
                <Select
                  value={form.dayOfWeek}
                  onValueChange={(v) => onFormChange({ dayOfWeek: v })}
                >
                  <SelectTrigger aria-label="Day of week">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAY_OF_WEEK_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : form.cadence === 'monthly' ? (
              <Field label="Day of month">
                <Select
                  value={form.dayOfMonth}
                  onValueChange={(v) => onFormChange({ dayOfMonth: v })}
                >
                  <SelectTrigger aria-label="Day of month">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAY_OF_MONTH_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : (
              <Field label="Day">
                <p className="text-text-muted bg-bg-card border-border rounded-xl border px-4 py-2.5 text-sm">
                  Every weekday
                </p>
              </Field>
            )}
            <Field label="Time (local)">
              <TimePicker
                value={form.timeLocal}
                onChange={(v) => onFormChange({ timeLocal: v })}
                ariaLabel={`Time for ${meta.title}`}
              />
            </Field>
          </div>

          {/* Next-run line (transient errors go to toasts now, not inline) */}
          {schedule?.nextRunAt && !isRunning ? (
            <div className="border-border bg-bg-base/40 flex items-center gap-2 rounded-xl border px-3 py-2">
              <CheckCircle2 className="text-text-muted h-3.5 w-3.5 shrink-0" />
              <p className="text-text-primary text-xs">
                Next run · <strong>{formatTime(schedule.nextRunAt, timezone)}</strong>
                {tzLabel ? '' : null}
              </p>
            </div>
          ) : null}

          {/* Action row */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {schedule ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onRemove}
                disabled={pendingAction !== null}
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
              <span className="whitespace-nowrap">
                {pendingAction === 'save'
                  ? schedule
                    ? 'Saving…'
                    : 'Scheduling…'
                  : schedule
                    ? 'Save changes'
                    : 'Schedule'}
              </span>
            </Button>
            {isRunning ? (
              <Button
                type="button"
                onClick={onCancel}
                disabled={pendingAction !== null}
              >
                <Square className="mr-2 h-3.5 w-3.5" />
                <span className="whitespace-nowrap">
                  {pendingAction === 'cancel' ? 'Canceling…' : 'Cancel current run'}
                </span>
              </Button>
            ) : (
              <Button
                type="button"
                onClick={onRunNow}
                disabled={pendingAction !== null}
              >
                <Play className="mr-2 h-3.5 w-3.5" />
                <span className="whitespace-nowrap">
                  {pendingAction === 'run'
                    ? 'Starting…'
                    : schedule?.lastSyncedAt
                      ? 'Run sync'
                      : 'Run now'}
                </span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Skeleton placeholder for a backfill source card while the first
 * /api/backfills response is in flight. Same Card chrome + spacing as
 * the real BackfillCard so layout doesn't shift when real data lands.
 *
 * Per CLAUDE.md "Loading states: skeleton-first" — never render the
 * card's true state (schedule pill, "Not scheduled" copy, form
 * defaults) against unknown server state. Shimmer until we know.
 */
function BackfillCardSkeleton({ source }: { source: Source }) {
  const meta = SOURCE_META[source];
  return (
    <Card>
      <div className="space-y-5">
        {/* Title row */}
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
              <SkeletonText width="w-56" />
            </div>
          </div>
          <Skeleton className="h-5 w-9 rounded-full" />
        </div>

        {/* Config row — 3 form fields */}
        <div className="border-border bg-bg-base/40 grid grid-cols-1 gap-4 rounded-2xl border p-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div className="space-y-1.5" key={i}>
              <SkeletonText width="w-16" className="h-2" />
              <Skeleton className="h-10 w-full rounded-xl" />
            </div>
          ))}
        </div>

        {/* Action row */}
        <div className="flex items-center justify-end gap-2">
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-10 w-28 rounded-full" />
          <Skeleton className="h-10 w-28 rounded-full" />
        </div>
      </div>
    </Card>
  );
}
