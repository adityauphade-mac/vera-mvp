'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarClock, Plus, Trash2, Zap } from 'lucide-react';
import type { AutomationRuleValues } from '@vera/types';
import {
  Button,
  Card,
  Skeleton,
  SkeletonText,
  Switch,
  toast,
  useConfirm,
} from '@vera/ui';
import { AutomationRuleModal } from './AutomationRuleModal';
import { AutomationPendingQueue } from './AutomationPendingQueue';

interface ServerRule {
  id: number;
  name: string;
  metric: 'aging_days' | 'balance' | 'heat_score';
  operator: 'crosses_above' | 'crosses_below' | 'stays_above_for_n_days';
  threshold: number;
  thresholdDays: number | null;
  recipientMode: 'assigned_rep' | 'fixed_email';
  recipientEmail: string | null;
  subjectTemplate: string;
  bodyTemplate: string;
  dailySendCap: number;
  enabled: boolean;
  lastEvaluatedAt: string | null;
  createdAt: string;
}

const METRIC_LABEL: Record<ServerRule['metric'], string> = {
  aging_days: 'aging',
  balance: 'balance',
  heat_score: 'heat score',
};
const OP_LABEL: Record<ServerRule['operator'], string> = {
  crosses_above: 'crosses above',
  crosses_below: 'crosses below',
  stays_above_for_n_days: 'stays above',
};
const RECIPIENT_LABEL: Record<ServerRule['recipientMode'], string> = {
  assigned_rep: 'Assigned rep',
  fixed_email: 'Fixed email',
};

export function AutomationTab() {
  const [rules, setRules] = useState<ServerRule[] | null>(null);
  const [hasDailySync, setHasDailySync] = useState<boolean | null>(null);
  const [editing, setEditing] = useState<ServerRule | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  // Bumped after Evaluate now / Save rule / any mutation that may add new
  // pending rows. AutomationPendingQueue re-fetches when this changes — so
  // the queue stays in sync with the rule list without a page refresh.
  const [pendingRefreshKey, setPendingRefreshKey] = useState(0);
  const confirm = useConfirm();

  const loadRules = useCallback(async () => {
    const res = await fetch('/api/automation-rules', { cache: 'no-store' });
    if (!res.ok) return;
    const json = (await res.json()) as { rules: ServerRule[] };
    setRules(json.rules);
  }, []);

  const loadSyncStatus = useCallback(async () => {
    const res = await fetch('/api/backfills', { cache: 'no-store' });
    if (!res.ok) {
      setHasDailySync(false);
      return;
    }
    const json = (await res.json()) as {
      schedules: Array<{ cadence: string; enabled: boolean }>;
    };
    setHasDailySync(
      json.schedules.some((s) => s.cadence === 'daily' && s.enabled),
    );
  }, []);

  useEffect(() => {
    void loadRules();
    void loadSyncStatus();
  }, [loadRules, loadSyncStatus]);

  async function evaluateNow() {
    setEvaluating(true);
    const id = toast.loading('Evaluating rules against current AR data…');
    try {
      const res = await fetch('/api/automation-rules/evaluate-now', {
        method: 'POST',
      });
      if (!res.ok) {
        toast.error('Evaluate failed', { id });
        return;
      }
      const json = (await res.json()) as {
        result: {
          rulesEvaluated: number;
          firesCreated: number;
          pendingSendsCreated: number;
        };
      };
      toast.success(
        `${json.result.pendingSendsCreated} new pending send${json.result.pendingSendsCreated === 1 ? '' : 's'} from ${json.result.rulesEvaluated} rule${json.result.rulesEvaluated === 1 ? '' : 's'}`,
        { id },
      );
      await loadRules();
      // Tell the pending queue to re-fetch so the new rows show up without
      // a page refresh.
      setPendingRefreshKey((k) => k + 1);
    } finally {
      setEvaluating(false);
    }
  }

  async function toggleEnabled(rule: ServerRule, next: boolean) {
    // PUT carries the full form shape; just flip the enabled flag.
    const body: AutomationRuleValues = {
      name: rule.name,
      metric: rule.metric,
      operator: rule.operator,
      threshold: rule.threshold,
      thresholdDays: rule.thresholdDays,
      recipientMode: rule.recipientMode,
      recipientEmail: rule.recipientEmail,
      subjectTemplate: rule.subjectTemplate,
      bodyTemplate: rule.bodyTemplate,
      dailySendCap: rule.dailySendCap,
      enabled: next,
    };
    const res = await fetch(`/api/automation-rules/${rule.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      toast.error(`Couldn't ${next ? 'enable' : 'disable'} rule`);
      return;
    }
    toast.success(next ? 'Rule enabled' : 'Rule disabled');
    await loadRules();
  }

  async function deleteRule(rule: ServerRule) {
    const ok = await confirm({
      title: `Delete rule "${rule.name}"`,
      description:
        'The rule, its baseline state, and any unresolved pending sends will be removed. Sent emails in the audit log are preserved.',
      confirmLabel: 'Delete rule',
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/automation-rules/${rule.id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      toast.error('Delete failed');
      return;
    }
    toast.success('Rule deleted');
    await loadRules();
  }

  return (
    <div className="space-y-6">
      {/* Warning banner: rules need a daily sync to fire. */}
      {hasDailySync === false ? (
        <Card>
          <div className="flex items-start gap-3">
            <AlertCircle className="text-heat-critical mt-0.5 h-5 w-5 shrink-0" />
            <div className="space-y-1 text-sm">
              <p className="text-text-primary font-medium">
                Rules need a daily sync to fire.
              </p>
              <p className="text-text-secondary text-xs leading-relaxed">
                No daily sync is currently scheduled — rules will only evaluate
                when you click "Evaluate now" below.{' '}
                <a
                  href="/dashboard/scheduler?tab=sync"
                  className="text-accent hover:underline"
                >
                  Set one up under Data sync
                </a>
                .
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl tracking-tight sm:text-2xl">
            Automation rules
          </h2>
          <p className="text-text-secondary mt-1 max-w-2xl text-sm">
            Watch aging, balance, or heat score for threshold transitions.
            Matches land in the pending queue below — Vera never sends without a
            human approve.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="md"
            onClick={evaluateNow}
            disabled={evaluating || !rules || rules.length === 0}
          >
            <Zap className="mr-2 h-3.5 w-3.5" />
            {evaluating ? 'Evaluating…' : 'Evaluate now'}
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            <Plus className="mr-2 h-3.5 w-3.5" />
            New rule
          </Button>
        </div>
      </div>

      {/* Rule list */}
      {rules === null ? (
        <Card>
          <div className="space-y-2">
            <SkeletonText width="w-48" />
            <SkeletonText width="w-64" />
            <Skeleton className="h-3 w-32" />
          </div>
        </Card>
      ) : rules.length === 0 ? (
        <Card>
          <div className="space-y-2 text-center">
            <p className="text-text-primary font-medium">No automation rules yet.</p>
            <p className="text-text-secondary text-sm">
              Click <strong>New rule</strong> to define one. Rules don't fire
              until a sync completes — the first save snapshots the current AR
              state so already-above-threshold jobs don't avalanche the queue.
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              onEdit={() => {
                setEditing(rule);
                setModalOpen(true);
              }}
              onDelete={() => deleteRule(rule)}
              onToggle={(v) => toggleEnabled(rule, v)}
            />
          ))}
        </div>
      )}

      {/* Pending queue lives under the rule list — see Phase B-6.
          `refreshKey` is bumped by `evaluateNow` above so the queue
          re-fetches without the user having to reload the page. */}
      <AutomationPendingQueue refreshKey={pendingRefreshKey} />

      <AutomationRuleModal
        open={modalOpen}
        initial={editing}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          void loadRules();
        }}
      />
    </div>
  );
}

