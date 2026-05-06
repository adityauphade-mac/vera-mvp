'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarIcon, ChevronDown } from 'lucide-react';
import { Calendar } from './Calendar';
import { cn } from '../lib/cn';

/**
 * DateTimePicker — a date + time picker styled to match the warm-CRED palette.
 *
 * Trigger button shows the formatted value. Clicking opens a popover with a
 * Calendar (react-day-picker) and a small time selector.
 */
export function DateTimePicker({
  value,
  onChange,
  minDate,
  placeholder = 'Pick a date and time',
  className,
}: {
  value: Date | null;
  onChange: (next: Date | null) => void;
  minDate?: Date;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Time state — derived from value, but kept separately so the picker doesn't
  // collapse a partial selection (e.g. user picked a date, hasn't picked time yet).
  const [hour12, setHour12] = useState<number>(() => to12Hour(value).hour);
  const [minute, setMinute] = useState<number>(() => value?.getMinutes() ?? 0);
  const [meridiem, setMeridiem] = useState<'AM' | 'PM'>(() => to12Hour(value).meridiem);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      const t = e.target as Node;
      if (containerRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function commit(date: Date) {
    onChange(date);
  }

  function handleDateSelect(d: Date | undefined) {
    if (!d) return;
    const next = new Date(d);
    const h24 =
      meridiem === 'AM'
        ? hour12 === 12
          ? 0
          : hour12
        : hour12 === 12
          ? 12
          : hour12 + 12;
    next.setHours(h24, minute, 0, 0);
    commit(next);
  }

  function handleHourChange(h: number) {
    setHour12(h);
    if (!value) return;
    const next = new Date(value);
    const h24 =
      meridiem === 'AM'
        ? h === 12
          ? 0
          : h
        : h === 12
          ? 12
          : h + 12;
    next.setHours(h24, minute, 0, 0);
    commit(next);
  }

  function handleMinuteChange(m: number) {
    setMinute(m);
    if (!value) return;
    const next = new Date(value);
    next.setMinutes(m, 0, 0);
    commit(next);
  }

  function handleMeridiemToggle(m: 'AM' | 'PM') {
    setMeridiem(m);
    if (!value) return;
    const next = new Date(value);
    const h24 =
      m === 'AM' ? (hour12 === 12 ? 0 : hour12) : hour12 === 12 ? 12 : hour12 + 12;
    next.setHours(h24, minute, 0, 0);
    commit(next);
  }

  // Sync internal time state when external value changes
  useEffect(() => {
    if (!value) return;
    const t = to12Hour(value);
    setHour12(t.hour);
    setMinute(value.getMinutes());
    setMeridiem(t.meridiem);
  }, [value?.getTime()]);

  const display = value ? formatDateTime(value) : placeholder;

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          'border-border bg-bg-card text-text-primary hover:border-accent/40 flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-sm transition-colors',
          !value && 'text-text-muted',
        )}
      >
        <span className="flex items-center gap-2">
          <CalendarIcon className="text-text-muted h-3.5 w-3.5" />
          {display}
        </span>
        <ChevronDown className="text-text-muted h-3.5 w-3.5" />
      </button>

      {open ? (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Pick date and time"
          className="bg-bg-card border-border absolute bottom-full left-0 z-[100] mb-1.5 flex flex-col gap-3 rounded-2xl border p-3 shadow-2xl"
        >
          <Calendar
            mode="single"
            selected={value ?? undefined}
            onSelect={handleDateSelect}
            disabled={minDate ? { before: minDate } : undefined}
          />

          <div className="border-border flex items-center gap-2 border-t px-1 pt-3">
            <span className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
              Time
            </span>
            <div className="flex flex-1 items-center justify-end gap-1.5">
              <NumberStepper
                value={hour12}
                min={1}
                max={12}
                onChange={handleHourChange}
                width="2.6rem"
                ariaLabel="Hour"
              />
              <span className="text-text-muted text-sm">:</span>
              <NumberStepper
                value={minute}
                min={0}
                max={59}
                onChange={handleMinuteChange}
                pad
                width="2.6rem"
                ariaLabel="Minute"
              />
              <div className="border-border ml-1.5 inline-flex overflow-hidden rounded-lg border">
                <button
                  type="button"
                  onClick={() => handleMeridiemToggle('AM')}
                  className={cn(
                    'px-2.5 py-1 text-xs font-medium transition-colors',
                    meridiem === 'AM'
                      ? 'bg-accent text-white'
                      : 'text-text-secondary hover:bg-bg-base',
                  )}
                  aria-pressed={meridiem === 'AM'}
                >
                  AM
                </button>
                <button
                  type="button"
                  onClick={() => handleMeridiemToggle('PM')}
                  className={cn(
                    'border-border border-l px-2.5 py-1 text-xs font-medium transition-colors',
                    meridiem === 'PM'
                      ? 'bg-accent text-white'
                      : 'text-text-secondary hover:bg-bg-base',
                  )}
                  aria-pressed={meridiem === 'PM'}
                >
                  PM
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-1.5 px-1">
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="text-text-muted hover:text-text-primary text-xs underline-offset-2 hover:underline"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="bg-accent rounded-lg px-3 py-1.5 text-xs font-medium text-white"
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NumberStepper({
  value,
  min,
  max,
  onChange,
  pad,
  width,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  pad?: boolean;
  width?: string;
  ariaLabel: string;
}) {
  function clamp(n: number) {
    if (n < min) return max;
    if (n > max) return min;
    return n;
  }
  return (
    <input
      type="number"
      aria-label={ariaLabel}
      min={min}
      max={max}
      value={pad ? String(value).padStart(2, '0') : value}
      onChange={(e) => {
        const n = parseInt(e.target.value, 10);
        if (!Number.isNaN(n)) onChange(clamp(n));
      }}
      className="border-border bg-bg-base text-text-primary focus:border-accent rounded-md border py-1 text-center text-sm tabular-nums outline-none"
      style={{ width: width ?? '2.5rem' }}
    />
  );
}

function to12Hour(d: Date | null): { hour: number; meridiem: 'AM' | 'PM' } {
  if (!d) return { hour: 8, meridiem: 'AM' };
  const h24 = d.getHours();
  const meridiem: 'AM' | 'PM' = h24 >= 12 ? 'PM' : 'AM';
  const hour = h24 % 12 === 0 ? 12 : h24 % 12;
  return { hour, meridiem };
}

function formatDateTime(d: Date): string {
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
