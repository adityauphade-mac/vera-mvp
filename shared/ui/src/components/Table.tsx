import * as React from 'react';
import { cn } from '../lib/cn';

/**
 * Vera table — opinionated wrapper that gives every table the same
 * warm-card chrome, sticky header with shadow on scroll, and clear
 * visual separation between header and body rows.
 */
export interface TableShellProps {
  className?: string;
  /** Maximum height of the scroll container in pixels. Default 640. */
  maxHeight?: number;
  children: React.ReactNode;
}

export function TableShell({ className, maxHeight = 640, children }: TableShellProps) {
  return (
    <div
      className={cn(
        'border-border bg-bg-card overflow-hidden rounded-[var(--radius-card)] border shadow-[0_2px_4px_-2px_rgba(31,27,22,0.04),0_4px_12px_-4px_rgba(31,27,22,0.05)]',
        className,
      )}
    >
      <div className="overflow-y-auto" style={{ maxHeight }}>
        {children}
      </div>
    </div>
  );
}

export const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <table ref={ref} className={cn('w-full text-sm', className)} {...props} />
  ),
);
Table.displayName = 'Table';

export interface TableHeadCol {
  key: string;
  label: React.ReactNode;
  align?: 'left' | 'right' | 'center';
  tooltip?: string;
  width?: string;
}

export function TableHead({ columns }: { columns: TableHeadCol[] }) {
  return (
    <thead className="bg-bg-base sticky top-0 z-10 shadow-[0_1px_0_0_var(--color-border),0_2px_8px_-4px_rgba(31,27,22,0.08)]">
      <tr>
        {columns.map((c) => (
          <th
            key={c.key}
            title={c.tooltip}
            className={cn(
              'text-text-secondary px-5 py-3.5 text-[0.65rem] font-semibold tracking-[0.15em] uppercase',
              c.align === 'right' && 'text-right',
              c.align === 'center' && 'text-center',
              !c.align && 'text-left',
            )}
            style={c.width ? { width: c.width } : undefined}
          >
            {c.label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      'border-border/60 last:border-b-0 hover:bg-bg-base/60 border-b align-top transition-colors',
      className,
    )}
    {...props}
  />
));
TableRow.displayName = 'TableRow';

export const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }
>(({ className, align, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      'px-5 py-4',
      align === 'right' && 'text-right',
      align === 'center' && 'text-center',
      className,
    )}
    {...props}
  />
));
TableCell.displayName = 'TableCell';
