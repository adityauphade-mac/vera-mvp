'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AgingChip,
  Button,
  Card,
  FilterMenu,
  type FilterGroup,
  HeatMeter,
  MissingStepTag,
  Modal,
  Sheet,
  Tab,
  Table,
  TableCell,
  TableHead,
  TablePagination,
  type PageSize,
  TableRow,
  TableShell,
  TableToolbar,
  Tabs,
  TabsContent,
  TabsList,
  toast,
  useConfirm,
} from '@vera/ui';
import { formatUSD } from '@vera/utils';

// =====================================================================
// MODALS & SHEETS — original demo
// =====================================================================

export function DesignDemo() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => setSheetOpen(true)}>Open right-side sheet</Button>
        <Button variant="secondary" onClick={() => setModalOpen(true)}>
          Open centered modal
        </Button>
      </div>
      <p className="text-text-muted text-xs">
        Both overlays render via <code>createPortal</code> to <code>document.body</code>{' '}
        so they escape any ancestor <code>overflow</code>/<code>z-index</code> trap.
      </p>

      <Sheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="606 McMackin Street"
        description="Brandon Roberts · Dallas · Insurance"
      >
        <div className="space-y-4 px-7 py-5">
          <Card>
            <p className="text-text-secondary">
              Right-side sheets are the canonical drill-down surface. Used for the job
              detail panel from any table row, and for the Ask Vera chat in earlier
              iterations.
            </p>
          </Card>
          <p className="text-text-muted text-xs">
            Esc to close. Click the dim overlay to close. Body scroll is locked while open.
          </p>
        </div>
      </Sheet>

      <Modal open={modalOpen} onOpenChange={setModalOpen}>
        <div className="space-y-3">
          <p className="text-text-muted text-[0.65rem] font-semibold tracking-[0.18em] uppercase">
            Modal example
          </p>
          <p className="font-display text-2xl tracking-tight">
            Vera answers in the middle.
          </p>
          <p className="text-text-secondary text-sm">
            Plain <code>&lt;Modal&gt;</code> from <code>@vera/ui</code> — no icon, no
            built-in buttons, your layout owns the body. For yes/no
            confirmations use <code>&lt;ConfirmDialog&gt;</code> below.
          </p>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>
            Close
          </Button>
          <Button size="sm" onClick={() => setModalOpen(false)}>
            Got it
          </Button>
        </div>
      </Modal>
    </div>
  );
}

// =====================================================================
// PAGINATION — standalone
// =====================================================================

