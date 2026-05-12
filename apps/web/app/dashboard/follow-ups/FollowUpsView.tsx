'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useQueryState,
  parseAsArrayOf,
  parseAsString,
  parseAsStringEnum,
} from 'nuqs';
import {
  Card,
  FilterMenu,
  type FilterGroup,
  MetricTile,
  Tab,
  Tabs,
  TabsList,
  VeraQuote,
} from '@vera/ui';
import { formatUSD } from '@vera/utils';
import type { ARJob } from '@vera/types';
import { FollowUpsList } from './FollowUpsList';

type TabValue = 'follow-ups' | 'queue';

const PAGE_CHUNK = 20;

export function FollowUpsView({ jobs }: { jobs: ARJob[] }) {
  const [tab, setTab] = useQueryState(
    'tab',
    parseAsStringEnum<TabValue>(['follow-ups', 'queue']).withDefault('follow-ups'),
  );
  const [repFilter, setRepFilter] = useQueryState(
    'reps',
    parseAsArrayOf(parseAsString).withDefault([]),
  );
  const [regionFilter, setRegionFilter] = useQueryState(
    'regions',
    parseAsArrayOf(parseAsString).withDefault([]),
  );

  const filterGroups: FilterGroup[] = useMemo(() => {
    const repCounts = new Map<string, number>();
    const regionCounts = new Map<string, number>();
    for (const j of jobs) {
      if (j.rep?.id) {
        const key = `${j.rep.id}`;
        repCounts.set(key, (repCounts.get(key) ?? 0) + 1);
      }
      if (j.region) regionCounts.set(j.region, (regionCounts.get(j.region) ?? 0) + 1);
    }
    const repOptions = [...repCounts.entries()]
      .map(([id, count]) => {
        const job = jobs.find((j) => j.rep?.id?.toString() === id);
        return { value: id, label: job?.rep?.name ?? '—', count };
      })
      .sort((a, b) => b.count - a.count);
    return [
      {
        key: 'reps',
        label: 'Rep',
        type: 'dropdown',
        searchPlaceholder: 'Search reps…',
        options: repOptions,
      },
      {
        key: 'regions',
        label: 'Region',
        options: [...regionCounts.entries()]
          .sort()
          .map(([r, c]) => ({ value: r, label: r, count: c })),
      },
    ];
  }, [jobs]);

  // Filter applies to the FULL job set, then we split by heat band for the tabs.
  const filteredAll = useMemo(() => {
    return jobs.filter((j) => {
      if (repFilter.length > 0 && !repFilter.includes(`${j.rep?.id ?? ''}`)) return false;
      if (regionFilter.length > 0 && !regionFilter.includes(j.region ?? '')) return false;
      return true;
    });
  }, [jobs, repFilter, regionFilter]);

  const hot = useMemo(
    () => filteredAll.filter((j) => j.heatBand === 'hot').sort((a, b) => b.heatScore - a.heatScore),
    [filteredAll],
  );
  const critical = useMemo(
    () =>
      filteredAll
        .filter((j) => j.heatBand === 'critical')
        .sort((a, b) => b.heatScore - a.heatScore),
    [filteredAll],
  );

  const visible = tab === 'queue' ? critical : hot;

  // Infinite scroll: render PAGE_CHUNK items at a time, expand as the sentinel scrolls into view.
  const [visibleCount, setVisibleCount] = useState(PAGE_CHUNK);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Reset visible window whenever the dataset changes (filters / tab / underlying jobs).
  useEffect(() => {
    setVisibleCount(PAGE_CHUNK);
  }, [tab, repFilter, regionFilter, jobs]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    if (visibleCount >= visible.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisibleCount((c) => Math.min(c + PAGE_CHUNK, visible.length));
          }
        }
      },
      { rootMargin: '320px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visibleCount, visible.length]);

  const renderedJobs = visible.slice(0, visibleCount);
  const hasMore = visibleCount < visible.length;

  const filterCount = repFilter.length + regionFilter.length;
  const totalDollarsInHeat = [...hot, ...critical].reduce((s, j) => s + j.balance, 0);

  return (
    <div className="mx-auto max-w-7xl space-y-10">
      <header className="space-y-3 vera-rise">
        <p className="text-text-muted text-xs tracking-[0.2em] uppercase">
          Daily · rep follow-ups & escalation
        </p>
        <h1 className="font-display text-4xl tracking-tight md:text-5xl">
          Who I&apos;d nudge today.
        </h1>
        <VeraQuote>
          {tab === 'queue'
            ? `${critical.length} ${
                critical.length === 1 ? 'job is' : 'jobs are'
              } in the executive review queue — these crossed Heat 76 and warrant a personal touch from the office.`
            : `I'll draft for ${hot.length} hot ${
                hot.length === 1 ? 'job' : 'jobs'
              } today. Nothing autosends — open any row and I'll show you the email I'd send.`}
        </VeraQuote>
      </header>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4 vera-rise-delay-1">
        <MetricTile
          label="Hot — for reps"
          value={hot.length}
          hint="Heat 51–75"
          emphasis="accent"
          tooltip="Jobs in the Hot heat band (51–75). Vera will draft a follow-up email to the rep — the rep chases the customer."
        />
        <MetricTile
          label="Critical — exec review"
          value={critical.length}
          hint="Heat 76+"
          emphasis="critical"
          tooltip="Jobs in the Critical heat band (76+). Too far gone for a rep nudge — needs a personal touch from the office."
        />
        <MetricTile
          label="Total in heat"
          value={hot.length + critical.length}
          tooltip="Sum of Hot and Critical jobs in the current view."
        />
        <MetricTile
          label="Total dollars in heat"
          value={formatUSD(totalDollarsInHeat)}
          tooltip="Sum of outstanding balances across all Hot and Critical jobs in the current view."
        />
      </section>

      <div className="flex flex-wrap items-end justify-between gap-3 vera-rise-delay-2">
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as TabValue)}
          name="follow-ups"
          className="flex-1"
        >
          <TabsList aria-label="Follow-ups views">
            <Tab value="follow-ups">
              <span className="whitespace-nowrap">Rep follow-ups · {hot.length}</span>
            </Tab>
            <Tab value="queue">
              <span className="whitespace-nowrap">
                <span className="hidden sm:inline">Executive review queue</span>
                <span className="sm:hidden">Exec queue</span>
                {' · '}
                {critical.length}
              </span>
            </Tab>
          </TabsList>
        </Tabs>
        <div className="pb-2">
          <FilterMenu
            groups={filterGroups}
            selected={{ reps: repFilter, regions: regionFilter }}
            onSelectedChange={(next) => {
              setRepFilter(next.reps ?? []);
              setRegionFilter(next.regions ?? []);
            }}
          />
        </div>
      </div>

      <section className="vera-rise-delay-3 space-y-4">
        {visible.length === 0 ? (
          <Card>
            <p className="text-text-secondary">
              {tab === 'queue'
                ? 'Executive queue is clear in this view. Nothing has crossed the Critical threshold.'
                : 'Nothing in the Hot band in this view. Nothing for me to draft.'}
              {filterCount > 0 ? ' Try clearing filters.' : ''}
            </p>
          </Card>
        ) : (
          <>
            <FollowUpsList jobs={renderedJobs} />
            <div ref={sentinelRef} aria-hidden="true" className="h-4" />
            <p className="text-text-muted py-4 text-center text-xs">
              {hasMore
                ? `Showing ${renderedJobs.length} of ${visible.length} · scroll to load more`
                : `All ${visible.length} ${visible.length === 1 ? 'job' : 'jobs'} loaded`}
            </p>
          </>
        )}
      </section>
    </div>
  );
}

