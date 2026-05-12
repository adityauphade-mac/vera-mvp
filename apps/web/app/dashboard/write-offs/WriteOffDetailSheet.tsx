'use client';

import { Sheet } from '@vera/ui';
import { formatUSD } from '@vera/utils';
import type { WriteOffRecord } from '@vera/types';

interface LineItem {
  id?: number;
  product_id?: number;
  product_name?: string;
  trade_name?: string | null;
  price?: number;
  rcv?: number;
  recoverable_depreciation?: number;
  non_recoverable_depreciation?: number;
  quantity?: number;
  unit?: string;
  unit_price?: number;
  note?: string | null;
}

interface LineItemsBreakdown {
  work_doing?: LineItem[];
  work_not_doing?: LineItem[];
  supplineitems?: LineItem[];
  changeorderitems?: LineItem[];
  upgrades?: LineItem[];
  discounts?: LineItem[];
  summary?: {
    work_doing?: { rcv?: number; price?: number };
    discounts?: number;
  };
}

export function WriteOffDetailSheet({
  record,
  open,
  onOpenChange,
}: {
  record: WriteOffRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!record) {
    return <Sheet open={open} onOpenChange={onOpenChange} title="" children={null} />;
  }

  const installedOn = formatUSDate(record.installDate);
  const li = record.lineItems as LineItemsBreakdown;
  const workDoingRcv = sumPrice(li.work_doing, 'rcv');
  const supplementsRcv = sumPrice(li.supplineitems, 'price');
  const otherDiscounts = (li.discounts ?? [])
    .filter((d) => d.product_id !== 71493)
    .reduce((s, d) => s + (d.price ?? 0), 0);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={record.customerName || record.address || 'Write-off'}
      description={`${record.repName ?? 'Unassigned'} · ${record.region ?? '—'} · installed ${installedOn}`}
      widthClass="max-w-2xl"
    >
      <div className="space-y-8">
        <section className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Stat
              label="Amount withheld"
              value={
                <span className="text-heat-critical">{formatUSD(record.amountWithheld)}</span>
              }
            />
            <Stat label="Contract price" value={formatUSD(record.contractPrice)} />
            <Stat label="Balance" value={formatUSD(record.balance)} />
            <Stat
              label="Insurance RCV (work doing)"
              value={record.insuranceRcv != null ? formatUSD(record.insuranceRcv) : '—'}
            />
          </div>
        </section>

        <Section title="Reconciliation">
          <DefList
            items={[
              { label: 'Insurance work-doing RCV', value: formatUSD(workDoingRcv) },
              { label: 'Approved supplements', value: formatUSD(supplementsRcv) },
              {
                label: 'Amount Withheld (write-off)',
                value: (
                  <span className="text-heat-critical">
                    -{formatUSD(record.amountWithheld)}
                  </span>
                ),
              },
              ...(otherDiscounts !== 0
                ? [
                    {
                      label: 'Other discounts',
                      value: formatUSD(otherDiscounts),
                    },
                  ]
                : []),
              {
                label: 'Contract price (gt_price)',
                value: (
                  <span className="font-semibold">{formatUSD(record.contractPrice)}</span>
                ),
              },
            ]}
          />
          <p className="text-text-muted text-xs">
            Insurance scope minus Amount Withheld should reconcile to the contract price.
          </p>
        </Section>

        <LineItemGroup
          title={`Work doing (${li.work_doing?.length ?? 0})`}
          items={li.work_doing ?? []}
        />
        <LineItemGroup
          title={`Discounts (${li.discounts?.length ?? 0})`}
          items={li.discounts ?? []}
          highlightProductId={71493}
        />
        {li.supplineitems && li.supplineitems.length > 0 ? (
          <LineItemGroup title={`Supplements (${li.supplineitems.length})`} items={li.supplineitems} />
        ) : null}
        {li.work_not_doing && li.work_not_doing.length > 0 ? (
          <LineItemGroup
            title={`Work not doing (${li.work_not_doing.length})`}
            items={li.work_not_doing}
          />
        ) : null}
        {li.changeorderitems && li.changeorderitems.length > 0 ? (
          <LineItemGroup
            title={`Change orders (${li.changeorderitems.length})`}
            items={li.changeorderitems}
          />
        ) : null}
        {li.upgrades && li.upgrades.length > 0 ? (
          <LineItemGroup title={`Upgrades (${li.upgrades.length})`} items={li.upgrades} />
        ) : null}

        <Section title="Identifiers">
          <DefList
            items={[
              { label: 'Job ID', value: String(record.jobId) },
              { label: 'Estimate ID', value: String(record.estimateId) },
              { label: 'Address', value: record.address || '—' },
            ]}
          />
        </Section>
      </div>
    </Sheet>
  );
}

