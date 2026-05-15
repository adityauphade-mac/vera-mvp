'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  parseAsInteger,
  parseAsString,
  parseAsStringEnum,
  useQueryState,
} from 'nuqs';
import {
  History,
  RefreshCw,
  Search,
  Sparkles,
  User as UserIcon,
  Wrench,
} from 'lucide-react';
import {
  Button,
  Card,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  Skeleton,
  SkeletonText,
  Table,
  TableCell,
  TableHead,
  TableRow,
  TableShell,
  TablePagination,
  type TableHeadCol,
} from '@vera/ui';
import {
  AUDIT_ACTIONS_BY_CATEGORY,
  AUDIT_CATEGORIES,
  humanizeAction,
  humanizeCategory,
  type AuditCategory,
  type AuditLogEntry,
} from '@vera/types';

/**
 * Audit log table view. Filter bar on top, paginated table, click a row
 * to open the detail sheet. URL-state via nuqs so filters survive
 * reload + are shareable.
 *
 * Data is fetched from `GET /api/audit-logs` whenever filters or paging
 * change. The endpoint enforces tenant scoping via the session cookie.
 */

const PAGE_SIZE = 50 as const;
const SEARCH_DEBOUNCE_MS = 300;

const TABLE_COLUMNS: TableHeadCol[] = [
  { key: 'time', label: 'Time' },
  { key: 'who', label: 'Who' },
  { key: 'category', label: 'Category' },
  { key: 'action', label: 'Action' },
  { key: 'summary', label: 'Summary' },
  { key: 'chev', label: '' },
];

type ListResponse = {
  entries: AuditLogEntry[];
  total: number;
  limit: number;
  offset: number;
};

