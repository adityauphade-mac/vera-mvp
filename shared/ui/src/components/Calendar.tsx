'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import { cn } from '../lib/cn';

/**
 * Calendar — thin wrapper around react-day-picker, styled to match the
 * warm-CRED palette. Used directly, or as the body of <DateTimePicker>.
 */
export type CalendarProps = React.ComponentProps<typeof DayPicker>;

export function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row gap-2',
        month: 'flex flex-col gap-2',
        month_caption: 'flex h-8 items-center justify-center relative',
        caption_label: 'text-sm font-medium text-text-primary',
        nav: 'absolute inset-x-0 top-0 flex h-8 items-center justify-between px-1 pointer-events-none',
        button_previous: cn(
          'pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-transparent p-0 opacity-70 hover:opacity-100 hover:bg-bg-base transition-colors',
        ),
        button_next: cn(
          'pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-transparent p-0 opacity-70 hover:opacity-100 hover:bg-bg-base transition-colors',
        ),
        chevron: 'h-4 w-4 fill-text-secondary',
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday:
          'text-text-muted rounded-md w-9 font-normal text-[0.65rem] uppercase tracking-wider',
        week: 'flex w-full mt-1',
        day: 'h-9 w-9 text-center text-sm p-0 relative',
        day_button: cn(
          'h-9 w-9 p-0 rounded-md font-normal text-text-primary',
          'hover:bg-bg-base hover:text-text-primary transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        ),
        selected: '[&_button]:bg-accent [&_button]:text-white [&_button]:hover:bg-accent',
        today: '[&_button]:border [&_button]:border-border [&_button]:font-semibold',
        outside: 'text-text-muted opacity-40',
        disabled: 'text-text-muted opacity-30',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) => {
          if (orientation === 'left') return <ChevronLeft className="h-4 w-4" />;
          return <ChevronRight className="h-4 w-4" />;
        },
      }}
      {...props}
    />
  );
}
