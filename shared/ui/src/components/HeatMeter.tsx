import type { HeatBand, HeatBreakdown } from '@vera/types';
import { cn } from '../lib/cn';

const BAND_LABEL: Record<HeatBand, string> = {
  cool: 'Cool',
  warm: 'Warm',
  hot: 'Hot',
  critical: 'Critical',
};

const BAND_TEXT: Record<HeatBand, string> = {
  cool: 'text-heat-cool',
  warm: 'text-heat-warm',
  hot: 'text-heat-hot',
  critical: 'text-heat-critical',
};

const BAND_FILL: Record<HeatBand, string> = {
  cool: 'bg-heat-cool',
  warm: 'bg-heat-warm',
  hot: 'bg-heat-hot',
  critical: 'bg-heat-critical',
};

export interface HeatMeterProps {
  score: number;
  band: HeatBand;
  breakdown?: HeatBreakdown;
  className?: string;
  /** Compact = single-row inline meter for table rows. */
  variant?: 'default' | 'compact';
}

/**
 * A horizontal heat track. The whole track is a soft gradient from sage → brick;
 * a filled bar in the band's color shows the current score; a marker dot sits at
 * the current position. Colour-blind-friendly because the score number is always
 * visible alongside.
 */
export function HeatMeter({
  score,
  band,
  breakdown,
  className,
  variant = 'default',
}: HeatMeterProps) {
  const clamped = Math.max(0, Math.min(100, score));
  const tooltip = breakdown
    ? `Heat ${score} — ${BAND_LABEL[band]}\n` +
      `· Days past terms: ${breakdown.daysComponent}\n` +
      `· Balance: ${breakdown.dollarComponent}\n` +
      `· Rep silence: ${breakdown.silenceComponent}\n` +
      `· Anomalies: ${breakdown.anomalyComponent}`
    : `Heat ${score} — ${BAND_LABEL[band]}`;

  if (variant === 'compact') {
    return (
      <div
        title={tooltip}
        className={cn('flex w-44 flex-col gap-1', className)}
      >
        <div className="flex items-baseline justify-between">
          <span className="text-text-muted text-[0.65rem] tracking-wider uppercase">
            Heat
          </span>
          <span className={cn('text-sm font-medium tabular-nums', BAND_TEXT[band])}>
            {score}
            <span className="text-text-muted ml-1 text-[0.65rem] uppercase">
              {BAND_LABEL[band]}
            </span>
          </span>
        </div>
        <Track band={band} clamped={clamped} />
      </div>
    );
  }

  return (
    <div title={tooltip} className={cn('flex w-56 flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between">
        <span className="text-text-muted text-[0.65rem] tracking-wider uppercase">Heat</span>
        <span className={cn('text-sm font-medium tabular-nums', BAND_TEXT[band])}>
          {score}
          <span className="text-text-muted ml-1.5 text-[0.65rem] tracking-wider uppercase">
            {BAND_LABEL[band]}
          </span>
        </span>
      </div>
      <Track band={band} clamped={clamped} />
      <div className="text-text-muted flex justify-between text-[0.6rem] tracking-wider uppercase">
        <span>Cool</span>
        <span>Critical</span>
      </div>
    </div>
  );
}

function Track({ band, clamped }: { band: HeatBand; clamped: number }) {
  return (
    <div className="bg-bg-base border-border relative h-1.5 overflow-hidden rounded-full border">
      {/* gradient base */}
      <div
        className="absolute inset-0 opacity-25"
        style={{
          background:
            'linear-gradient(to right, var(--color-heat-cool), var(--color-heat-warm), var(--color-heat-hot), var(--color-heat-critical))',
        }}
      />
      {/* filled portion in band color */}
      <div
        className={cn('absolute inset-y-0 left-0 rounded-full', BAND_FILL[band])}
        style={{ width: `${clamped}%` }}
      />
      {/* marker dot */}
      <div
        className={cn(
          'absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white',
          BAND_FILL[band],
        )}
        style={{ left: `${clamped}%` }}
      />
    </div>
  );
}
