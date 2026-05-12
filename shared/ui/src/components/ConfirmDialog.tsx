'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '../lib/cn';
import { Button } from './Button';
import { Modal } from './Modal';

/**
 * Confirmation dialog — composes <Modal> and layers a direct, compact
 * confirmation layout on top. Distinct from <Modal>'s content surface
 * (which uses a big display-serif title and free body):
 *
 *   ▸ Icon block at the left (AlertTriangle by default, override via `icon`)
 *   ▸ Title rendered in **uppercase tracked eyebrow typography** (12px,
 *     letter-spacing 0.18em) — the imperative label of the action, not a
 *     question. e.g. "CANCEL THIS RUN", "REMOVE SCHEDULE", "DELETE USER".
 *   ▸ Description as the main body — full-size paragraph, left-aligned to
 *     the modal edge (no icon-induced indent).
 *   ▸ Right-aligned button row: secondary cancel + primary/destructive
 *     confirm.
 *
 * For content modals (chat, info, custom forms) use <Modal> directly — it
 * keeps the display-serif title and lets your body own the layout. The
 * design system page at /design#toasts-modals shows both side by side.
 */
export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Imperative action label. Rendered uppercase tracked, NOT as a question.
   *  e.g. "Cancel this run", "Remove schedule", "Delete user". */
  title: ReactNode;
  /** Main body text — what will happen, who's affected, blast radius. */
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive confirms get a red primary button. Icon color also shifts. */
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  /** Override the icon. Default AlertTriangle. */
  icon?: ReactNode;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  icon,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);

  // Enter-to-confirm — feels natural in a yes/no dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !busy) void handleConfirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, busy]);

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
      }}
      hideCloseButton
      dismissOnBackdropClick={!busy}
      aria-label={typeof title === 'string' ? title : 'Confirm'}
    >
      <div data-testid="confirm-dialog">
        {/* Icon + title-as-eyebrow share a single horizontal row. */}
        <div className="mb-3 flex items-center gap-2.5">
          <div
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
              destructive
                ? 'bg-heat-critical/10 text-heat-critical'
                : 'bg-accent/10 text-accent',
            )}
          >
            {icon ?? <AlertTriangle className="h-4 w-4" aria-hidden="true" />}
          </div>
          <p
            className="text-text-primary text-[0.78rem] font-semibold tracking-[0.18em] uppercase leading-tight"
            data-testid="confirm-dialog-title"
          >
            {title}
          </p>
        </div>
        {description ? (
          <p className="text-text-secondary text-sm leading-relaxed">{description}</p>
        ) : null}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onOpenChange(false)}
          disabled={busy}
          data-testid="confirm-dialog-cancel"
        >
          {cancelLabel}
        </Button>
        <Button
          type="button"
          variant={destructive ? 'destructive' : 'primary'}
          size="sm"
          onClick={handleConfirm}
          disabled={busy}
          data-testid="confirm-dialog-confirm"
        >
          {busy ? '…' : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
