import { cn } from '../lib/cn';

/**
 * Shimmer skeleton block. Used as a loading placeholder while data fetches.
 * Animation comes from the `vera-skeleton` utility in globals.css.
 *
 * Usage:
 *   <Skeleton className="h-8 w-32" />
 *
 * For a single line of text-shaped shimmer with a sensible default
 * height, prefer `SkeletonText` — it composes this primitive but cuts
 * the boilerplate at every call site (the line-height is consistent
 * across pages so all skeleton rows visually rhyme).
 */
export interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return <div className={cn('vera-skeleton', className)} />;
}

/**
 * Single-line text-shaped skeleton. The standard look across the app for
 * "this row is a line of text waiting to load." Height matches body text
 * (`h-3` = 12 px), default width is 100% of the parent so it fills a
 * table cell; pass `width` for fixed shimmer widths in title rows, etc.
 *
 * Examples:
 *   <SkeletonText />                       // full-width line
 *   <SkeletonText width="w-32" />          // 8 rem
 *   <SkeletonText width="w-48" className="h-4" />   // override height
 */
export interface SkeletonTextProps {
  /**
   * Tailwind width class. Defaults to `w-full` so the shimmer fills its
   * container — useful inside table cells. Pass `w-20`, `w-32`, etc. for
   * fixed widths.
   */
  width?: string;
  className?: string;
}

export function SkeletonText({ width = 'w-full', className }: SkeletonTextProps) {
  return <Skeleton className={cn('h-3 rounded', width, className)} />;
}
