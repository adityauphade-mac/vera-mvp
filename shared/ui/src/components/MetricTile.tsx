import * as React from 'react';
import { cn } from '../lib/cn';

export interface MetricTileProps {
  label: string;
  value: React.ReactNode;
  hint?: string;
  className?: string;
  emphasis?: 'default' | 'accent' | 'critical';
}

export function MetricTile({ label, value, hint, className, emphasis = 'default' }: MetricTileProps) {
  return (
    <div
      className={cn(
        'bg-bg-card border-border rounded-[var(--radius-card)] border p-6',
        className,
      )}
    >
      <p className="text-text-muted text-xs tracking-wider uppercase">{label}</p>
      <p
        className={cn(
          'font-display mt-3 text-4xl tracking-tight tabular-nums',
          emphasis === 'accent' && 'text-accent',
          emphasis === 'critical' && 'text-heat-critical',
        )}
      >
        {value}
      </p>
      {hint ? <p className="text-text-secondary mt-2 text-sm">{hint}</p> : null}
    </div>
  );
}