export function AuditLogsView() {
  const [category, setCategory] = useQueryState(
    'category',
    parseAsStringEnum<AuditCategory>([...AUDIT_CATEGORIES]),
  );
  const [action, setAction] = useQueryState('action', parseAsString);
  const [actor, setActor] = useQueryState(
    'actor',
    parseAsStringEnum(['user', 'system']),
  );
  const [q, setQ] = useQueryState('q', parseAsString.withDefault(''));
  const [offset, setOffset] = useQueryState(
    'offset',
    parseAsInteger.withDefault(0),
  );

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);

  // Build the query string from current filter state. Debounced search
  // gets applied here via the q state below.
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (action) params.set('action', action);
    if (q.trim()) params.set('q', q.trim());
    if (actor === 'system') params.set('userId', '');
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(offset));
    return params.toString();
  }, [category, action, q, actor, offset]);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/audit-logs?${queryString}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as ListResponse;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const actionOptions = useMemo(() => {
    if (!category) return Array.from(new Set(Object.values(AUDIT_ACTIONS_BY_CATEGORY).flat()));
    return [...AUDIT_ACTIONS_BY_CATEGORY[category]];
  }, [category]);

  const onCategoryChange = (next: AuditCategory | null) => {
    setCategory(next);
    setAction(null);
    setOffset(0);
  };
  const onActionChange = (next: string | null) => {
    setAction(next);
    setOffset(0);
  };
  const onActorChange = (next: 'user' | 'system' | null) => {
    setActor(next);
    setOffset(0);
  };
  const onSearchChange = (next: string) => {
    setQ(next);
    setOffset(0);
  };
  const onClearAll = () => {
    setCategory(null);
    setAction(null);
    setActor(null);
    setQ('');
    setOffset(0);
  };

  const total = data?.total ?? 0;
  const entries = data?.entries ?? [];
  const hasFilters = !!(category || action || actor || q.trim());
  // First-load skeleton vs subsequent refresh dim — `data === null`
  // is the "we've never seen results yet" state.
  const showSkeleton = loading && !data;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header className="vera-rise space-y-3">
        <p className="text-text-muted text-xs tracking-[0.2em] uppercase">
          Activity · audit log
        </p>
        <h1 className="font-display text-4xl tracking-tight md:text-5xl">
          Every action, recorded.
        </h1>
        <p className="text-text-secondary max-w-2xl text-sm leading-relaxed">
          Sign-ins, schedule edits, sends, briefing regenerations, and chat
          queries — every meaningful action lands here. Filter by who, what,
          or when; click any row for the full record.
        </p>
      </header>

      {/* Filters */}
      <Card className="vera-rise-delay-1 p-5">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <div className="space-y-1">
            <label className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
              Category
            </label>
            <Select
              value={category ?? '__all'}
              onValueChange={(v) =>
                onCategoryChange(v === '__all' ? null : (v as AuditCategory))
              }
            >
              <SelectTrigger aria-label="Category filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All categories</SelectItem>
                {AUDIT_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {humanizeCategory(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
              Action
            </label>
            <Select
              value={action ?? '__all'}
              onValueChange={(v) => onActionChange(v === '__all' ? null : v)}
            >
              <SelectTrigger aria-label="Action filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All actions</SelectItem>
                {actionOptions.map((a) => (
                  <SelectItem key={a} value={a}>
                    {humanizeAction(a)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
              Who
            </label>
            <Select
              value={actor ?? '__all'}
              onValueChange={(v) =>
                onActorChange(
                  v === '__all' ? null : (v as 'user' | 'system'),
                )
              }
            >
              <SelectTrigger aria-label="Actor filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Anyone</SelectItem>
                <SelectItem value="user">A user</SelectItem>
                <SelectItem value="system">System (cron)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1 md:col-span-2">
            <label className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
              Search summary
            </label>
            <DebouncedSearchInput value={q} onChange={onSearchChange} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-text-muted text-xs">
            {showSkeleton
              ? 'Loading…'
              : `${total.toLocaleString()} ${total === 1 ? 'entry' : 'entries'}`}
            {hasFilters ? ' · filters applied' : ''}
          </p>
          <div className="flex items-center gap-2">
            {hasFilters ? (
              <Button variant="ghost" size="sm" onClick={onClearAll}>
                Clear filters
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              onClick={fetchEntries}
              disabled={loading}
              aria-label="Refresh audit log"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="ml-1.5">Refresh</span>
            </Button>
          </div>
        </div>
      </Card>

      {/* Table */}
      <div className="vera-rise-delay-2">
        <TableShell
          maxHeight={640}
          footer={
            <TableFooter
              total={total}
              offset={offset}
              pageSize={PAGE_SIZE}
              onPageChange={(next) => setOffset((next - 1) * PAGE_SIZE)}
              loading={showSkeleton}
            />
          }
        >
          <Table>
            <TableHead columns={TABLE_COLUMNS} />
            <tbody>
              {error ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10">
                    <p className="text-heat-critical text-sm">
                      Couldn&apos;t load audit log: {error}
                    </p>
                  </TableCell>
                </TableRow>
              ) : showSkeleton ? (
                <SkeletonRows />
              ) : entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center">
                    <History className="text-text-muted mx-auto mb-2 h-6 w-6" />
                    <p className="text-text-secondary text-sm">
                      {hasFilters
                        ? 'No entries match these filters.'
                        : 'No activity yet — actions you take will show up here.'}
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                entries.map((row) => (
                  <TableRow
                    key={row.id}
                    onClick={() => setSelected(row)}
                    className="cursor-pointer"
                  >
                    <TableCell className="text-text-secondary whitespace-nowrap text-xs tabular-nums">
                      {formatTimestamp(row.createdAt)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <ActorCell
                        userEmail={row.userEmail}
                        userId={row.userId}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <CategoryPill category={row.category as AuditCategory} />
                    </TableCell>
                    <TableCell className="text-text-secondary whitespace-nowrap text-xs">
                      {humanizeAction(row.action)}
                    </TableCell>
                    <TableCell className="text-text-primary">{row.summary}</TableCell>
                    <TableCell className="text-text-muted whitespace-nowrap">
                      ›
                    </TableCell>
                  </TableRow>
                ))
              )}
            </tbody>
          </Table>
        </TableShell>
      </div>

      <AuditDetailSheet
        entry={selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

/**
 * Debounced text input — fires `onChange` 300ms after the user stops
 * typing. No Enter required. Styling matches the scheduler's email
 * field so the audit log doesn't look like a different app.
 */
function DebouncedSearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  // Keep local draft in sync if the URL state changes from elsewhere
  // (e.g. Clear filters).
  useEffect(() => {
    setDraft(value);
  }, [value]);
  // Debounce the propagation to parent.
  useEffect(() => {
    if (draft === value) return;
    const t = setTimeout(() => onChange(draft), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft, value, onChange]);
  return (
    <div className="relative">
      <Search className="text-text-muted pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2" />
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="recipient, action verb, anything in the summary…"
        className="border-border focus:border-accent bg-bg-card text-text-primary placeholder:text-text-muted w-full rounded-xl border py-2.5 pr-3 pl-9 text-sm outline-none transition-colors"
      />
    </div>
  );
}

/**
 * Footer strip: always shows "Showing X–Y of N", page controls only
 * when there's more than one page. Mirrors the pattern in other
 * dashboard tables.
 */
function TableFooter({
  total,
  offset,
  pageSize,
  onPageChange,
  loading,
}: {
  total: number;
  offset: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  loading: boolean;
}) {
  const page = Math.floor(offset / pageSize) + 1;
  const startIdx = total === 0 ? 0 : offset + 1;
  const endIdx = Math.min(offset + pageSize, total);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (loading) {
    return (
      <div className="text-text-muted px-5 py-3 text-xs">
        Loading entries…
      </div>
    );
  }

  if (totalPages > 1) {
    return (
      <TablePagination
        page={page}
        pageSize={pageSize as 10 | 25 | 50 | 100}
        total={total}
        onPageChange={onPageChange}
        onPageSizeChange={() => {
          /* fixed page size for V1 */
        }}
      />
    );
  }

  return (
    <div className="text-text-muted flex items-center justify-between px-5 py-3 text-xs">
      <span>
        {total === 0
          ? 'No entries to show'
          : `Showing ${startIdx}–${endIdx} of ${total}`}
      </span>
    </div>
  );
}

/**
 * Skeleton placeholder rows used while the very first response is in
 * flight. Subsequent refetches (filter changes) keep the previous data
 * on-screen with the table's refresh affordance spinning — no flicker.
 */
function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <TableRow key={i}>
          <TableCell className="whitespace-nowrap">
            <SkeletonText width="w-20" />
          </TableCell>
          <TableCell className="whitespace-nowrap">
            <SkeletonText width="w-36" />
          </TableCell>
          <TableCell className="whitespace-nowrap">
            <Skeleton className="h-4 w-16 rounded-full" />
          </TableCell>
          <TableCell className="whitespace-nowrap">
            <SkeletonText width="w-24" />
          </TableCell>
          <TableCell>
            <SkeletonText width="w-64" />
          </TableCell>
          <TableCell />
        </TableRow>
      ))}
    </>
  );
}

function ActorCell({
  userEmail,
  userId,
}: {
  userEmail: string | null;
  userId: number | null;
}) {
  if (userId === null) {
    return (
      <span className="text-text-muted inline-flex items-center gap-1.5 text-xs">
        <Wrench className="h-3 w-3" />
        system
      </span>
    );
  }
  return (
    <span className="text-text-secondary inline-flex items-center gap-1.5 text-xs">
      <UserIcon className="h-3 w-3" />
      {userEmail ?? `user #${userId}`}
    </span>
  );
}

function CategoryPill({ category }: { category: AuditCategory }) {
  return (
    <span className="border-border bg-bg-base text-text-muted rounded-full border px-2 py-0.5 text-[0.65rem] tracking-[0.14em] uppercase">
      {humanizeCategory(category)}
    </span>
  );
}

// ─── Detail sheet ────────────────────────────────────────────────────────

function AuditDetailSheet({
  entry,
  onClose,
}: {
  entry: AuditLogEntry | null;
  onClose: () => void;
}) {
  const open = entry !== null;
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={entry?.summary ?? 'Audit entry'}
      description={entry ? formatTimestampLong(entry.createdAt) : undefined}
      widthClass="max-w-2xl"
    >
      {entry ? (
        <div className="space-y-6 text-sm">
          <CategoryDetailBody entry={entry} />
          <DetailMetadata entry={entry} />
          <RawDetailsDisclosure details={entry.details} />
        </div>
      ) : null}
    </Sheet>
  );
}

/**
 * Pick the right human-readable body for an entry based on category +
 * action. Each branch is a small render. Fallback for forward-compat
 * is "no extra detail".
 */
function CategoryDetailBody({ entry }: { entry: AuditLogEntry }) {
  if (entry.category === 'schedule') return <ScheduleBody entry={entry} />;
  if (entry.category === 'brief') return <BriefBody entry={entry} />;
  if (entry.category === 'briefing') return <BriefingBody entry={entry} />;
  if (entry.category === 'chat') return <ChatBody entry={entry} />;
  if (entry.category === 'auth') return <AuthBody entry={entry} />;
  if (entry.category === 'backfill') return <BackfillBody entry={entry} />;
  if (entry.category === 'follow_up') return <FollowUpBody entry={entry} />;
  if (entry.category === 'automation_rules')
    return <AutomationRulesBody entry={entry} />;
  return null;
}

function AutomationRulesBody({ entry }: { entry: AuditLogEntry }) {
  const d = (entry.details ?? {}) as Record<string, unknown>;
  const action = entry.action;

  // Pretty-print individual fields by action. For evaluated, show the list of
  // fired job ids + skip count. For pending_approved/sent_failed, show the
  // recipient + subject + body preview. For created/updated, show before/after
  // snapshot.
  if (action === 'evaluated') {
    const fired = Array.isArray(d.firedJobIds) ? (d.firedJobIds as number[]) : [];
    const skipped = typeof d.skippedByCap === 'number' ? d.skippedByCap : 0;
    const trigger = typeof d.trigger === 'string' ? d.trigger : 'sync';
    return (
      <div className="space-y-2 text-sm">
        <DetailRow label="Trigger" value={trigger} />
        <DetailRow
          label="Jobs fired"
          value={fired.length > 0 ? fired.join(', ') : '—'}
        />
        {skipped > 0 ? (
          <DetailRow
            label="Skipped by daily cap"
            value={String(skipped)}
          />
        ) : null}
      </div>
    );
  }

  if (action === 'pending_approved' || action === 'pending_send_failed') {
    const recipient = typeof d.recipient === 'string' ? d.recipient : '—';
    const subject = typeof d.subject === 'string' ? d.subject : undefined;
    const body = typeof d.body === 'string' ? d.body : undefined;
    const error =
      d.error && typeof d.error === 'object'
        ? (d.error as { message?: string }).message
        : null;
    return (
      <div className="space-y-2 text-sm">
        <DetailRow label="Recipient" value={recipient} />
        {subject ? <DetailRow label="Subject" value={subject} /> : null}
        {body ? (
          <>
            <p className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
              Body
            </p>
            <pre className="text-text-primary font-sans text-sm leading-relaxed whitespace-pre-wrap">
              {body}
            </pre>
          </>
        ) : null}
        {error ? (
          <DetailRow label="Error" value={error} valueClassName="text-heat-critical" />
        ) : null}
      </div>
    );
  }

  if (action === 'pending_rejected') {
    const reason = typeof d.reason === 'string' && d.reason.length > 0 ? d.reason : '(no reason)';
    const recipient =
      typeof d.proposedRecipient === 'string' ? d.proposedRecipient : '—';
    const subject =
      typeof d.proposedSubject === 'string' ? d.proposedSubject : undefined;
    return (
      <div className="space-y-2 text-sm">
        <DetailRow label="Reason" value={reason} />
        <DetailRow label="Would have sent to" value={recipient} />
        {subject ? <DetailRow label="Subject" value={subject} /> : null}
      </div>
    );
  }

  // created / updated / deleted / enabled / disabled — show a compact
  // before/after block. The route emits { rule } for created/deleted and
  // { before, after } for updated/enabled/disabled.
  const rule = d.rule as Record<string, unknown> | undefined;
  const before = d.before as Record<string, unknown> | undefined;
  const after = d.after as Record<string, unknown> | undefined;
  const display = after ?? rule ?? before;
  if (!display) return null;
  return (
    <div className="space-y-2 text-sm">
      <DetailRow label="Name" value={String(display.name ?? '')} />
      <DetailRow
        label="Condition"
        value={`${display.metric ?? '?'} ${display.operator ?? '?'} ${display.threshold ?? '?'}`}
      />
      <DetailRow
        label="Recipient"
        value={
          display.recipientMode === 'fixed_email'
            ? String(display.recipientEmail ?? '')
            : 'Assigned rep'
        }
      />
      {before ? (
        <p className="text-text-muted text-xs">
          Before: enabled={String((before as { enabled?: boolean }).enabled)},
          threshold={String((before as { threshold?: number }).threshold)}
        </p>
      ) : null}
    </div>
  );
}

function DetailRow({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <p className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
        {label}
      </p>
      <p className={`text-text-primary text-sm ${valueClassName ?? ''}`}>
        {value}
      </p>
    </div>
  );
}

function FollowUpBody({ entry }: { entry: AuditLogEntry }) {
  const d = (entry.details ?? {}) as {
    jobId?: number | string;
    jobAddress?: string;
    repName?: string;
    to?: string[];
    cc?: string[];
    subject?: string;
    body?: string;
    resendId?: string;
    error?: { code?: string; message?: string };
  };
  const recipients = (list: string[] | undefined) =>
    !list || list.length === 0 ? '—' : list.join(', ');

  if (entry.action === 'send_failed') {
    const err = d.error?.message ?? d.error?.code ?? 'Unknown error';
    return (
      <div className="space-y-3">
        <div className="border-heat-critical/40 bg-heat-critical/5 rounded-xl border px-3 py-2">
          <p className="text-text-primary text-xs">{err}</p>
        </div>
        <div className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
          <DetailLabel>Attempted to</DetailLabel>
          <DetailValue>{recipients(d.to)}</DetailValue>
          {d.cc && d.cc.length > 0 ? (
            <>
              <DetailLabel>Cc</DetailLabel>
              <DetailValue>{recipients(d.cc)}</DetailValue>
            </>
          ) : null}
          {d.subject ? (
            <>
              <DetailLabel>Subject</DetailLabel>
              <DetailValue>{d.subject}</DetailValue>
            </>
          ) : null}
          {d.jobAddress ? (
            <>
              <DetailLabel>Job</DetailLabel>
              <DetailValue>{d.jobAddress}</DetailValue>
            </>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
        <DetailLabel>To</DetailLabel>
        <DetailValue>{recipients(d.to)}</DetailValue>
        {d.cc && d.cc.length > 0 ? (
          <>
            <DetailLabel>Cc</DetailLabel>
            <DetailValue>{recipients(d.cc)}</DetailValue>
          </>
        ) : null}
        {d.subject ? (
          <>
            <DetailLabel>Subject</DetailLabel>
            <DetailValue>{d.subject}</DetailValue>
          </>
        ) : null}
        {d.jobAddress ? (
          <>
            <DetailLabel>Job</DetailLabel>
            <DetailValue>{d.jobAddress}</DetailValue>
          </>
        ) : null}
        {d.repName ? (
          <>
            <DetailLabel>Rep</DetailLabel>
            <DetailValue>{d.repName}</DetailValue>
          </>
        ) : null}
        {d.resendId ? (
          <>
            <DetailLabel>Resend ID</DetailLabel>
            <DetailValue className="font-mono text-[11px]">{d.resendId}</DetailValue>
          </>
        ) : null}
      </div>
      {d.body ? (
        <div>
          <DetailLabel>Body</DetailLabel>
          <pre className="text-text-primary border-border bg-bg-base/60 mt-1.5 max-h-72 overflow-y-auto rounded-xl border px-3 py-2.5 font-sans text-xs leading-relaxed whitespace-pre-wrap">
            {d.body}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function BackfillBody({ entry }: { entry: AuditLogEntry }) {
  const d = (entry.details ?? {}) as {
    source?: string;
    mode?: string;
    runId?: number;
    scheduleId?: number | null;
    syncedSince?: string | null;
    trigger?: 'manual' | 'scheduled';
    itemsProcessed?: number;
    itemsTotal?: number | null;
    startedAt?: string | null;
    finishedAt?: string | null;
    reason?: string;
    before?: BackfillScheduleSnapshot | null;
    after?: BackfillScheduleSnapshot | null;
  };
  const sourceLabels: Record<string, string> = {
    rooflink_jobs: 'Rooflink jobs',
    rooflink_lineitems: 'Rooflink estimate line items',
  };
  const sourceLabel = d.source ? (sourceLabels[d.source] ?? d.source) : null;

  // schedule_updated diff table — same shape as ScheduleBody
  if (entry.action === 'schedule_updated' && d.before && d.after) {
    const rows: Array<[string, string, string]> = [];
    if (d.before.cadence !== d.after.cadence)
      rows.push(['Cadence', d.before.cadence, d.after.cadence]);
    if (d.before.timeLocal !== d.after.timeLocal)
      rows.push(['Time', d.before.timeLocal, d.after.timeLocal]);
    if ((d.before.dayOfWeek ?? null) !== (d.after.dayOfWeek ?? null))
      rows.push([
        'Day of week',
        String(d.before.dayOfWeek ?? '—'),
        String(d.after.dayOfWeek ?? '—'),
      ]);
    if ((d.before.dayOfMonth ?? null) !== (d.after.dayOfMonth ?? null))
      rows.push([
        'Day of month',
        String(d.before.dayOfMonth ?? '—'),
        String(d.after.dayOfMonth ?? '—'),
      ]);
    if (rows.length === 0)
      return <DetailLine>No tracked fields changed.</DetailLine>;
    return <DiffTable headerLabels={['Field', 'Before', 'After']} rows={rows} />;
  }

  // schedule_{created,paused,resumed,deleted} — snapshot view
  if (entry.action.startsWith('schedule_')) {
    const snap = d.after ?? d.before;
    if (!snap) return null;
    return (
      <div className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
        <DetailLabel>Source</DetailLabel>
        <DetailValue>{sourceLabel ?? snap.source ?? '—'}</DetailValue>
        <DetailLabel>Cadence</DetailLabel>
        <DetailValue>{snap.cadence}</DetailValue>
        <DetailLabel>Time</DetailLabel>
        <DetailValue>
          {snap.timeLocal} {snap.timezone}
        </DetailValue>
        <DetailLabel>Enabled</DetailLabel>
        <DetailValue>{snap.enabled ? 'Yes' : 'No (paused)'}</DetailValue>
      </div>
    );
  }

  // run_{started,completed,cancelled,failed} — run snapshot
  if (entry.action.startsWith('run_')) {
    const isFailed = entry.action === 'run_failed';
    return (
      <div className="space-y-3">
        {isFailed && d.reason ? (
          <div className="border-heat-critical/40 bg-heat-critical/5 rounded-xl border px-3 py-2">
            <p className="text-text-primary text-xs whitespace-pre-wrap">
              {d.reason}
            </p>
          </div>
        ) : null}
        <div className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
          {sourceLabel ? (
            <>
              <DetailLabel>Source</DetailLabel>
              <DetailValue>{sourceLabel}</DetailValue>
            </>
          ) : null}
          {d.mode ? (
            <>
              <DetailLabel>Mode</DetailLabel>
              <DetailValue>{d.mode === 'full' ? 'Full sync' : 'Incremental'}</DetailValue>
            </>
          ) : null}
          {d.trigger ? (
            <>
              <DetailLabel>Trigger</DetailLabel>
              <DetailValue>{d.trigger === 'manual' ? 'Manual (Run now)' : 'Scheduled'}</DetailValue>
            </>
          ) : null}
          {typeof d.itemsProcessed === 'number' ? (
            <>
              <DetailLabel>Records</DetailLabel>
              <DetailValue>
                {d.itemsProcessed.toLocaleString()}
                {typeof d.itemsTotal === 'number'
                  ? ` of ${d.itemsTotal.toLocaleString()}`
                  : ''}
              </DetailValue>
            </>
          ) : null}
          {d.startedAt ? (
            <>
              <DetailLabel>Started</DetailLabel>
              <DetailValue>{formatTimestampLong(d.startedAt)}</DetailValue>
            </>
          ) : null}
          {d.finishedAt ? (
            <>
              <DetailLabel>Finished</DetailLabel>
              <DetailValue>{formatTimestampLong(d.finishedAt)}</DetailValue>
            </>
          ) : null}
          {d.syncedSince ? (
            <>
              <DetailLabel>Synced since</DetailLabel>
              <DetailValue>{formatTimestampLong(d.syncedSince)}</DetailValue>
            </>
          ) : null}
          {typeof d.runId === 'number' ? (
            <>
              <DetailLabel>Run id</DetailLabel>
              <DetailValue className="font-mono text-[11px]">
                #{d.runId}
              </DetailValue>
            </>
          ) : null}
        </div>
      </div>
    );
  }

  return null;
}

type BackfillScheduleSnapshot = {
  source?: string;
  cadence: string;
  timeLocal: string;
  timezone: string;
  dayOfWeek?: number | null;
  dayOfMonth?: string | null;
  recipients?: string[];
  enabled: boolean;
};

function recipientsLabel(list: readonly string[] | undefined): string {
  if (!list || list.length === 0) return '—';
  if (list.length === 1) return list[0] ?? '—';
  return list.join(', ');
}

function recipientsEqual(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): boolean {
  const la = a ?? [];
  const lb = b ?? [];
  if (la.length !== lb.length) return false;
  const sa = [...la].sort();
  const sb = [...lb].sort();
  return sa.every((v, i) => v === sb[i]);
}

function ScheduleBody({ entry }: { entry: AuditLogEntry }) {
  const d = (entry.details ?? {}) as { before?: Schedule | null; after?: Schedule | null };
  const before = d.before ?? null;
  const after = d.after ?? null;

  if (entry.action === 'updated' && before && after) {
    // Diff table — only show fields that changed.
    const rows: Array<[string, string, string]> = [];
    if (!recipientsEqual(before.recipients, after.recipients))
      rows.push([
        'Recipients',
        recipientsLabel(before.recipients),
        recipientsLabel(after.recipients),
      ]);
    if (before.timeLocal !== after.timeLocal)
      rows.push(['Time', before.timeLocal, after.timeLocal]);
    if ((before.dayOfWeek ?? null) !== (after.dayOfWeek ?? null))
      rows.push(['Day of week', String(before.dayOfWeek ?? '—'), String(after.dayOfWeek ?? '—')]);
    if ((before.dayOfMonth ?? null) !== (after.dayOfMonth ?? null))
      rows.push(['Day of month', String(before.dayOfMonth ?? '—'), String(after.dayOfMonth ?? '—')]);
    if (rows.length === 0) {
      return <DetailLine>No tracked fields changed.</DetailLine>;
    }
    return (
      <DiffTable
        headerLabels={['Field', 'Before', 'After']}
        rows={rows}
      />
    );
  }

  // For created / paused / resumed / deleted — show the row at a glance.
  const snapshot = after ?? before;
  if (!snapshot) return null;
  return (
    <div className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
      <DetailLabel>Cadence</DetailLabel>
      <DetailValue>{snapshot.cadence}</DetailValue>
      <DetailLabel>Recipients</DetailLabel>
      <DetailValue>{recipientsLabel(snapshot.recipients)}</DetailValue>
      <DetailLabel>Time</DetailLabel>
      <DetailValue>
        {snapshot.timeLocal} {snapshot.timezone}
      </DetailValue>
      {snapshot.dayOfWeek !== null && snapshot.dayOfWeek !== undefined ? (
        <>
          <DetailLabel>Day of week</DetailLabel>
          <DetailValue>{snapshot.dayOfWeek}</DetailValue>
        </>
      ) : null}
      {snapshot.dayOfMonth ? (
        <>
          <DetailLabel>Day of month</DetailLabel>
          <DetailValue>{snapshot.dayOfMonth}</DetailValue>
        </>
      ) : null}
      <DetailLabel>Enabled</DetailLabel>
      <DetailValue>{snapshot.enabled ? 'Yes' : 'No (paused)'}</DetailValue>
    </div>
  );
}

function BriefBody({ entry }: { entry: AuditLogEntry }) {
  const d = (entry.details ?? {}) as {
    to?: string | string[];
    cadence?: string;
    subject?: string;
    pdfBytes?: number;
    resendId?: string;
    recipient?: string;
    recipients?: string[];
    outcome?: { status?: string; resendId?: string; pdfBytes?: number };
    error?: { code?: string; message?: string } | string;
    request?: { to?: string | string[] };
  };
  const renderTo = (v: string | string[] | undefined): string => {
    if (Array.isArray(v)) return v.length === 0 ? '—' : v.join(', ');
    return v ?? '—';
  };
  if (entry.action === 'send_failed') {
    const err =
      typeof d.error === 'string'
        ? d.error
        : (d.error?.message ?? d.error?.code ?? 'Unknown error');
    return (
      <div className="space-y-3">
        <div className="border-heat-critical/40 bg-heat-critical/5 rounded-xl border px-3 py-2">
          <p className="text-text-primary text-xs">{err}</p>
        </div>
        {d.request?.to ? (
          <div className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
            <DetailLabel>Attempted recipients</DetailLabel>
            <DetailValue>{renderTo(d.request.to)}</DetailValue>
          </div>
        ) : null}
      </div>
    );
  }
  const to = renderTo(d.to ?? d.recipients ?? d.recipient);
  const pdfBytes = d.pdfBytes ?? d.outcome?.pdfBytes;
  const resendId = d.resendId ?? d.outcome?.resendId;
  return (
    <div className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
      <DetailLabel>To</DetailLabel>
      <DetailValue>{to}</DetailValue>
      {d.cadence ? (
        <>
          <DetailLabel>Cadence</DetailLabel>
          <DetailValue>{d.cadence}</DetailValue>
        </>
      ) : null}
      {d.subject ? (
        <>
          <DetailLabel>Subject</DetailLabel>
          <DetailValue>{d.subject}</DetailValue>
        </>
      ) : null}
      {pdfBytes ? (
        <>
          <DetailLabel>PDF size</DetailLabel>
          <DetailValue>{(pdfBytes / 1024).toFixed(1)} KB</DetailValue>
        </>
      ) : null}
      {resendId ? (
        <>
          <DetailLabel>Resend ID</DetailLabel>
          <DetailValue className="font-mono text-[11px]">{resendId}</DetailValue>
        </>
      ) : null}
    </div>
  );
}

function BriefingBody({ entry }: { entry: AuditLogEntry }) {
  const d = (entry.details ?? {}) as {
    headline?: string;
    model?: string;
    sources?: { count?: number };
    error?: string;
  };
  if (entry.action === 'generation_failed') {
    return (
      <div className="border-heat-critical/40 bg-heat-critical/5 rounded-xl border px-3 py-2">
        <p className="text-text-primary text-xs">{d.error ?? 'Generation failed'}</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {d.headline ? (
        <div className="border-border bg-bg-base/60 flex items-start gap-2 rounded-xl border px-3 py-2.5">
          <Sparkles className="text-accent mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p className="text-text-primary text-sm leading-relaxed">{d.headline}</p>
        </div>
      ) : null}
      <div className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
        {d.model ? (
          <>
            <DetailLabel>Model</DetailLabel>
            <DetailValue>{d.model}</DetailValue>
          </>
        ) : null}
        {typeof d.sources?.count === 'number' ? (
          <>
            <DetailLabel>Sources</DetailLabel>
            <DetailValue>
              {d.sources.count} {d.sources.count === 1 ? 'item' : 'items'} (NWS alerts + news)
            </DetailValue>
          </>
        ) : null}
      </div>
    </div>
  );
}

function ChatBody({ entry }: { entry: AuditLogEntry }) {
  const d = (entry.details ?? {}) as {
    messages?: Array<{ role?: string; content?: unknown }>;
    model?: string;
  };
  const messages = Array.isArray(d.messages) ? d.messages : [];
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {messages.map((m, i) => {
          const role = m.role ?? 'user';
          const text =
            typeof m.content === 'string'
              ? m.content
              : Array.isArray(m.content)
                ? m.content
                    .map((p) =>
                      typeof p === 'object' && p && 'text' in p
                        ? String((p as { text: unknown }).text ?? '')
                        : '',
                    )
                    .join(' ')
                : '';
          return (
            <div
              key={i}
              className={
                role === 'user'
                  ? 'border-accent/20 bg-accent/5 rounded-xl border px-3 py-2'
                  : 'border-border bg-bg-base/60 rounded-xl border px-3 py-2'
              }
            >
              <p className="text-text-muted mb-1 text-[0.6rem] tracking-[0.18em] uppercase">
                {role}
              </p>
              <p className="text-text-primary text-sm leading-relaxed whitespace-pre-wrap">
                {text || '(no text)'}
              </p>
            </div>
          );
        })}
        {messages.length === 0 ? (
          <DetailLine>(No transcript captured.)</DetailLine>
        ) : null}
      </div>
      {d.model ? (
        <div className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
          <DetailLabel>Model</DetailLabel>
          <DetailValue>{d.model}</DetailValue>
        </div>
      ) : null}
    </div>
  );
}

function AuthBody({ entry }: { entry: AuditLogEntry }) {
  const d = (entry.details ?? {}) as {
    provider?: string;
    isNewUser?: boolean;
  };
  return (
    <div className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
      {d.provider ? (
        <>
          <DetailLabel>Provider</DetailLabel>
          <DetailValue>{d.provider}</DetailValue>
        </>
      ) : null}
      {typeof d.isNewUser === 'boolean' ? (
        <>
          <DetailLabel>First sign-in?</DetailLabel>
          <DetailValue>{d.isNewUser ? 'Yes' : 'No'}</DetailValue>
        </>
      ) : null}
    </div>
  );
}

function DetailMetadata({ entry }: { entry: AuditLogEntry }) {
  return (
    <div className="border-border border-t pt-4">
      <p className="text-text-muted mb-2 text-[0.6rem] tracking-[0.2em] uppercase">
        Metadata
      </p>
      <div className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5">
        <DetailLabel>Category</DetailLabel>
        <DetailValue>{humanizeCategory(entry.category)}</DetailValue>
        <DetailLabel>Action</DetailLabel>
        <DetailValue>{humanizeAction(entry.action)}</DetailValue>
        <DetailLabel>Who</DetailLabel>
        <DetailValue>
          {entry.userId === null
            ? 'system'
            : (entry.userEmail ?? `user #${entry.userId}`)}
        </DetailValue>
        {entry.entityType ? (
          <>
            <DetailLabel>Entity</DetailLabel>
            <DetailValue>
              {entry.entityType}
              {entry.entityId ? ` #${entry.entityId}` : ''}
            </DetailValue>
          </>
        ) : null}
        <DetailLabel>Audit id</DetailLabel>
        <DetailValue>{entry.id}</DetailValue>
      </div>
    </div>
  );
}

function RawDetailsDisclosure({ details }: { details: unknown }) {
  if (!details) return null;
  return (
    <details className="border-border border-t pt-4">
      <summary className="text-text-muted hover:text-text-secondary cursor-pointer text-[0.65rem] tracking-[0.2em] uppercase select-none">
        Show raw audit JSON
      </summary>
      <pre className="border-border bg-bg-base text-text-secondary mt-2 max-h-96 overflow-auto rounded-xl border p-3 text-[11px] leading-relaxed">
        {JSON.stringify(details, null, 2)}
      </pre>
    </details>
  );
}

// ─── Tiny presentational primitives ──────────────────────────────────────

function DetailLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
      {children}
    </p>
  );
}

function DetailValue({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={`text-text-secondary text-xs ${className ?? ''}`}>{children}</p>
  );
}

function DetailLine({ children }: { children: React.ReactNode }) {
  return <p className="text-text-muted text-xs italic">{children}</p>;
}

function DiffTable({
  headerLabels,
  rows,
}: {
  headerLabels: [string, string, string];
  rows: Array<[string, string, string]>;
}) {
  return (
    <div className="border-border overflow-hidden rounded-xl border">
      <table className="w-full text-sm">
        <thead className="bg-bg-base">
          <tr>
            {headerLabels.map((l) => (
              <th
                key={l}
                className="text-text-muted px-3 py-2 text-left text-[0.6rem] font-semibold tracking-[0.15em] uppercase"
              >
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([field, before, after]) => (
            <tr key={field} className="border-border border-t">
              <td className="text-text-secondary px-3 py-2 text-xs">{field}</td>
              <td className="text-text-muted px-3 py-2 text-xs line-through">
                {before}
              </td>
              <td className="text-text-primary px-3 py-2 text-xs">{after}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Schedule snapshot type (loose; details JSON is unknown shape) ───────

type Schedule = {
  cadence: string;
  recipients: string[];
  timeLocal: string;
  timezone: string;
  dayOfWeek?: number | null;
  dayOfMonth?: string | null;
  enabled: boolean;
};

// ─── Time formatters ─────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatTimestampLong(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
}
