'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Send, X } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { draftEmailSchema, type DraftEmailValues } from '@vera/types';
import {
  Button,
  EmailChipInput,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
  toast,
  useConfirm,
} from '@vera/ui';

type Mode = 'preview' | 'compose';

export function DraftEmailButton({
  jobId,
  jobAddress,
  repName,
  repEmail,
  subject: initialSubject,
  body: initialBody,
}: {
  jobId: number;
  jobAddress: string;
  repName: string;
  repEmail: string;
  subject: string;
  body: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('preview');
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);

  const initialTo = useMemo(
    () => [repEmail.trim().toLowerCase()],
    [repEmail],
  );

  const defaultValues = useMemo<DraftEmailValues>(
    () => ({
      to: initialTo,
      cc: [],
      subject: initialSubject,
      body: initialBody,
    }),
    [initialTo, initialSubject, initialBody],
  );

  const form = useForm<DraftEmailValues>({
    resolver: zodResolver(draftEmailSchema),
    mode: 'onChange',
    defaultValues,
  });

  const confirm = useConfirm();

  // Live values for preview-mode rendering and clipboard copy. Using watch()
  // means the preview pane reflects edits the user made in compose mode.
  const watched = form.watch();
  const subject = watched.subject;
  const body = watched.body;
  const to = watched.to;
  const cc = watched.cc;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAndReset();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function closeAndReset() {
    setOpen(false);
    setMode('preview');
    form.reset(defaultValues);
    setCopied(false);
  }

  function copy() {
    navigator.clipboard
      .writeText(`Subject: ${subject}\n\n${body}`)
      .then(() => {
        setCopied(true);
        toast.success('Copied to clipboard');
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        toast.error('Copy failed');
      });
  }

  async function onSend(values: DraftEmailValues) {
    const recipientLabel =
      values.to.length === 1 ? values.to[0] : `${values.to.length} recipients`;
    const ok = await confirm({
      title: `Send follow-up to ${recipientLabel}`,
      description:
        values.cc.length > 0
          ? `Vera will send this email now, cc'ing ${values.cc.length} additional ${values.cc.length === 1 ? 'person' : 'people'}. The send is logged in the audit trail.`
          : 'Vera will send this email now. The send is logged in the audit trail.',
      confirmLabel: 'Send now',
      cancelLabel: 'Keep editing',
    });
    if (!ok) return;

    try {
      const res = await fetch('/api/follow-ups/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jobId,
          jobAddress,
          repName,
          to: values.to,
          cc: values.cc,
          subject: values.subject,
          body: values.body,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        toast.error(data?.error?.message ?? 'Send failed');
        return;
      }
      toast.success(`Sent to ${recipientLabel}`);
      closeAndReset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed');
    }
  }

  const sending = form.formState.isSubmitting;
  const canSend = form.formState.isValid && !sending;

  const modal =
    open && mounted ? (
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="draft-email-title"
        onClick={closeAndReset}
      >
        <div
          className="bg-bg-card border-border flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-[var(--radius-card)] border shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="border-border flex shrink-0 items-center justify-between gap-3 border-b px-5 py-4 sm:px-7 sm:py-5">
            <div className="min-w-0">
              <p
                id="draft-email-title"
                className="text-text-muted truncate text-[0.65rem] tracking-[0.2em] uppercase"
              >
                {mode === 'preview' ? `Draft for ${repName}` : `Compose to ${repName}`}
              </p>
              <p className="text-text-secondary mt-1 truncate text-sm">{jobAddress}</p>
            </div>
            <button
              onClick={closeAndReset}
              className="text-text-muted hover:text-text-primary -mr-2 shrink-0 rounded-full p-2 transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {mode === 'preview' ? (
            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
              <div>
                <p className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
                  To
                </p>
                <p className="text-text-primary mt-1.5 text-sm">{repEmail}</p>
              </div>
              <div>
                <p className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
                  Subject
                </p>
                <p className="font-display mt-1.5 text-lg">{subject}</p>
              </div>
              <div>
                <p className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
                  Body
                </p>
                <pre className="text-text-primary mt-2 font-sans text-sm leading-relaxed whitespace-pre-wrap">
                  {body}
                </pre>
              </div>
            </div>
          ) : (
            <Form {...form}>
              <form
                id="draft-email-form"
                onSubmit={form.handleSubmit(onSend)}
                className="flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6"
              >
                <FromField />
                <FormField
                  control={form.control}
                  name="to"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FieldLabel>To</FieldLabel>
                      <FormControl>
                        <EmailChipInput
                          ariaLabel="To"
                          value={field.value}
                          onChange={field.onChange}
                          max={6}
                          invalid={!!fieldState.error}
                          helperText={
                            fieldState.error
                              ? undefined
                              : 'Press Enter or comma to add. Up to 6 recipients.'
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="cc"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FieldLabel>Cc (optional)</FieldLabel>
                      <FormControl>
                        <EmailChipInput
                          ariaLabel="Cc"
                          value={field.value}
                          onChange={field.onChange}
                          max={6}
                          placeholder="cc@company.com"
                          invalid={!!fieldState.error}
                          helperText={
                            fieldState.error
                              ? undefined
                              : 'Optional. Press Enter or comma to add.'
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="subject"
                  render={({ field }) => (
                    <FormItem>
                      <FieldLabel htmlFor="follow-up-subject">Subject</FieldLabel>
                      <FormControl>
                        <input
                          {...field}
                          id="follow-up-subject"
                          type="text"
                          className="border-border focus:border-accent bg-bg-card text-text-primary placeholder:text-text-muted w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors"
                          placeholder="Subject"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="body"
                  render={({ field }) => (
                    <FormItem>
                      <FieldLabel htmlFor="follow-up-body">Body</FieldLabel>
                      <FormControl>
                        <textarea
                          {...field}
                          id="follow-up-body"
                          rows={12}
                          className="border-border focus:border-accent bg-bg-card text-text-primary placeholder:text-text-muted w-full resize-y rounded-xl border px-3 py-2.5 font-sans text-sm leading-relaxed outline-none transition-colors"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </form>
            </Form>
          )}

          <div className="bg-bg-base/40 border-border flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-5 py-3 sm:gap-3 sm:px-7 sm:py-4">
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="md" onClick={copy}>
                {copied ? 'Copied ✓' : 'Copy to clipboard'}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {mode === 'preview' ? (
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => setMode('compose')}
                  aria-label="Send via Vera"
                >
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                  Send via Vera
                </Button>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => setMode('preview')}
                    disabled={sending}
                  >
                    Back
                  </Button>
                  <Button
                    type="submit"
                    form="draft-email-form"
                    variant="primary"
                    size="md"
                    disabled={!canSend}
                  >
                    {sending ? 'Sending…' : 'Send'}
                  </Button>
                </>
              )}
            </div>
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

/**
 * Visual-label primitive used inside <FormItem>. We don't use `<FormLabel>`
 * from @vera/ui here because the existing visual treatment is a tiny
 * uppercase eyebrow (`text-text-muted text-[0.65rem] tracking-[0.2em] uppercase`)
 * rather than the FormLabel default. The FormItem still wires id/aria via
 * <FormControl>, and <FormMessage> still surfaces validation errors —
 * we just present the label with this app-specific class.
 */
function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-text-muted block text-[0.65rem] tracking-[0.2em] uppercase"
    >
      {children}
    </label>
  );
}

function FromField() {
  return (
    <div>
      <p className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">From</p>
      <div className="border-border bg-bg-soft/60 text-text-primary mt-1.5 flex items-center justify-between rounded-xl border px-3 py-2.5 text-sm">
        <span className="truncate">Vera Calloway</span>
        <span className="text-text-muted shrink-0 text-[0.65rem] tracking-[0.2em] uppercase">
          Locked
        </span>
      </div>
      <p className="text-text-muted mt-1 px-0.5 text-xs">
        Sent from Vera&apos;s verified domain. The address can&apos;t be changed.
      </p>
    </div>
  );
}
