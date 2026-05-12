'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../lib/cn';

/**
 * Centered modal — the canonical content-surface modal. Use this directly
 * for chat-style modals, info dialogs, and anything where the body owns its
 * own layout (Vera quotes, custom forms).
 *
 * For yes/no confirmations, prefer <ConfirmDialog> which composes this one
 * and adds the standardized icon + confirm/cancel button row.
 *
 * Behavior:
 *   • Renders into document.body via portal (escapes stacking contexts)
 *   • Backdrop click closes (unless `dismissOnBackdropClick={false}`)
 *   • Esc closes
 *   • Body scroll locked while open
 *   • Animated open/close via vera-modal-in / vera-modal-out + backdrop pair
 *
 * Visual chrome: bg-bg-card surface, border-border hairline, --radius-card
 * radius (1.25rem), p-7 padding, shadow-2xl. Same look across the app.
 */
export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  className?: string;
  /** Tailwind max-width class. Default 'max-w-md'. */
  widthClass?: string;
  /** Hide the absolute-positioned X close button in the top-right.
   *  Confirmation dialogs hide this (user must pick an explicit button). */
  hideCloseButton?: boolean;
  /** Skip backdrop-click-to-close (good for destructive confirmations). */
  dismissOnBackdropClick?: boolean;
  'aria-label'?: string;
}

const EXIT_DURATION_MS = 180;

export function Modal({
  open,
  onOpenChange,
  children,
  className,
  widthClass = 'max-w-md',
  hideCloseButton = false,
  dismissOnBackdropClick = true,
  'aria-label': ariaLabel,
}: ModalProps) {
  const [renderOpen, setRenderOpen] = useState(open);
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

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

  useEffect(
    () => () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    },
    [],
  );

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
        'fixed inset-0 z-[120] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm',
        closing ? 'vera-backdrop-out' : 'vera-backdrop-in',
      )}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      data-testid="modal"
      onClick={() => {
        if (dismissOnBackdropClick) onOpenChange(false);
      }}
    >
      <div
        className={cn(
          'bg-bg-card border-border relative w-full rounded-[var(--radius-card)] border p-7 shadow-2xl',
          closing ? 'vera-modal-out' : 'vera-modal-in',
          widthClass,
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {hideCloseButton ? null : (
          <button
            type="button"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
            className="text-text-muted hover:text-text-primary absolute top-4 right-4 rounded-full p-1.5 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
