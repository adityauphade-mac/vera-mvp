'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Number-ticker component. Animates from the previous value to the new value
 * using requestAnimationFrame easing. First mount renders the value directly
 * (no initial animation from 0). Subsequent value changes animate.
 *
 * Respects prefers-reduced-motion — collapses to a hard cut.
 *
 * Usage:
 *   <Ticker value={130} format={(n) => `${n} jobs`} duration={600} />
 */
export interface TickerProps {
  value: number;
  format?: (n: number) => string;
  /** Animation duration in ms. Default 600. */
  duration?: number;
  className?: string;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export function Ticker({ value, format, duration = 600, className }: TickerProps) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (prevRef.current === value) return;

    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setDisplay(value);
      prevRef.current = value;
      return;
    }

    const start = prevRef.current;
    const delta = value - start;
    const startTime = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      const eased = easeOutCubic(t);
      setDisplay(Math.round(start + delta * eased));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        prevRef.current = value;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration]);

  const text = format ? format(display) : display.toLocaleString();
  return <span className={className}>{text}</span>;
}
