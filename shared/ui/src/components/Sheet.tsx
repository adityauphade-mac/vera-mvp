'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../lib/cn';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Sheet width in tailwind class form. Default 'max-w-xl'. */
  widthClass?: string;
}

// Match vera-sheet-out / vera-backdrop-out durations in globals.css. If
// you change one, change the other.
const EXIT_DURATION_MS = 220;

/**
 * Right-side sheet rendered into document.body via portal. Esc closes.
 * Body scroll locked while open. Click on overlay also closes.
 *
 * Closing plays the vera-sheet-out / vera-backdrop-out animation, then
 * unmounts. Consumers don't need to know — they just toggle `open`.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  widthClass = 'max-w-xl',
}: SheetProps) {
  const [renderOpen, setRenderOpen] = useState(open);
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  // Sync internal lifecycle to the controlled `open` prop. When `open`
  // flips false, we keep rendering, swap to the -out class, and unmount
  // after the exit animation finishes.
  useEffect(() => {
    if (open) {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setRenderOpen(true);
      setClosing(false);
    } else if (renderOpen && !closing) {
      setClosing(true);
      closeTimerRef.current = window.setTimeout(() => {
        setRenderOpen(false);
        setClosing(false);
        closeTimerRef.current = null;
      }, EXIT_DURATION_MS);
    }
  }, [open, renderOpen, closing]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!renderOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [renderOpen, onOpenChange]);

  if (!renderOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-[90] flex justify-end bg-black/40 backdrop-blur-sm',
        closing ? 'vera-backdrop-out' : 'vera-backdrop-in',
      )}
      role="dialog"
      aria-modal="true"
      onClick={() => onOpenChange(false)}
    >
      <aside
        className={cn(
          'bg-bg-card border-border flex h-full w-full flex-col border-l shadow-2xl',
          closing ? 'vera-sheet-out' : 'vera-sheet-in',
          widthClass,
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-border flex items-start justify-between gap-4 border-b px-7 py-5">
          <div className="min-w-0 flex-1">
            {title ? (
              <div className="font-display text-2xl tracking-tight">{title}</div>
            ) : null}
            {description ? (
              <p className="text-text-secondary mt-1 text-sm">{description}</p>
            ) : null}
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="text-text-muted hover:text-text-primary -mr-2 rounded-full p-2 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-7 py-6">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}
