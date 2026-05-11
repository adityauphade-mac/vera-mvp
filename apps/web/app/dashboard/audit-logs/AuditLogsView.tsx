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
  TablePagination,
} from '@vera/ui';
import {
  AUDIT_ACTIONS_BY_CATEGORY,
  AUDIT_CATEGORIES,
  type AuditCategory,
  type AuditLogEntry,
} from '@vera/types';

/**
 * Audit log table view. Filter bar on top, paginated table, click a row
 * to open the detail sheet. URL-state via nuqs so filters survive
 * reload + are shareable.
 *
 * Data is fetched from `GET /api/audit-logs` whenever filters or paging
 * change. The endpoint already enforces tenant scoping via the session
 * cookie, so this client never has to think about tenantId.
 */

const PAGE_SIZE = 50;

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

  // Build the query string from current filter state.
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (action) params.set('action', action);
    if (q.trim()) params.set('q', q.trim());
    // The API treats userId='' as "system actions only" (userId IS NULL).
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

  // Action dropdown options narrow when a category is selected.
  const actionOptions = useMemo(() => {
    if (!category) return Array.from(new Set(Object.values(AUDIT_ACTIONS_BY_CATEGORY).flat()));
    return [...AUDIT_ACTIONS_BY_CATEGORY[category]];
  }, [category]);

  // Resetting paging when a filter changes keeps results sensible.
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
  const onSearchSubmit = (next: string) => {
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
                    {c}
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
                    {a}
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
            <SearchBox value={q} onSubmit={onSearchSubmit} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-text-muted text-xs">
            {loading ? 'Loading…' : `${total.toLocaleString()} entries`}
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
      <Card className="vera-rise-delay-2 overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border text-text-muted border-b text-left text-[0.65rem] tracking-[0.18em] uppercase">
                <th className="px-5 py-3 whitespace-nowrap">Time</th>
                <th className="px-5 py-3 whitespace-nowrap">Who</th>
                <th className="px-5 py-3 whitespace-nowrap">Category</th>
                <th className="px-5 py-3 whitespace-nowrap">Action</th>
                <th className="px-5 py-3">Summary</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {error ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center">
                    <p className="text-heat-critical text-sm">
                      Couldn&apos;t load audit log: {error}
                    </p>
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center">
                    <History className="text-text-muted mx-auto mb-2 h-6 w-6" />
                    <p className="text-text-secondary text-sm">
                      {hasFilters
                        ? 'No entries match these filters.'
                        : 'No activity yet — actions you take will show up here.'}
                    </p>
                  </td>
                </tr>
              ) : (
                entries.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => setSelected(row)}
                    className="border-border hover:bg-bg-base/60 cursor-pointer border-b transition-colors last:border-b-0"
                  >
                    <td className="text-text-secondary px-5 py-3 whitespace-nowrap text-xs tabular-nums">
                      {formatTimestamp(row.createdAt)}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <ActorCell
                        userEmail={row.userEmail}
                        userId={row.userId}
                      />
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <CategoryPill category={row.category as AuditCategory} />
                    </td>
                    <td className="text-text-secondary px-5 py-3 whitespace-nowrap font-mono text-xs">
                      {row.action}
                    </td>
                    <td className="text-text-primary px-5 py-3">{row.summary}</td>
                    <td className="text-text-muted px-5 py-3 whitespace-nowrap">
                      ›
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {total > PAGE_SIZE ? (
          <div className="border-border border-t">
            <TablePagination
              page={Math.floor(offset / PAGE_SIZE) + 1}
              pageSize={PAGE_SIZE}
              total={total}
              onPageChange={(next) => setOffset((next - 1) * PAGE_SIZE)}
              onPageSizeChange={() => {
                /* page size fixed at 50 for V1 */
              }}
            />
          </div>
        ) : null}
      </Card>

      <AuditDetailSheet
        entry={selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function SearchBox({
  value,
  onSubmit,
}: {
  value: string;
  onSubmit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(draft);
      }}
      className="relative"
    >
      <Search className="text-text-muted pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2" />
      <input
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="recipient, action verb, anything in the summary…"
        className="border-border focus:border-accent bg-bg-card text-text-primary placeholder:text-text-muted w-full rounded-xl border py-2.5 pr-3 pl-9 text-sm outline-none transition-colors"
      />
    </form>
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
      {category}
    </span>
  );
}

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
        <div className="space-y-5 text-sm">
          <DetailGrid entry={entry} />
          {entry.details ? (
            <div className="space-y-2">
              <p className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
                Details
              </p>
              <pre className="border-border bg-bg-base text-text-secondary max-h-96 overflow-auto rounded-xl border p-3 text-[11px] leading-relaxed">
                {JSON.stringify(entry.details, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}

function DetailGrid({ entry }: { entry: AuditLogEntry }) {
  const rows: Array<[string, string]> = [
    ['Category', entry.category],
    ['Action', entry.action],
    ['Who', entry.userId === null ? 'system' : (entry.userEmail ?? `user #${entry.userId}`)],
    ['Tenant', String(entry.tenantId)],
  ];
  if (entry.entityType) rows.push(['Entity type', entry.entityType]);
  if (entry.entityId) rows.push(['Entity id', entry.entityId]);
  rows.push(['Audit id', String(entry.id)]);
  return (
    <div className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <p className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
            {label}
          </p>
          <p className="text-text-secondary text-xs">{value}</p>
        </div>
      ))}
    </div>
  );
}

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
