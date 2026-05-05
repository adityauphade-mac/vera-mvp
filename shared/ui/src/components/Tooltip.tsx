'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';

export interface TooltipProps {
  children: ReactNode;
  content: ReactNode;
  side?: 'top' | 'bottom';
  className?: string;
  /** Apply this className to the trigger wrapper. */
  triggerClassName?: string;
  /** When true, the trigger fills its parent (block layout). Default inline-flex. */
  block?: boolean;
  /** Disable opening the tooltip (e.g. when there's no content). */
  disabled?: boolean;
}

interface BubblePosition {
  top: number;
  left: number;
}

const useIsoLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Hover/focus tooltip rendered via portal so it can escape ancestor
 * overflow:hidden and stacking contexts. Position is computed from the
 * trigger's getBoundingClientRect on open, scroll, and resize.
 */
export function Tooltip({
  children,
  content,
  side = 'top',
  className,
  triggerClassName,
  block = false,
  disabled = false,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<BubblePosition | null>(null);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const id = useId();

  useEffect(() => setMounted(true), []);

  useIsoLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const update = () => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPosition({
        top: side === 'top' ? rect.top : rect.bottom,
        left: rect.left + rect.width / 2,
      });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, side]);

  if (disabled || !content) return <>{children}</>;

  const handlers = {
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => setOpen(false),
    onFocus: () => setOpen(true),
    onBlur: () => setOpen(false),
  };

  const bubble =
    open && mounted && position
      ? createPortal(
          <div
            id={id}
            role="tooltip"
            style={{
              position: 'fixed',
              top: position.top,
              left: position.left,
              transform: side === 'top' ? 'translate(-50%, -100%) translateY(-8px)' : 'translate(-50%, 0) translateY(8px)',
            }}
            className={cn(
              'pointer-events-none z-[100] max-w-[280px] rounded-lg bg-text-primary px-3 py-2 text-left text-xs leading-relaxed font-normal text-white shadow-[0_8px_24px_-8px_rgba(31,27,22,0.4)]',
              className,
            )}
          >
            {content}
            <span
              aria-hidden="true"
              className={cn(
                'bg-text-primary absolute left-1/2 h-2 w-2 -translate-x-1/2 rotate-45',
                side === 'top' && '-bottom-1',
                side === 'bottom' && '-top-1',
              )}
            />
          </div>,
          document.body,
        )
      : null;

  if (block) {
    return (
      <div
        ref={(el) => {
          triggerRef.current = el;
        }}
        className={cn('relative block', triggerClassName)}
        aria-describedby={open ? id : undefined}
        {...handlers}
      >
        {children}
        {bubble}
      </div>
    );
  }

  return (
    <span
      ref={(el) => {
        triggerRef.current = el;
      }}
      className={cn('relative inline-flex', triggerClassName)}
      aria-describedby={open ? id : undefined}
      {...handlers}
    >
      {children}
      {bubble}
    </span>
  );
}
