import { cn } from '../lib/cn';

export function MissingStepTag({ label, className }: { label: string; className?: string }) {
  return (
    <span
      title={`Missing milestone: ${label}`}
      className={cn(
        'border-border bg-bg-base text-text-secondary inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs leading-none whitespace-nowrap',
        className,
      )}
    >
      <span className="bg-heat-hot inline-block h-1.5 w-1.5 rounded-full" aria-hidden="true" />
      <span className="text-text-muted">missing:</span>
      <span className="text-text-primary">{label}</span>
    </span>
  );
}
