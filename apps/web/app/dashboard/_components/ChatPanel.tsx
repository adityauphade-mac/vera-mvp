'use client';

import { useChat } from 'ai/react';
import { useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Send } from 'lucide-react';
import { Button } from '@vera/ui';

const SUGGESTIONS = [
  "Who's worst this week?",
  'Anything weird I should know about?',
  'Draft a follow-up for the highest-heat job.',
];

export function ChatPanel() {
  const [open, setOpen] = useState(false);
  const { messages, input, handleInputChange, handleSubmit, isLoading, append } = useChat({
    api: '/api/chat',
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isLoading]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="bg-accent fixed right-6 bottom-6 z-30 flex items-center gap-2 rounded-full px-5 py-3 text-sm font-medium text-white shadow-lg transition-shadow hover:shadow-xl"
      >
        <MessageCircle className="h-4 w-4" aria-hidden="true" />
        Ask Vera
      </button>
    );
  }

  return (
    <aside
      className="border-border bg-bg-card fixed top-0 right-0 z-40 flex h-full w-full max-w-md flex-col border-l shadow-xl"
      role="complementary"
      aria-label="Chat with Vera"
    >
      <header className="border-border flex items-baseline justify-between border-b px-6 py-5">
        <div>
          <p className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
            Chatting with
          </p>
          <p className="font-display text-2xl tracking-tight">Vera</p>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="text-text-muted hover:text-text-primary"
          aria-label="Close chat"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
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
              return (
                <div key={m.id} className={isVera ? '' : 'flex justify-end'}>
                  <div
                    className={
                      isVera
                        ? 'border-accent text-text-primary max-w-[90%] border-l-2 pl-4 text-sm leading-relaxed whitespace-pre-wrap'
                        : 'bg-bg-base text-text-primary max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap'
                    }
                  >
                    {text}
                  </div>
                </div>
              );
            })}
            {isLoading ? (
              <p className="text-text-muted text-sm italic">Vera is thinking…</p>
            ) : null}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="border-border border-t px-5 py-4">
        <div className="border-border focus-within:border-accent flex items-center gap-2 rounded-full border px-1 py-1 pl-5">
          <input
            value={input}
            onChange={handleInputChange}
            placeholder="Ask Vera anything about AR…"
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
    </aside>
  );
}

function extractText(message: { content?: unknown; parts?: unknown[] }): string {
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.parts)) {
    return message.parts
      .map((part) => {
        if (part && typeof part === 'object' && 'type' in part && (part as { type: string }).type === 'text') {
          return (part as { text?: string }).text ?? '';
        }
        return '';
      })
      .join('');
  }
  return '';
}