function LineItemGroup({
  title,
  items,
  highlightProductId,
}: {
  title: string;
  items: LineItem[];
  highlightProductId?: number;
}) {
  if (items.length === 0) {
    return (
      <Section title={title}>
        <p className="text-text-muted text-sm">None.</p>
      </Section>
    );
  }
  return (
    <Section title={title}>
      <ul className="border-border divide-border divide-y border-y">
        {items.map((item, idx) => {
          const isHighlighted =
            highlightProductId != null && item.product_id === highlightProductId;
          return (
            <li
              key={item.id ?? idx}
              className={
                isHighlighted
                  ? 'bg-heat-critical/5 -mx-2 rounded-lg px-2 py-3'
                  : 'py-3'
              }
            >
              <div className="flex items-baseline justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p
                    className={
                      isHighlighted
                        ? 'text-heat-critical text-sm font-semibold'
                        : 'text-text-primary text-sm font-medium'
                    }
                  >
                    {item.product_name ?? `Product ${item.product_id ?? '?'}`}
                  </p>
                  {item.trade_name ? (
                    <p className="text-text-muted mt-0.5 text-xs">{item.trade_name}</p>
                  ) : null}
                  {item.note ? (
                    <p className="text-text-secondary mt-1.5 text-xs whitespace-pre-line">
                      {item.note}
                    </p>
                  ) : null}
                </div>
                <div className="text-right tabular-nums">
                  <p
                    className={
                      isHighlighted
                        ? 'text-heat-critical text-sm font-semibold'
                        : 'text-text-primary text-sm font-medium'
                    }
                  >
                    {item.price != null ? formatUSD(item.price) : '—'}
                  </p>
                  {item.rcv != null && item.rcv !== item.price ? (
                    <p className="text-text-muted mt-0.5 text-xs">
                      RCV {formatUSD(item.rcv)}
                    </p>
                  ) : null}
                  {item.quantity != null && item.unit ? (
                    <p className="text-text-muted mt-0.5 text-xs">
                      {item.quantity} {item.unit}
                    </p>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function sumPrice(items: LineItem[] | undefined, key: 'rcv' | 'price'): number {
  if (!items || items.length === 0) return 0;
  return items.reduce((sum, it) => sum + (typeof it[key] === 'number' ? (it[key] as number) : 0), 0);
}

function formatUSDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-bg-base border-border rounded-2xl border p-4">
      <p className="text-text-muted text-[0.65rem] tracking-[0.18em] uppercase">{label}</p>
      <p className="font-display mt-1 text-xl tabular-nums">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-text-secondary text-[0.65rem] font-semibold tracking-[0.2em] uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function DefList({ items }: { items: Array<{ label: string; value: React.ReactNode }> }) {
  return (
    <dl className="border-border divide-border divide-y border-y">
      {items.map((it) => (
        <div key={it.label} className="flex items-baseline justify-between gap-4 py-2.5">
          <dt className="text-text-muted text-sm">{it.label}</dt>
          <dd className="text-text-primary text-sm font-medium">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
