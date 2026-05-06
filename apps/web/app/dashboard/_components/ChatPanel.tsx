'use client';

import { useChat } from 'ai/react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X, Send } from 'lucide-react';
import { Button, VeraAvatar } from '@vera/ui';

const SUGGESTIONS = [
  "Who's worst this week?",
  'Anything weird I should know about?',
  'Draft a follow-up for the highest-heat job.',
];

const CALLOUT_KEY = 'vera-chat-callout-dismissed';

export function ChatPanel() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showCallout, setShowCallout] = useState(false);
  const { messages, input, handleInputChange, handleSubmit, isLoading, append } = useChat({
    api: '/api/chat',
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    if (typeof sessionStorage !== 'undefined') {
      const dismissed = sessionStorage.getItem(CALLOUT_KEY);
      if (!dismissed) {
        const t = window.setTimeout(() => setShowCallout(true), 1400);
        return () => window.clearTimeout(t);
      }
    }
  }, []);

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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isLoading]);

  function dismissCallout() {
    setShowCallout(false);
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(CALLOUT_KEY, '1');
    }
  }

  function handleOpen() {
    setOpen(true);
    dismissCallout();
  }

  const trigger = (
    <div className="fixed right-6 bottom-6 z-30 flex flex-col items-end gap-3">
      {showCallout ? (
        <div
          role="status"
          className="bg-bg-card border-border text-text-primary vera-callout-in relative max-w-[260px] rounded-2xl border px-4 py-3 text-sm shadow-[0_8px_24px_-8px_rgba(31,27,22,0.25)]"
        >
          <p className="font-display text-base leading-tight font-medium">
            Ask me anything
          </p>
          <p className="text-text-secondary mt-1 text-xs leading-relaxed">
            Who&apos;s worst this week, draft a follow-up, why a job is critical — I
            answer grounded in real data.
          </p>
          <button
            onClick={dismissCallout}
            className="text-text-muted hover:text-text-primary absolute top-2 right-2 rounded-full p-1 text-xs transition-colors"
            aria-label="Dismiss"
          >
            <X className="h-3 w-3" />
          </button>
          <span
            aria-hidden="true"
            className="bg-bg-card border-border absolute -bottom-1.5 right-9 h-3 w-3 rotate-45 border-r border-b"
          />
        </div>
      ) : null}
      <button
        onClick={handleOpen}
        className="bg-accent vera-fab-pulse flex items-center gap-2 rounded-full py-1.5 pr-5 pl-1.5 text-sm font-medium text-white shadow-lg transition-shadow hover:shadow-xl"
        aria-label="Ask Me"
      >
        <VeraAvatar size="sm" ring />
        Ask Me
      </button>
    </div>
  );

  const modal =
    open && mounted ? (
      createPortal(
        <div
          className="vera-backdrop-in fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Chat with Vera"
          onClick={() => setOpen(false)}
        >
          <div
            className="vera-modal-in bg-bg-card border-border flex h-full max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="border-border flex items-center justify-between gap-4 border-b px-7 py-5">
              <div className="flex items-center gap-3">
                <VeraAvatar size="md" />
                <div>
                  <p className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
                    Chatting with
                  </p>
                  <p className="font-display mt-0.5 text-2xl leading-tight tracking-tight">
                    Vera
                  </p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-text-muted hover:text-text-primary -mr-2 rounded-full p-2 transition-colors"
                aria-label="Close chat"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-7 py-6">
              {messages.length === 0 ? (
                <div className="space-y-6">
                  <p className="text-text-secondary text-sm leading-relaxed">
                    I can talk through any AR question, summarise a rep&apos;s situation, or
                    draft a follow-up email. What&apos;s on your mind?
                  </p>
                  <div className="space-y-2">
                    <p className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
                      Try asking
                    </p>
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => append({ role: 'user', content: s })}
                        className="border-border hover:border-accent text-text-primary w-full rounded-2xl border bg-transparent px-4 py-3 text-left text-sm transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  {messages.map((m) => {
                    if (m.role !== 'user' && m.role !== 'assistant') return null;
                    const text = extractText(m);
                    if (!text.trim()) return null;
                    const isVera = m.role === 'assistant';
                    if (isVera) {
                      return (
                        <div key={m.id} className="flex max-w-[95%] gap-3">
                          <VeraAvatar size="xs" className="mt-1" />
                          <div className="border-accent text-text-primary flex-1 border-l-2 pl-3 text-sm leading-relaxed">
                            <MarkdownMessage text={text} />
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div key={m.id} className="flex justify-end">
                        <div className="bg-bg-base text-text-primary max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
                          {text}
                        </div>
                      </div>
                    );
                  })}
                  {isLoading ? (
                    <div className="flex items-center gap-3">
                      <VeraAvatar size="xs" />
                      <p className="text-text-muted text-sm italic">Vera is thinking…</p>
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            <form
              onSubmit={handleSubmit}
              className="border-border bg-bg-card border-t px-5 py-4"
            >
              <div className="border-border focus-within:border-accent flex items-center gap-2 rounded-full border px-1 py-1 pl-5">
                <input
                  value={input}
                  onChange={handleInputChange}
                  placeholder="Ask me anything about AR…"
                  className="text-text-primary placeholder:text-text-muted flex-1 bg-transparent text-sm outline-none"
                  aria-label="Message"
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={isLoading || input.trim().length === 0}
                  aria-label="Send message"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )
    ) : null;

  return (
    <>
      {!open ? trigger : null}
      {modal}
    </>
  );
}

function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="vera-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
          strong: ({ children }) => (
            <strong className="text-text-primary font-semibold">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => <ul className="mb-3 ml-5 list-disc space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="mb-3 ml-5 list-decimal space-y-1">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          h1: ({ children }) => (
            <h3 className="font-display mt-4 mb-2 text-lg font-medium tracking-tight">
              {children}
            </h3>
          ),
          h2: ({ children }) => (
            <h3 className="font-display mt-4 mb-2 text-base font-medium tracking-tight">
              {children}
            </h3>
          ),
          h3: ({ children }) => (
            <h3 className="text-text-primary mt-3 mb-1 text-sm font-semibold">{children}</h3>
          ),
          code: ({ children }) => (
            <code className="bg-bg-base text-text-primary rounded px-1 py-0.5 text-[0.85em]">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="bg-bg-base mb-3 overflow-x-auto rounded-lg p-3 text-xs">
              {children}
            </pre>
          ),
          a: ({ href, children }) => (
            <a href={href} className="text-accent underline-offset-2 hover:underline">
              {children}
            </a>
          ),
          hr: () => <hr className="border-border my-3" />,
          blockquote: ({ children }) => (
            <blockquote className="border-accent text-text-secondary mb-3 border-l-2 pl-3 italic">
              {children}
            </blockquote>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function extractText(message: { content?: unknown; parts?: unknown[] }): string {
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.parts)) {
    return message.parts
      .map((part) => {
        if (
          part &&
          typeof part === 'object' &&
          'type' in part &&
          (part as { type: string }).type === 'text'
        ) {
          return (part as { text?: string }).text ?? '';
        }
        return '';
      })
      .join('');
  }
  return '';
}
