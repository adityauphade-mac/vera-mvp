import { cn } from '../lib/cn';
import { Tooltip } from './Tooltip';

const TOOLTIPS: Record<string, string> = {
  'cert of completion':
    'No certificate of completion logged. Without this, the insurance final check cannot be released.',
  'final check':
    'Insurance final (depreciation) check has not been endorsed yet — typically arrives 30–90 days post-install.',
  'commission request':
    "No commission request from the rep — often a behavioral signal that the rep believes the job isn't collectible.",
};

export function MissingStepTag({ label, className }: { label: string; className?: string }) {
  return (
    <Tooltip content={TOOLTIPS[label] ?? `Milestone missing: ${label}`}>
      <span
        className={cn(
          'border-border bg-bg-base text-text-secondary inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs leading-none whitespace-nowrap',
          className,
        )}
      >
        <span className="bg-heat-hot inline-block h-1.5 w-1.5 rounded-full" aria-hidden="true" />
        <span className="text-text-muted">missing:</span>
        <span className="text-text-primary">{label}</span>
      </span>
    </Tooltip>
  );
}
