'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from '@vera/ui';

export function DraftEmailButton({
  repName,
  repEmail,
  subject,
  body,
}: {
  repName: string;
  repEmail: string;
  subject: string;
  body: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  function copy() {
    navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }

  function openInMail() {
    const mailto = `mailto:${repEmail}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
  }

  const modal =
    open && mounted ? (
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        onClick={() => setOpen(false)}
      >
        <div
          className="bg-bg-card border-border max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-[var(--radius-card)] border shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="border-border flex items-center justify-between border-b px-7 py-5">
            <div>
              <p className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
                Draft for {repName}
              </p>
              <p className="text-text-secondary mt-1 text-sm">{repEmail}</p>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-text-muted hover:text-text-primary -mr-2 rounded-full p-2 transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-5 px-7 py-6">
            <div>
              <p className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
                Subject
              </p>
              <p className="font-display mt-1.5 text-lg">{subject}</p>
            </div>
            <div>
              <p className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">Body</p>
              <pre className="text-text-primary mt-2 font-sans text-sm leading-relaxed whitespace-pre-wrap">
                {body}
              </pre>
            </div>
          </div>
          <div className="bg-bg-base/40 border-border flex justify-end gap-3 border-t px-7 py-4">
            <Button variant="secondary" size="md" onClick={copy}>
              {copied ? 'Copied ✓' : 'Copy to clipboard'}
            </Button>
            <Button variant="primary" size="md" onClick={openInMail}>
              Open in mail
            </Button>
          </div>
        </div>
      </div>
    ) : null;

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Draft email
      </Button>
      {mounted ? createPortal(modal, document.body) : null}
    </>
  );
}
