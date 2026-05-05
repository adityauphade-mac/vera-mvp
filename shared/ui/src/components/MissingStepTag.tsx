import { cn } from '../lib/cn';

export function MissingStepTag({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        'border-border bg-bg-base text-text-secondary inline-flex items-center rounded-full border px-2 py-0.5 text-xs',
        className,
      )}
    >
      missing: {label}
    </span>
  );
}
