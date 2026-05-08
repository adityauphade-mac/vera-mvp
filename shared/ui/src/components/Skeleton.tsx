import { cn } from '../lib/cn';

/**
 * Shimmer skeleton block. Used as a loading placeholder while data fetches.
 * Animation comes from the `vera-skeleton` utility in globals.css.
 *
 * Usage:
 *   <Skeleton className="h-8 w-32" />
 */
export interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return <div className={cn('vera-skeleton', className)} />;
}
