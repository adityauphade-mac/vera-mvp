import { cn } from '../lib/cn';

export interface BarDatum {
  label: string;
  value: number;
  color?: string;
  hint?: string;
  tooltip?: string;
}

export interface BarChartProps {
  data: BarDatum[];
  className?: string;
  format?: (n: number) => string;
}

export function BarChart({ data, className, format }: BarChartProps) {
  const max = Math.max(0, ...data.map((d) => d.value));
  const fmt = format ?? ((n: number) => n.toLocaleString());

  return (
    <div className={cn('space-y-3.5', className)}>
      {data.map((d) => {
        const pct = max > 0 ? Math.max(2, Math.round((d.value / max) * 100)) : 0;
        return (
          <div
            key={d.label}
            title={d.tooltip ?? `${d.label}: ${fmt(d.value)}`}
            className="space-y-1.5"
          >
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="text-text-secondary truncate">{d.label}</span>
              <span className="text-text-primary tabular-nums whitespace-nowrap">
                <span className="font-medium">{fmt(d.value)}</span>
                {d.hint ? (
                  <>
                    <span className="text-text-muted mx-2">·</span>
                    <span className="text-text-muted">{d.hint}</span>
                  </>
                ) : null}
              </span>
            </div>
            <div className="bg-bg-base h-2.5 overflow-hidden rounded-full">
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
