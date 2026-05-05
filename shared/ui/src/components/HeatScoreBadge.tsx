import type { HeatBand, HeatBreakdown } from '@vera/types';
import { cn } from '../lib/cn';

const BAND_LABELS: Record<HeatBand, string> = {
  cool: 'Cool',
  warm: 'Warm',
  hot: 'Hot',
  critical: 'Critical',
};

const BAND_BG: Record<HeatBand, string> = {
  cool: 'bg-heat-cool/15 text-heat-cool border-heat-cool/40',
  warm: 'bg-heat-warm/20 text-heat-warm border-heat-warm/40',
  hot: 'bg-heat-hot/20 text-heat-hot border-heat-hot/40',
  critical: 'bg-heat-critical/15 text-heat-critical border-heat-critical/40',
};

export interface HeatScoreBadgeProps {
  score: number;
  band: HeatBand;
  breakdown?: HeatBreakdown;
  className?: string;
  size?: 'sm' | 'md';
}

export function HeatScoreBadge({
  score,
  band,
  breakdown,
  className,
  size = 'md',
}: HeatScoreBadgeProps) {
  const sizeClasses = size === 'sm' ? 'text-xs px-2.5 py-0.5' : 'text-sm px-3 py-1';
  return (
    <span
      title={
        breakdown
          ? `Heat ${score} — ${BAND_LABELS[band]}\n` +
            `· Days past terms: ${breakdown.daysComponent}\n` +
            `· Balance: ${breakdown.dollarComponent}\n` +
            `· Rep silence: ${breakdown.silenceComponent}\n` +
            `· Anomalies: ${breakdown.anomalyComponent}`
          : `Heat ${score} — ${BAND_LABELS[band]}`
      }
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium tabular-nums',
        sizeClasses,
        BAND_BG[band],
        className,
      )}
    >
      <span className="opacity-70">Heat</span>
      <span>{score}</span>
      <span className="opacity-90">· {BAND_LABELS[band]}</span>
    </span>
  );
}
