import type { HeatBand, HeatBreakdown } from '@vera/types';
import { cn } from '../lib/cn';
import { Tooltip } from './Tooltip';

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

const BAND_TINT: Record<HeatBand, string> = {
  cool: 'bg-heat-cool/15',
  warm: 'bg-heat-warm/15',
  hot: 'bg-heat-hot/15',
  critical: 'bg-heat-critical/15',
};

export interface HeatMeterProps {
  score: number;
  band: HeatBand;
  breakdown?: HeatBreakdown;
  className?: string;
  variant?: 'default' | 'compact';
}

function buildTooltip(score: number, band: HeatBand, breakdown?: HeatBreakdown) {
  if (!breakdown) return `Heat ${score} — ${BAND_LABEL[band]}`;
  return (
    <span className="block">
      <span className="block font-semibold">
        Heat {score} — {BAND_LABEL[band]}
      </span>
      <span className="mt-1.5 block space-y-0.5 text-[0.7rem]">
        <span className="block">· Days past terms: {breakdown.daysComponent}</span>
        <span className="block">· Balance: {breakdown.dollarComponent}</span>
        <span className="block">· Rep silence: {breakdown.silenceComponent}</span>
        <span className="block">· Anomalies: {breakdown.anomalyComponent}</span>
      </span>
    </span>
  );
}

export function HeatMeter({
  score,
  band,
  breakdown,
  className,
  variant = 'default',
}: HeatMeterProps) {
  const clamped = Math.max(0, Math.min(100, score));
  const tooltip = buildTooltip(score, band, breakdown);

  if (variant === 'compact') {
    return (
      <Tooltip content={tooltip}>
        <span className={cn('inline-flex items-center gap-2.5', className)}>
          <span
            className={cn(
              'text-sm font-semibold tabular-nums tracking-tight',
              BAND_TEXT[band],
            )}
          >
            {score}
          </span>
          <span
            className={cn(
              'bg-bg-base relative h-1.5 w-28 shrink-0 overflow-hidden rounded-full vera-color-shift',
              band === 'critical' && 'vera-critical-glow',
            )}
          >
            <span
              className={cn(
                'absolute inset-y-0 left-0 rounded-full vera-color-shift',
                BAND_FILL[band],
              )}
              style={{ width: `${clamped}%` }}
            />
          </span>
          <span
            className={cn(
              'text-[0.6rem] font-medium tracking-wider uppercase whitespace-nowrap',
              BAND_TEXT[band],
            )}
          >
            {BAND_LABEL[band]}
          </span>
        </span>
      </Tooltip>
    );
  }

  return (
    <Tooltip content={tooltip} block>
      <div className={cn('w-full max-w-sm space-y-2', className)}>
        <div className="flex items-baseline justify-between">
          <span className="text-text-muted text-[0.65rem] font-medium tracking-[0.18em] uppercase">
            Heat score
          </span>
          <div className="flex items-baseline gap-1">
            <span className={cn('font-display text-3xl tabular-nums', BAND_TEXT[band])}>
              {score}
            </span>
            <span className="text-text-muted text-xs">/ 100</span>
          </div>
        </div>
        <div
          className={cn(
            'relative h-2.5 overflow-hidden rounded-full vera-color-shift',
            BAND_TINT[band],
            band === 'critical' && 'vera-critical-glow',
          )}
        >
          <div
            className={cn(
              'absolute inset-y-0 left-0 rounded-full vera-color-shift',
              BAND_FILL[band],
            )}
            style={{ width: `${clamped}%` }}
          />
        </div>
        <div className="flex items-center justify-between">
          <span
            className={cn(
              'text-[0.65rem] font-medium tracking-[0.18em] uppercase',
              BAND_TEXT[band],
            )}
          >
            {BAND_LABEL[band]}
          </span>
          {breakdown ? (
            <span className="text-text-muted text-[0.65rem]">hover for breakdown</span>
          ) : null}
        </div>
      </div>
    </Tooltip>
  );
}