export function PaginationDemo({
  total,
  initialPageSize = 25,
}: {
  total: number;
  initialPageSize?: PageSize;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(initialPageSize);
  return (
    <TablePagination
      total={total}
      page={page}
      pageSize={pageSize}
      onPageChange={setPage}
      onPageSizeChange={(s) => {
        setPageSize(s);
        setPage(1);
      }}
      standalone
    />
  );
}

// =====================================================================
// TABLE + PAGINATION — integrated footer slot
// =====================================================================

const SAMPLE_ROWS = [
  { id: 1, address: '606 McMackin Street', sub: 'Dallas · Insurance', rep: 'Brandon Roberts', balance: 14995, bucket: '31-60-past' as const, heat: 72, band: 'hot' as const },
  { id: 2, address: '224 Roy Rogers Lane', sub: 'Shreveport · Insurance', rep: 'Clemente Mandujano', balance: 5333, bucket: '60-plus-past' as const, heat: 88, band: 'critical' as const },
  { id: 3, address: '1487 Streamside Drive', sub: 'Dallas · Retail', rep: 'Hernan Cubillos', balance: 6201, bucket: '1-30-past' as const, heat: 42, band: 'warm' as const },
  { id: 4, address: '1320 Raleigh Path', sub: 'Dallas · Insurance', rep: 'Brent Crutchfield', balance: 4302, bucket: '1-30-past' as const, heat: 58, band: 'hot' as const },
  { id: 5, address: '1011 Thomas Ave', sub: 'Shreveport · Insurance', rep: 'Fushia McFashion', balance: 3710, bucket: '60-plus-past' as const, heat: 81, band: 'critical' as const },
  { id: 6, address: '7101 GR 571', sub: 'Dallas · Retail', rep: 'David Jones', balance: 12918, bucket: 'within-terms' as const, heat: 22, band: 'cool' as const },
  { id: 7, address: '4847 Kydzia Avenue', sub: 'Dallas · Retail', rep: 'Melinda Jeffries', balance: 12134, bucket: '60-plus-past' as const, heat: 80, band: 'critical' as const },
  { id: 8, address: '4847 Kustria Avenue', sub: 'Dallas · Insurance', rep: 'Paul Nelson', balance: 1965, bucket: '60-plus-past' as const, heat: 56, band: 'hot' as const },
];

export function TableWithPaginationDemo() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const total = 130;

  const visible = SAMPLE_ROWS.slice(0, 5);

  return (
    <TableShell
      maxHeight={420}
      footer={
        <TablePagination
          total={total}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
          standalone
        />
      }
    >
      <Table>
        <TableHead
          columns={[
            { key: 'job', label: 'Job', tooltip: 'Address and classification.' },
            { key: 'rep', label: 'Rep', width: '160px' },
            { key: 'balance', label: 'Balance', align: 'right', width: '120px' },
            { key: 'aging', label: 'Aging', width: '120px' },
            { key: 'heat', label: 'Heat', align: 'right', width: '180px' },
          ]}
        />
        <tbody>
          {visible.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <p className="text-text-primary font-medium">{r.address}</p>
                <p className="text-text-muted mt-0.5 text-xs">{r.sub}</p>
              </TableCell>
              <TableCell className="text-text-secondary">{r.rep}</TableCell>
              <TableCell align="right" className="tabular-nums">
                {formatUSD(r.balance)}
              </TableCell>
              <TableCell>
                <AgingChip bucket={r.bucket} />
              </TableCell>
              <TableCell align="right">
                <div className="flex justify-end">
                  <HeatMeter
                    score={r.heat}
                    band={r.band}
                    breakdown={{ daysComponent: 28, dollarComponent: 22, silenceComponent: 5, anomalyComponent: 10 }}
                    variant="compact"
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </tbody>
      </Table>
    </TableShell>
  );
}

// =====================================================================
// FILTER MENU — chip groups + searchable rep dropdown
// =====================================================================

const SAMPLE_REP_NAMES = [
  'Chase Cassillo',
  'Brady Hadley',
  'Nick Rothmann',
  'Lucas Lawrence',
  'Brandon Roberts',
  'Melinda Jeffries',
  'Josh Coate',
  'Jennifer Lindsey',
  'Steven Liz',
  'Anthony West',
  'Hernan Cubillos',
  'Brent Crutchfield',
  'Clemente Mandujano',
  'Fushia McFashion',
  'David Jones',
];

export function FilterMenuDemo() {
  const [reps, setReps] = useState<string[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [missing, setMissing] = useState<string[]>([]);

  const groups: FilterGroup[] = useMemo(
    () => [
      {
        key: 'reps',
        label: 'Rep',
        type: 'dropdown',
        searchPlaceholder: 'Search reps…',
        options: SAMPLE_REP_NAMES.map((n, i) => ({
          value: n,
          label: n,
          count: 12 - Math.min(11, i),
        })),
      },
      {
        key: 'regions',
        label: 'Region',
        options: [
          { value: 'Dallas', label: 'Dallas', count: 84 },
          { value: 'Shreveport', label: 'Shreveport', count: 31 },
          { value: 'Houston', label: 'Houston', count: 15 },
        ],
      },
      {
        key: 'missing',
        label: 'Milestone status',
        options: [
          { value: 'cert', label: 'Missing cert of completion' },
          { value: 'finalCheck', label: 'Insurance — final check open' },
          { value: 'commission', label: 'No commission requested' },
          { value: 'allClear', label: 'Paperwork current' },
        ],
      },
    ],
    [],
  );

  const total = reps.length + regions.length + missing.length;

  return (
    <div className="space-y-3">
      <TableToolbar
        title="By job — 130 rows"
        subtitle={
          total > 0
            ? `${total} ${total === 1 ? 'filter' : 'filters'} applied`
            : 'Click Filter to try it'
        }
      >
        <FilterMenu
          groups={groups}
          selected={{ reps, regions, missing }}
          onSelectedChange={(next) => {
            setReps(next.reps ?? []);
            setRegions(next.regions ?? []);
            setMissing(next.missing ?? []);
          }}
        />
      </TableToolbar>
      <Card>
        <p className="text-text-muted text-xs">
          {total === 0
            ? 'No filters applied.'
            : `Selected: ${[...reps, ...regions, ...missing].slice(0, 6).join(', ')}${
                total > 6 ? `, +${total - 6} more` : ''
              }`}
        </p>
      </Card>
    </div>
  );
}

// =====================================================================
// TABS — two-state header pattern
// =====================================================================

export function TabsDemo() {
  return (
    <Tabs defaultValue="follow-ups" name="design-tabs-demo" className="space-y-4">
      <TabsList aria-label="Demo tabs">
        <Tab value="follow-ups">Rep follow-ups · 28</Tab>
        <Tab value="queue">Executive review queue · 36</Tab>
      </TabsList>
      <TabsContent value="follow-ups">
        <Card>
          <p className="text-text-secondary text-sm">
            Hot-band jobs Vera will draft for today (51–75).
          </p>
        </Card>
      </TabsContent>
      <TabsContent value="queue">
        <Card>
          <p className="text-text-secondary text-sm">
            Critical-band jobs that need executive eyes (76+).
          </p>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

// =====================================================================
// TOASTS + CONFIRM MODAL — interactive demo
// =====================================================================

export function ToastModalDemo() {
  const confirm = useConfirm();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            toast.success('Schedule saved', {
              description: 'Next run tomorrow at 03:00 CT.',
            })
          }
        >
          toast.success
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            toast.error("Couldn't reach Rooflink", {
              description: 'WAF timed out after 30 seconds. Retrying in 5s.',
            })
          }
        >
          toast.error
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            toast.info('Vera is thinking', {
              description: 'Pulling estimate context for the current view…',
            })
          }
        >
          toast.info
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            toast.warning('Rooflink throttling detected', {
              description:
                'Requests are taking 10+ seconds. The sync will continue but progress will be slower than usual.',
            })
          }
        >
          toast.warning
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const id = `demo-loading-${Date.now()}`;
            toast.loading('Rooflink jobs · full sync', {
              id,
              description: '1,234 / 8,440 rows · 14.6%',
              duration: Infinity,
            });
            window.setTimeout(() => {
              toast.success('Rooflink jobs sync complete', {
                id,
                description: '8,440 records updated',
                duration: 5000,
              });
            }, 3500);
          }}
        >
          toast.loading → success
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            const ok = await confirm({
              title: 'Cancel this run',
              description: '171 rows already fetched will be deleted.',
              confirmLabel: 'Cancel run',
              cancelLabel: 'Keep running',
              destructive: true,
            });
            if (ok)
              toast.success('Run canceled', {
                description: 'Partial data removed.',
              });
          }}
        >
          useConfirm (destructive)
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            const ok = await confirm({
              title: 'Save changes',
              description: 'This will overwrite the existing draft.',
              confirmLabel: 'Save',
            });
            if (ok) toast.success('Saved');
          }}
        >
          useConfirm (default)
        </Button>
      </div>
    </div>
  );
}

