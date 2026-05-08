'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { VeraAvatar } from '@vera/ui';
import { SidebarNav } from './SidebarNav';

/**
 * Top-right hamburger that opens a slide-in drawer from the right edge.
 * Only mounts on `<md` (the desktop sidebar handles `>=md`).
 *
 * Drawer closes via the X button (and on navigation). Closing plays the
 * vera-drawer-out exit animation, then unmounts. Body scroll is locked
 * while open so the page underneath doesn't drift.
 */
// Match vera-drawer-out duration in globals.css.
const EXIT_DURATION_MS = 240;

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setMounted(true);
    return () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  // Two-step close: render the exit animation, then unmount once it ends.
  function handleClose() {
    if (closing) return;
    setClosing(true);
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
      closeTimerRef.current = null;
    }, EXIT_DURATION_MS);
  }

  // Route change should also play the exit animation, not snap-close.
  useEffect(() => {
    if (open) handleClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
        className="border-border text-text-secondary hover:text-text-primary hover:bg-bg-base inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {mounted && open
        ? createPortal(
            <div
              className="fixed inset-0 z-[80] md:hidden"
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
            >
              <div
                className={`bg-black/40 absolute inset-0 ${
                  closing ? 'vera-backdrop-out' : 'vera-backdrop-in'
                }`}
                aria-hidden="true"
                onClick={handleClose}
              />
              <aside
                className={`bg-bg-card border-border absolute top-0 right-0 flex h-full w-[78%] max-w-[18rem] flex-col border-l shadow-xl ${
                  closing ? 'vera-drawer-out' : 'vera-drawer-in'
                }`}
              >
                <div className="border-border flex h-[84px] items-center justify-between gap-3 border-b px-5">
                  <Link
                    href="/"
                    className="flex items-center gap-3"
                    onClick={handleClose}
                  >
                    <VeraAvatar size="md" />
                    <div>
                      <p className="text-text-muted text-[0.65rem] tracking-[0.25em] uppercase">
                        Vera Calloway
                      </p>
                      <p className="font-display mt-1 text-2xl tracking-tight leading-none">
                        AI Studio
                      </p>
                    </div>
                  </Link>
                  <button
                    type="button"
                    onClick={handleClose}
                    aria-label="Close navigation"
                    className="text-text-muted hover:text-text-primary -mr-1 rounded-full p-2 transition-colors"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <SidebarNav />
                </div>
              </aside>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
