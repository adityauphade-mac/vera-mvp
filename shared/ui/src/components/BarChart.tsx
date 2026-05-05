import { cn } from '../lib/cn';

export interface BarDatum {
  label: string;
  value: number;
  /** override fill color (CSS color or var). Defaults to accent. */
  color?: string;
  /** secondary text shown right of the bar. */
  hint?: string;
  /** optional title attribute for tooltip. */
  tooltip?: string;
}

export interface BarChartProps {
  data: BarDatum[];
  className?: string;
  /** show count label inside or after each bar. */
  format?: (n: number) => string;
}

/**
 * A lightweight horizontal bar chart. Pure CSS — no Recharts, no SVG headaches.
 * Each bar is a div whose width is proportional to value/max.
 */
export function BarChart({ data, className, format }: BarChartProps) {
  const max = Math.max(0, ...data.map((d) => d.value));
  const fmt = format ?? ((n: number) => n.toLocaleString());

  return (
    <div className={cn('space-y-3', className)}>
      {data.map((d) => {
        const pct = max > 0 ? Math.max(2, Math.round((d.value / max) * 100)) : 0;
        return (
          <div key={d.label} title={d.tooltip ?? `${d.label}: ${fmt(d.value)}`} className="space-y-1">
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-text-secondary">{d.label}</span>
              <span className="text-text-primary tabular-nums">
                {fmt(d.value)}
                {d.hint ? <span className="text-text-muted ml-2">{d.hint}</span> : null}
              </span>
            </div>
            <div className="bg-bg-base h-2 overflow-hidden rounded-full">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${pct}%`,
                  backgroundColor: d.color ?? 'var(--color-accent)',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