function RuleCard({
  rule,
  onEdit,
  onDelete,
  onToggle,
}: {
  rule: ServerRule;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (next: boolean) => void;
}) {
  const conditionText = `${METRIC_LABEL[rule.metric]} ${OP_LABEL[rule.operator]} ${formatThreshold(rule.metric, rule.threshold)}${rule.operator === 'stays_above_for_n_days' && rule.thresholdDays ? ` for ${rule.thresholdDays} days` : ''}`;

  const recipientText =
    rule.recipientMode === 'assigned_rep'
      ? 'Assigned rep on the job'
      : rule.recipientEmail ?? 'No address';

  const lastEvaluatedAgo = useMemo(
    () => (rule.lastEvaluatedAt ? relativeTime(rule.lastEvaluatedAt) : null),
    [rule.lastEvaluatedAt],
  );
  const stale = isStale(rule.lastEvaluatedAt);
  const dimmed = rule.enabled ? '' : 'opacity-60';

  return (
    <Card data-testid={`rule-card-${rule.id}`}>
      <div className={`space-y-3 transition-opacity ${dimmed}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-lg tracking-tight">{rule.name}</h3>
              <span className="border-border bg-bg-base text-text-muted rounded-full border px-2 py-0.5 text-[0.65rem] tracking-[0.18em] uppercase">
                When {conditionText}
              </span>
              {stale && rule.enabled ? (
                <span className="border-amber-400/40 bg-amber-50/10 text-amber-600 rounded-full border px-2 py-0.5 text-[0.65rem] tracking-[0.18em] uppercase">
                  Stale
                </span>
              ) : null}
            </div>
            <p className="text-text-secondary text-xs">
              Email <strong>{recipientText}</strong> · Cap {rule.dailySendCap}/day
            </p>
            <p className="text-text-muted text-xs">
              {rule.lastEvaluatedAt
                ? `Last evaluated ${lastEvaluatedAgo}`
                : 'Never evaluated — run a sync or click Evaluate now'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Switch
              checked={rule.enabled}
              onCheckedChange={onToggle}
              aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'}
            />
            <Button variant="secondary" size="sm" onClick={onEdit}>
              <CalendarClock className="mr-1.5 h-3.5 w-3.5" />
              Edit
            </Button>
            <Button variant="ghost" size="sm" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function formatThreshold(metric: ServerRule['metric'], value: number): string {
  if (metric === 'balance') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value);
  }
  if (metric === 'aging_days') return `${value}d`;
  return String(Math.round(value));
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function isStale(iso: string | null): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() > 36 * 60 * 60 * 1000;
}
