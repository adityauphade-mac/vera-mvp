'use client';

import { useMemo } from 'react';
import { useQueryState, parseAsInteger, parseAsArrayOf, parseAsString } from 'nuqs';
import {
  Card,
  FilterMenu,
  type FilterGroup,
  MetricTile,
  TablePagination,
  type PageSize,
  TableToolbar,
  VeraQuote,
} from '@vera/ui';
import { formatUSD } from '@vera/utils';
import type { WriteOffsFile, WriteOffRecord } from '@vera/types';
import { WriteOffsTable } from './WriteOffsTable';

export function WriteOffsView({ file }: { file: WriteOffsFile }) {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [pageSize, setPageSize] = useQueryState(
    'pageSize',
    parseAsInteger.withDefault(25),
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
    for (const r of file.records) {
      if (r.repName) repCounts.set(r.repName, (repCounts.get(r.repName) ?? 0) + 1);
      if (r.region) regionCounts.set(r.region, (regionCounts.get(r.region) ?? 0) + 1);
    }
    const repOptions = [...repCounts.entries()]
      .map(([name, count]) => ({ value: name, label: name, count }))
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
  }, [file.records]);

  const filtered = useMemo(() => {
    return file.records.filter((r) => {
      if (repFilter.length > 0 && !repFilter.includes(r.repName ?? '')) return false;
      if (regionFilter.length > 0 && !regionFilter.includes(r.region ?? '')) return false;
      return true;
    });
  }, [file.records, repFilter, regionFilter]);

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => b.amountWithheld - a.amountWithheld),
    [filtered],
  );

  const totalWithheld = sorted.reduce((s, r) => s + r.amountWithheld, 0);
  const largest = sorted.reduce((m, r) => Math.max(m, r.amountWithheld), 0);
  const average = sorted.length === 0 ? 0 : totalWithheld / sorted.length;

  const safePageSize = pageSize as PageSize;
  const paged = sorted.slice((page - 1) * safePageSize, page * safePageSize);

  const filterCount = repFilter.length + regionFilter.length;
  const narrative = composeNarrative({
    count: sorted.length,
    total: totalWithheld,
    largest,
    candidatesFetched: file.totals.candidatesFetched,
  });

  return (
    <div className="mx-auto max-w-7xl space-y-10">
      <header className="space-y-3 vera-rise">
        <p className="text-text-muted text-xs tracking-[0.2em] uppercase">
          Daily · revenue foregone
        </p>
        <h1 className="font-display text-4xl tracking-tight md:text-5xl">
          Where the money walked away
        </h1>
        <VeraQuote>{narrative}</VeraQuote>
      </header>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4 vera-rise-delay-1">
        <MetricTile
          label="Total written off"
          numericValue={totalWithheld}
          format={formatUSD}
          value={formatUSD(totalWithheld)}
          hint="Amount Withheld across this view"
          emphasis="critical"
          tooltip="Sum of the Amount Withheld discount (Rooflink product_id 71493) across every AR job in the current filter. This is revenue PR will not collect from insurance, agreed at estimate time."
        />
        <MetricTile
          label="Jobs with write-offs"
          numericValue={sorted.length}
          value={sorted.length}
          hint={`of ${file.totals.candidatesFetched} AR jobs scanned`}
          emphasis="accent"
          tooltip="AR-set jobs where Rooflink's line-items endpoint returned an Amount Withheld discount. Scope is the AR working set: completed jobs with outstanding balance."
        />
        <MetricTile
          label="Average write-off"
          numericValue={average}
          format={formatUSD}
          value={formatUSD(average)}
          hint="Per affected job"
          tooltip="Mean Amount Withheld across only the jobs that have a write-off."
        />
        <MetricTile
          label="Largest single write-off"
          numericValue={largest}
          format={formatUSD}
          value={formatUSD(largest)}
          hint="Biggest concession"
          tooltip="The highest Amount Withheld on a single estimate in the current filter."
        />
      </section>

      <section className="space-y-3 vera-rise-delay-2">
        <TableToolbar
          title={`By job — ${sorted.length} ${sorted.length === 1 ? 'row' : 'rows'}`}
          subtitle={
            filterCount > 0
              ? `${filterCount} ${filterCount === 1 ? 'filter' : 'filters'} applied`
              : 'Highest write-off first'
          }
        >
          <FilterMenu
            groups={filterGroups}
            selected={{ reps: repFilter, regions: regionFilter }}
            onSelectedChange={(next) => {
              setRepFilter(next.reps ?? []);
              setRegionFilter(next.regions ?? []);
              setPage(1);
            }}
          />
        </TableToolbar>
        {sorted.length === 0 ? (
          <Card>
            <p className="text-text-secondary">No write-offs match the current filters.</p>
          </Card>
        ) : (
          <WriteOffsTable
            records={paged}
            footer={
              <TablePagination
                total={sorted.length}
                page={page}
                pageSize={safePageSize}
                onPageChange={setPage}
                onPageSizeChange={(s) => {
                  setPageSize(s);
                  setPage(1);
                }}
                standalone
              />
            }
          />
        )}
      </section>
    </div>
  );
}

function composeNarrative({
  count,
  total,
  largest,
  candidatesFetched,
}: {
  count: number;
  total: number;
  largest: number;
  candidatesFetched: number;
}): string {
  if (count === 0) {
    return 'No Amount Withheld discounts on any AR job in this view. Either the estimates collected in full or the data has not been refreshed.';
  }
  const totalFmt = formatUSD(total);
  const largestFmt = formatUSD(largest);
  return `${count} ${count === 1 ? 'AR job has' : 'AR jobs have'} an Amount Withheld discount on the estimate — ${totalFmt} of revenue foregone in total, with the largest single concession at ${largestFmt}. The table below is sorted by amount; clicking a row shows the full line-item breakdown so you can see how the insurance scope reconciles to the contract price.`;
}