// =====================================================================
// INFINITE SCROLL — card list with sentinel + IntersectionObserver
// =====================================================================

const INFINITE_TOTAL = 28;
const INFINITE_CHUNK = 6;

export function InfiniteScrollDemo() {
  const [count, setCount] = useState(INFINITE_CHUNK);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = sentinelRef.current;
    const root = scrollRef.current;
    if (!node || !root) return;
    if (count >= INFINITE_TOTAL) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setCount((c) => Math.min(c + INFINITE_CHUNK, INFINITE_TOTAL));
          }
        }
      },
      { root, rootMargin: '120px' },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [count]);

  const hasMore = count < INFINITE_TOTAL;
  const items = Array.from({ length: count }, (_, i) => {
    const row = SAMPLE_ROWS[i % SAMPLE_ROWS.length]!;
    return row;
  });

  return (
    <Card>
      <div
        ref={scrollRef}
        className="max-h-[420px] space-y-3 overflow-y-auto pr-1"
      >
        {items.map((item, idx) => (
          <div
            key={idx}
            className="bg-bg-base border-border min-h-[120px] rounded-[var(--radius-card)] border p-5"
          >
            <p className="font-display text-lg tracking-tight">{item.address}</p>
            <p className="text-text-secondary mt-1 text-sm">
              {item.rep} · {item.sub}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <AgingChip bucket={item.bucket} />
              <MissingStepTag label="cert of completion" />
            </div>
          </div>
        ))}
        <div ref={sentinelRef} aria-hidden="true" className="h-4" />
      </div>
      <p className="text-text-muted mt-3 text-center text-xs">
        {hasMore
          ? `Showing ${count} of ${INFINITE_TOTAL} · scroll to load more`
          : `All ${INFINITE_TOTAL} jobs loaded`}
      </p>
    </Card>
  );
}
