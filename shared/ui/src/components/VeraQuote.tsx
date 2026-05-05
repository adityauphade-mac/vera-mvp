import * as React from 'react';
import { cn } from '../lib/cn';

export function VeraQuote({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        'text-text-primary font-display border-accent border-l-2 pl-4 text-lg leading-relaxed italic',
        className,
      )}
    >
      {children}
    </p>
  );
}
