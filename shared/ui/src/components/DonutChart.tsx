import { cn } from '../lib/cn';

export interface DonutDatum {
  label: string;
  value: number;
  color: string;
}

export interface DonutChartProps {
  data: DonutDatum[];
  size?: number;
  thickness?: number;
  className?: string;
  centerLabel?: string;
  centerValue?: string;
  format?: (n: number) => string;
}

/**
 * Pure-SVG donut chart. No Recharts dep. Each slice rendered with stroke-dasharray
 * tricks on a circle. Accessible: every slice is its own <circle> with a <title>.
 */
export function DonutChart({
  data,
  size = 180,
  thickness = 18,
  className,
  centerLabel,
  centerValue,
  format,
}: DonutChartProps) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = data.reduce((s, d) => s + d.value, 0);
  const fmt = format ?? ((n: number) => n.toLocaleString());

  let offset = 0;
  const slices = data.map((d) => {
    const fraction = total === 0 ? 0 : d.value / total;
    const length = circumference * fraction;
    const slice = {
      ...d,
      length,
      gap: circumference - length,
      offset: -offset,
      pct: Math.round(fraction * 100),
    };
    offset += length;
    return slice;
  });

  return (
    <div
      className={cn(
        'flex flex-col items-center gap-8 sm:flex-row sm:items-center sm:gap-10',
        className,
      )}
    >
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--color-bg-base)"
            strokeWidth={thickness}
          />
          {slices.map((s) =>
            s.length > 0 ? (
              <circle
                key={s.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={s.color}
                strokeWidth={thickness}
                strokeDasharray={`${s.length} ${s.gap}`}
                strokeDashoffset={s.offset}
                strokeLinecap="butt"
              >
                <title>
                  {s.label}: {fmt(s.value)} ({s.pct}%)
                </title>
              </circle>
            ) : null,
          )}
        </svg>
        {(centerValue || centerLabel) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {centerValue ? (
              <span className="font-display text-text-primary text-2xl tabular-nums">
                {centerValue}
              </span>
            ) : null}
            {centerLabel ? (
              <span className="text-text-muted text-[0.65rem] tracking-[0.15em] uppercase">
                {centerLabel}
              </span>
            ) : null}
          </div>
        )}
      </div>

      <ul className="w-full space-y-2.5 text-sm sm:w-auto sm:min-w-[240px]">
        {slices.map((s) => (
          <li
            key={s.label}
            className="flex items-baseline justify-between gap-3"
            title={`${s.label}: ${fmt(s.value)} (${s.pct}%)`}
          >
            <span className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: s.color }}
                aria-hidden="true"
              />
              <span className="text-text-secondary">{s.label}</span>
            </span>
            <span className="text-text-primary tabular-nums">
              <span className="font-medium">{fmt(s.value)}</span>
              <span className="text-text-muted ml-2">{s.pct}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
