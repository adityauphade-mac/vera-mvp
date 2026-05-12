'use client';

import { useState } from 'react';
import { Table, TableCell, TableHead, TableRow, TableShell } from '@vera/ui';
import { formatUSD } from '@vera/utils';
import type { WriteOffRecord } from '@vera/types';
import { WriteOffDetailSheet } from './WriteOffDetailSheet';

const COLUMNS = [
  { key: 'job', label: 'Customer & job', tooltip: 'Customer name and install address.' },
  {
    key: 'rep',
    label: 'Rep',
    width: '160px',
    tooltip: 'Sales rep on the job.',
  },
  {
    key: 'installDate',
    label: 'Install date',
    width: '120px',
    tooltip: 'date_completed on the Rooflink job, formatted MM/DD/YYYY.',
  },
  {
    key: 'amountWithheld',
    label: 'Amount withheld',
    align: 'right' as const,
    width: '160px',
    tooltip:
      "Rooflink discount where product_id = 71493 ('Amount Withheld'). The revenue PR will not collect from insurance.",
  },
  {
    key: 'contract',
    label: 'Contract',
    align: 'right' as const,
    width: '120px',
    tooltip: 'primary_estimate.gt_price — the agreed contract price after the discount.',
  },
  {
    key: 'balance',
    label: 'Balance',
    align: 'right' as const,
    width: '120px',
    tooltip: 'primary_estimate.balance — outstanding on the contract.',
  },
];

export function WriteOffsTable({
  records,
  footer,
}: {
  records: WriteOffRecord[];
  footer?: React.ReactNode;
}) {
  const [selected, setSelected] = useState<WriteOffRecord | null>(null);

  return (
    <>
      <TableShell maxHeight={720} footer={footer}>
        <Table>
          <TableHead columns={COLUMNS} />
          <tbody>
            {records.map((r) => (
              <TableRow
                key={`${r.jobId}-${r.estimateId}`}
                onClick={() => setSelected(r)}
                className="cursor-pointer vera-press"
              >
                <TableCell>
                  <p className="text-text-primary font-medium">
                    {r.customerName || '—'}
                  </p>
                  <p className="text-text-muted mt-0.5 text-xs">{r.address || '—'}</p>
                </TableCell>
                <TableCell className="text-text-secondary">
                  {r.repName ?? 'Unassigned'}
                </TableCell>
                <TableCell className="tabular-nums text-text-secondary text-sm">
                  {formatUSDate(r.installDate)}
                </TableCell>
                <TableCell align="right" className="tabular-nums">
                  <span className="text-heat-critical font-semibold">
                    {formatUSD(r.amountWithheld)}
                  </span>
                </TableCell>
                <TableCell align="right" className="tabular-nums">
                  {formatUSD(r.contractPrice)}
                </TableCell>
                <TableCell align="right" className="tabular-nums">
                  {formatUSD(r.balance)}
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </TableShell>

      <WriteOffDetailSheet
        record={selected}
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </>
  );
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
