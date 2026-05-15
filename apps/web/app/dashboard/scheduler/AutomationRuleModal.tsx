'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  automationRuleSchema,
  METRIC_VALUES,
  OPERATOR_VALUES,
  RECIPIENT_MODE_VALUES,
  type AutomationRuleValues,
} from '@vera/types';
import {
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  toast,
} from '@vera/ui';

const METRIC_LABEL: Record<(typeof METRIC_VALUES)[number], string> = {
  aging_days: 'Aging (days)',
  balance: 'Balance ($)',
  heat_score: 'Heat score (0–100)',
};

const OPERATOR_LABEL: Record<(typeof OPERATOR_VALUES)[number], string> = {
  crosses_above: 'Crosses above',
  crosses_below: 'Crosses below',
  stays_above_for_n_days: 'Stays above for N days',
};

const RECIPIENT_LABEL: Record<(typeof RECIPIENT_MODE_VALUES)[number], string> = {
  assigned_rep: 'Assigned rep on the job',
  fixed_email: 'Specific email address',
};

interface PreviewMatch {
  id: number;
  customer: string;
  address: string;
  balance: number;
  daysPastTerms: number;
  heatScore: number;
  repName: string | null;
  repEmail: string | null;
}

export interface AutomationRuleModalProps {
  open: boolean;
  /** null when creating, populated when editing. */
  initial: (AutomationRuleValues & { id: number }) | null;
  onClose: () => void;
  onSaved: () => void;
}

const DEFAULT_VALUES: AutomationRuleValues = {
  name: '',
  metric: 'heat_score',
  operator: 'crosses_above',
  threshold: 80,
  thresholdDays: null,
  recipientMode: 'fixed_email',
  recipientEmail: null,
  subjectTemplate:
    'Heads up on {{job.customer}} — {{metric.name}} {{metric.value}}',
  bodyTemplate:
    "Hi {{rep.name}},\n\nThe AR job for {{job.customer}} just crossed a threshold ({{rule.name}}).\nBalance: {{job.balance}} · Aging: {{job.aging_days}} days · Heat: {{job.heat_score}}.\n\nPlease follow up.\n\n— Vera",
  dailySendCap: 25,
  enabled: true,
};

