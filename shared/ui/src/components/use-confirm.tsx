'use client';

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * Promise-based replacement for `window.confirm()`.
 *
 * Usage:
 *   const confirm = useConfirm();
 *   const ok = await confirm({
 *     title: 'Cancel this run?',
 *     description: 'Partial data will be deleted.',
 *     confirmLabel: 'Cancel run',
 *     destructive: true,
 *   });
 *   if (!ok) return;
 *
 * The provider is mounted once at the app root (see ConfirmProvider).
 */
export interface ConfirmOptions {
  /** Imperative action label, NOT a question. Rendered uppercase tracked.
   *  e.g. "Cancel this run", "Remove schedule" — not "Cancel this run?" */
  title: ReactNode;
  /** Main body — what happens, who's affected, what's lost. */
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

type ResolveFn = (v: boolean) => void;

const ConfirmContext = createContext<
  ((opts: ConfirmOptions) => Promise<boolean>) | null
>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<ResolveFn | null>(null);

  const confirm = useCallback(
    (next: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
        setOpts(next);
        setOpen(true);
      }),
    [],
  );

  function settle(value: boolean) {
    setOpen(false);
    const r = resolveRef.current;
    resolveRef.current = null;
    if (r) r(value);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts ? (
        <ConfirmDialog
          open={open}
          onOpenChange={(next) => {
            if (!next) settle(false);
          }}
          title={opts.title}
          description={opts.description}
          confirmLabel={opts.confirmLabel}
          cancelLabel={opts.cancelLabel}
          destructive={opts.destructive}
          onConfirm={() => settle(true)}
        />
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error(
      'useConfirm must be used inside a <ConfirmProvider>. Mount it at the app root.',
    );
  }
  return ctx;
}
