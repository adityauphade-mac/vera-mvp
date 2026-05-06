'use client';

/**
 * TimePicker — plain native `<input type="time">`.
 *
 * The OS calendar-picker indicator (clock glyph that opens the system picker)
 * is hidden via the WebKit pseudo-element so the field renders as a clean
 * text-style input. Value is "HH:mm" (24-hour) — same contract the consumer
 * had with the previous Select-based component, so SchedulerView and friends
 * keep working unchanged.
 */
export function TimePicker({
  value,
  onChange,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <input
      type="time"
      aria-label={ariaLabel ?? 'Time'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={
        'border-border bg-bg-card text-text-primary focus:border-accent w-full appearance-none rounded-xl border px-4 py-2.5 text-sm outline-none transition-colors tabular-nums [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none ' +
        (className ?? '')
      }
    />
  );
}