export function AutomationRuleModal({
  open,
  initial,
  onClose,
  onSaved,
}: AutomationRuleModalProps) {
  const [mounted, setMounted] = useState(false);
  const [previewMatchCount, setPreviewMatchCount] = useState<number | null>(null);
  const [preview, setPreview] = useState<PreviewMatch[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => setMounted(true), []);

  const defaults = useMemo<AutomationRuleValues>(() => {
    if (initial) {
      // strip the id from the form values
      const { id: _id, ...rest } = initial;
      return rest;
    }
    return DEFAULT_VALUES;
  }, [initial]);

  const form = useForm<AutomationRuleValues>({
    resolver: zodResolver(automationRuleSchema),
    defaultValues: defaults,
    mode: 'onChange',
  });

  useEffect(() => {
    if (open) form.reset(defaults);
    if (!open) {
      setPreviewMatchCount(null);
      setPreview([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaults]);

  const values = form.watch();
  const showThresholdDays = values.operator === 'stays_above_for_n_days';
  const showRecipientEmail = values.recipientMode === 'fixed_email';

  async function runPreview() {
    // For unsaved rules we can't hit the preview endpoint (which is keyed
    // on rule id). Instead we hit the create endpoint with a "dry" flag —
    // actually, simplest path: only enable preview after the rule exists.
    // Since rules persist + auto-bootstrap on create, the simpler MVP is:
    // when creating, validate the form locally and let the user save → the
    // bootstrap counts how many baseline rows landed. When editing, hit
    // the /preview endpoint.
    if (!initial) {
      toast.info(
        'Save the rule first — Vera will snapshot the current state without firing.',
        {
          description:
            'Editing an existing rule shows a live preview of matching jobs.',
        },
      );
      return;
    }
    setPreviewLoading(true);
    try {
      const res = await fetch(
        `/api/automation-rules/${initial.id}/preview`,
        { method: 'POST' },
      );
      if (!res.ok) {
        toast.error('Preview failed');
        return;
      }
      const json = (await res.json()) as {
        matchedCount: number;
        preview: PreviewMatch[];
      };
      setPreviewMatchCount(json.matchedCount);
      setPreview(json.preview);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function onSave(submitValues: AutomationRuleValues) {
    setSubmitting(true);
    try {
      const url = initial
        ? `/api/automation-rules/${initial.id}`
        : '/api/automation-rules';
      const method = initial ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(submitValues),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        toast.error(data?.error?.message ?? 'Save failed');
        return;
      }
      toast.success(
        initial
          ? `Updated rule "${submitValues.name}"`
          : `Created rule "${submitValues.name}" — current state snapshotted, future crossings will fire`,
      );
      onSaved();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  if (!open || !mounted) return null;

  const modal = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-bg-card border-border flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-[var(--radius-card)] border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-border flex shrink-0 items-center justify-between gap-3 border-b px-5 py-4 sm:px-7 sm:py-5">
          <div className="min-w-0">
            <p className="text-text-muted truncate text-[0.65rem] tracking-[0.2em] uppercase">
              {initial ? 'Edit rule' : 'New automation rule'}
            </p>
            <h2 className="font-display mt-1 truncate text-xl tracking-tight">
              {initial ? initial.name : 'Watch a metric, propose an email'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary -mr-2 shrink-0 rounded-full p-2 transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSave)}
            className="flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6"
          >
            {/* Name */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FieldLabel>Rule name</FieldLabel>
                  <FormControl>
                    <input
                      {...field}
                      type="text"
                      className="border-border focus:border-accent bg-bg-card text-text-primary placeholder:text-text-muted w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors"
                      placeholder="60-day critical chase"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Metric + operator + threshold row */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <FormField
                control={form.control}
                name="metric"
                render={({ field }) => (
                  <FormItem>
                    <FieldLabel>Metric</FieldLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger aria-label="Metric">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {METRIC_VALUES.map((m) => (
                            <SelectItem key={m} value={m}>
                              {METRIC_LABEL[m]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="operator"
                render={({ field }) => (
                  <FormItem>
                    <FieldLabel>Operator</FieldLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger aria-label="Operator">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {OPERATOR_VALUES.map((o) => (
                            <SelectItem key={o} value={o}>
                              {OPERATOR_LABEL[o]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="threshold"
                render={({ field }) => (
                  <FormItem>
                    <FieldLabel>Threshold</FieldLabel>
                    <FormControl>
                      <input
                        type="number"
                        step="any"
                        value={Number.isFinite(field.value) ? field.value : ''}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === '' ? NaN : Number(e.target.value),
                          )
                        }
                        className="border-border focus:border-accent bg-bg-card text-text-primary placeholder:text-text-muted w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {showThresholdDays ? (
              <FormField
                control={form.control}
                name="thresholdDays"
                render={({ field }) => (
                  <FormItem>
                    <FieldLabel>Days above threshold before firing</FieldLabel>
                    <FormControl>
                      <input
                        type="number"
                        min={1}
                        value={field.value ?? ''}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === ''
                              ? null
                              : Math.max(1, Number(e.target.value)),
                          )
                        }
                        className="border-border focus:border-accent bg-bg-card text-text-primary placeholder:text-text-muted w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors"
                        placeholder="7"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            {/* Recipient */}
            <FormField
              control={form.control}
              name="recipientMode"
              render={({ field }) => (
                <FormItem>
                  <FieldLabel>Recipient</FieldLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger aria-label="Recipient mode">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {RECIPIENT_MODE_VALUES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {RECIPIENT_LABEL[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {showRecipientEmail ? (
              <FormField
                control={form.control}
                name="recipientEmail"
                render={({ field }) => (
                  <FormItem>
                    <FieldLabel>Recipient email</FieldLabel>
                    <FormControl>
                      <input
                        type="email"
                        value={field.value ?? ''}
                        onChange={(e) =>
                          field.onChange(e.target.value === '' ? null : e.target.value)
                        }
                        className="border-border focus:border-accent bg-bg-card text-text-primary placeholder:text-text-muted w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors"
                        placeholder="ops@yourcompany.com"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            {/* Email template — collapsed by default. The defaults work for
                most rules; expand only if the operator wants to customize
                the subject/body or use placeholders other than the defaults. */}
            <details className="border-border bg-bg-base/40 group rounded-2xl border p-4">
              <summary className="text-text-secondary flex cursor-pointer items-center justify-between text-sm">
                <span>
                  Customize the email Vera proposes
                  <span className="text-text-muted ml-2 text-xs">
                    (defaults work fine — expand to edit)
                  </span>
                </span>
                <span className="text-text-muted group-open:rotate-180 transition-transform">
                  ▾
                </span>
              </summary>
              <div className="mt-4 space-y-4">
                <FormField
                  control={form.control}
                  name="subjectTemplate"
                  render={({ field }) => (
                    <FormItem>
                      <FieldLabel>Subject</FieldLabel>
                      <FormControl>
                        <input
                          {...field}
                          type="text"
                          className="border-border focus:border-accent bg-bg-card text-text-primary placeholder:text-text-muted w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors"
                        />
                      </FormControl>
                      <p className="text-text-muted text-xs">
                        Placeholders: {'{{job.customer}}'}, {'{{job.balance}}'},{' '}
                        {'{{job.aging_days}}'}, {'{{job.heat_score}}'},{' '}
                        {'{{rule.name}}'}, {'{{rep.name}}'}, {'{{rep.email}}'},{' '}
                        {'{{metric.value}}'}, {'{{metric.name}}'}
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="bodyTemplate"
                  render={({ field }) => (
                    <FormItem>
                      <FieldLabel>Body</FieldLabel>
                      <FormControl>
                        <textarea
                          {...field}
                          rows={8}
                          className="border-border focus:border-accent bg-bg-card text-text-primary placeholder:text-text-muted w-full resize-y rounded-xl border px-3 py-2.5 text-sm leading-relaxed outline-none transition-colors"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </details>

            {/* Daily send cap + enabled */}
            <div className="flex flex-wrap items-end gap-4">
              <FormField
                control={form.control}
                name="dailySendCap"
                render={({ field }) => (
                  <FormItem className="grow">
                    <FieldLabel>Daily send cap</FieldLabel>
                    <FormControl>
                      <input
                        type="number"
                        min={1}
                        max={500}
                        value={field.value}
                        onChange={(e) =>
                          field.onChange(Math.max(1, Number(e.target.value)))
                        }
                        className="border-border focus:border-accent bg-bg-card text-text-primary placeholder:text-text-muted w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors"
                      />
                    </FormControl>
                    <p className="text-text-muted text-xs">
                      Hard ceiling on PendingRuleSend rows this rule may create per
                      24h. Prevents a misconfigured threshold from avalanching.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="enabled"
                render={({ field }) => (
                  <FormItem className="flex shrink-0 items-center gap-2">
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={(v) => field.onChange(v)}
                      />
                    </FormControl>
                    <FieldLabel>Enabled</FieldLabel>
                  </FormItem>
                )}
              />
            </div>

            {/* Preview block — only shown when editing an existing rule. */}
            {initial ? (
              <div className="border-border bg-bg-base/40 space-y-2 rounded-2xl border p-4">
                <div className="flex items-center justify-between">
                  <p className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
                    Dry-run preview
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={runPreview}
                    disabled={previewLoading}
                  >
                    {previewLoading ? 'Loading…' : 'Run preview'}
                  </Button>
                </div>
                {previewMatchCount !== null ? (
                  <>
                    <p className="text-text-secondary text-sm">
                      {previewMatchCount === 0
                        ? 'No jobs match this threshold right now.'
                        : `${previewMatchCount} job${previewMatchCount === 1 ? '' : 's'} currently match.`}
                    </p>
                    {preview.length > 0 ? (
                      <ul className="text-text-primary mt-1 list-disc space-y-0.5 pl-5 text-xs">
                        {preview.map((p) => (
                          <li key={p.id}>
                            {p.customer} — {p.repName ?? 'unassigned'} ·{' '}
                            {p.daysPastTerms}d · {' '}
                            {new Intl.NumberFormat('en-US', {
                              style: 'currency',
                              currency: 'USD',
                              maximumFractionDigits: 0,
                            }).format(p.balance)}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                ) : (
                  <p className="text-text-muted text-xs">
                    Click "Run preview" to see how many jobs currently match.
                  </p>
                )}
              </div>
            ) : null}
          </form>
        </Form>

        <div className="bg-bg-base/40 border-border flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3 sm:px-7 sm:py-4">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={submitting || !form.formState.isValid}
            onClick={form.handleSubmit(onSave)}
          >
            {submitting ? 'Saving…' : initial ? 'Save changes' : 'Create rule'}
          </Button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-text-muted block text-[0.65rem] tracking-[0.2em] uppercase">
      {children}
    </label>
  );
}
