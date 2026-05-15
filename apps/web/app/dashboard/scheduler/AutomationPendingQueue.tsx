'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Check, X } from 'lucide-react';
import { Button, Card, Skeleton, SkeletonText, toast, useConfirm } from '@vera/ui';

interface PendingRow {
  id: number;
  tenantId: number;
  ruleId: number;
  jobId: number;
  triggerSnapshot: {
    metric: 'aging_days' | 'balance' | 'heat_score';
    operator: 'crosses_above' | 'crosses_below' | 'stays_above_for_n_days';
    threshold: number;
    thresholdDays: number | null;
    metricValueAtFire: number;
    reason: 'crossed_above' | 'crossed_below' | 'stayed_above_for_days';
    jobSnapshot: {
      customer: string;
      balance: number;
      daysPastTerms: number;
      heatScore: number;
      rep: { name: string; email: string | null } | null;
    };
  };
  proposedRecipient: string | null;
  proposedSubject: string;
  proposedBody: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  rule: { id: number; name: string };
}

export function AutomationPendingQueue({
  refreshKey = 0,
}: {
  /** Parent bumps this after evaluate-now / rule-save to force a re-fetch. */
  refreshKey?: number;
}) {
  const [rows, setRows] = useState<PendingRow[] | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    const res = await fetch('/api/automation-rules/pending', {
      cache: 'no-store',
    });
    if (!res.ok) return;
    const json = (await res.json()) as { pending: PendingRow[] };
    setRows(json.pending);
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function approve(row: PendingRow) {
    const isMissing = row.status === 'missing_recipient';
    const recipient = isMissing
      ? (overrides[row.id] ?? '').trim()
      : row.proposedRecipient ?? '';
    if (!recipient) {
      toast.error('Enter a recipient first');
      return;
    }
    const ok = await confirm({
      title: `Send this email to ${recipient}?`,
      description:
        'Vera will send the email now. The send is logged in the audit trail.',
      confirmLabel: 'Send now',
      cancelLabel: 'Keep reviewing',
    });
    if (!ok) return;
    setBusy(row.id);
    const id = toast.loading('Sending…');
    try {
      const res = await fetch(
        `/api/automation-rules/pending/${row.id}/approve`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            isMissing ? { recipientOverride: recipient } : {},
          ),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        toast.error(data?.error?.message ?? 'Send failed', { id });
        return;
      }
      toast.success(`Sent to ${recipient}`, { id });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function reject(row: PendingRow) {
    const ok = await confirm({
      title: 'Reject this pending send?',
      description:
        "Vera won't send this email. The action is logged. (Inline reason capture coming in a follow-up; for now leave a note on the audit row if needed.)",
      confirmLabel: 'Reject',
      cancelLabel: 'Keep reviewing',
      destructive: true,
    });
    if (!ok) return;
    setBusy(row.id);
    try {
      const res = await fetch(
        `/api/automation-rules/pending/${row.id}/reject`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) {
        toast.error('Reject failed');
        return;
      }
      toast.success('Rejected');
      await load();
    } finally {
      setBusy(null);
    }
  }

  /** Approve every row in `pending` status that has a recipient resolved.
   *  Rows in `missing_recipient` status are skipped — they need a manual
   *  override and the user can hit those individually. */
  async function approveAll() {
    const eligible = (rows ?? []).filter(
      (r) => r.status === 'pending' && r.proposedRecipient,
    );
    const skipped = (rows ?? []).filter(
      (r) => r.status === 'missing_recipient',
    ).length;
    if (eligible.length === 0) {
      toast.error('Nothing to approve', {
        description:
          skipped > 0
            ? `${skipped} row${skipped === 1 ? '' : 's'} need${skipped === 1 ? 's' : ''} a recipient override — approve those individually.`
            : 'No pending sends in the queue.',
      });
      return;
    }
    const ok = await confirm({
      title: `Send all ${eligible.length} pending emails?`,
      description:
        skipped > 0
          ? `Vera will send ${eligible.length} email${eligible.length === 1 ? '' : 's'} now. ${skipped} row${skipped === 1 ? '' : 's'} need${skipped === 1 ? 's' : ''} a recipient override and will be skipped — approve those individually.`
          : `Vera will send ${eligible.length} email${eligible.length === 1 ? '' : 's'} now. Each send is logged in the audit trail.`,
      confirmLabel: `Send ${eligible.length}`,
      cancelLabel: 'Keep reviewing',
    });
    if (!ok) return;

    setBulkBusy(true);
    const toastId = toast.loading(`Sending 0 of ${eligible.length}…`);
    let sent = 0;
    let failed = 0;
    for (const row of eligible) {
      try {
        const res = await fetch(
          `/api/automation-rules/pending/${row.id}/approve`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          },
        );
        if (res.ok) sent += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
      // Update the loading toast in-place so the operator sees progress.
      toast.loading(`Sending ${sent + failed} of ${eligible.length}…`, {
        id: toastId,
      });
    }
    setBulkBusy(false);
    if (failed === 0) {
      toast.success(`Sent ${sent} email${sent === 1 ? '' : 's'}`, {
        id: toastId,
      });
    } else {
      toast.error(
        `Sent ${sent}, failed ${failed} — check the audit log for details`,
        { id: toastId },
      );
    }
    await load();
  }

  /** Reject every pending / missing_recipient row in one shot. Useful when
   *  a misconfigured rule avalanches the queue. */
  async function rejectAll() {
    const eligible = (rows ?? []).filter(
      (r) => r.status === 'pending' || r.status === 'missing_recipient',
    );
    if (eligible.length === 0) {
      toast.error('Nothing to reject');
      return;
    }
    const ok = await confirm({
      title: `Reject all ${eligible.length} pending sends?`,
      description: `Vera won't send any of these emails. Each rejection is logged in the audit trail.`,
      confirmLabel: `Reject ${eligible.length}`,
      cancelLabel: 'Keep reviewing',
      destructive: true,
    });
    if (!ok) return;
    setBulkBusy(true);
    const toastId = toast.loading(`Rejecting 0 of ${eligible.length}…`);
    let done = 0;
    let failed = 0;
    for (const row of eligible) {
      try {
        const res = await fetch(
          `/api/automation-rules/pending/${row.id}/reject`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          },
        );
        if (res.ok) done += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
      toast.loading(`Rejecting ${done + failed} of ${eligible.length}…`, {
        id: toastId,
      });
    }
    setBulkBusy(false);
    if (failed === 0) {
      toast.success(`Rejected ${done}`, { id: toastId });
    } else {
      toast.error(`Rejected ${done}, failed ${failed}`, { id: toastId });
    }
    await load();
  }

  const openCount = rows?.length ?? 0;
  const approvableCount = (rows ?? []).filter(
    (r) => r.status === 'pending' && r.proposedRecipient,
  ).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-lg tracking-tight">
          Pending sends{rows ? ` (${openCount})` : ''}
        </h3>
        {rows && rows.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={rejectAll}
              disabled={bulkBusy || busy !== null}
            >
              <X className="mr-1 h-3.5 w-3.5" />
              Reject all
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={approveAll}
              disabled={bulkBusy || busy !== null || approvableCount === 0}
              title={
                approvableCount === 0
                  ? 'Each row needs a recipient override — approve individually'
                  : undefined
              }
            >
              <Check className="mr-1 h-3.5 w-3.5" />
              {bulkBusy
                ? 'Sending…'
                : approvableCount === openCount
                  ? `Approve all (${approvableCount})`
                  : `Approve ${approvableCount} of ${openCount}`}
            </Button>
          </div>
        ) : null}
      </div>

      {rows === null ? (
        <Card>
          <div className="space-y-2">
            <SkeletonText width="w-48" />
            <SkeletonText width="w-64" />
          </div>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <p className="text-text-secondary text-sm">
            No pending sends. Rules are running silently — fires will appear
            here when thresholds cross.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const expanded = expandedId === row.id;
            const isMissing = row.status === 'missing_recipient';
            return (
              <Card key={row.id}>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-text-primary text-sm font-medium">
                        {row.rule.name} fired on{' '}
                        <span className="font-normal">
                          {row.triggerSnapshot.jobSnapshot.customer}
                        </span>
                      </p>
                      <p className="text-text-muted text-xs">
                        {describeTrigger(row.triggerSnapshot)} ·{' '}
                        {isMissing ? (
                          <span className="text-amber-600">
                            <AlertTriangle className="mr-1 inline h-3 w-3" />
                            Needs recipient
                          </span>
                        ) : (
                          <>To: {row.proposedRecipient}</>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setExpandedId(expanded ? null : row.id)
                        }
                      >
                        {expanded ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                        {expanded ? ' Hide' : ' Preview'}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => reject(row)}
                        disabled={busy === row.id || bulkBusy}
                      >
                        <X className="mr-1 h-3.5 w-3.5" />
                        Reject
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => approve(row)}
                        disabled={busy === row.id || bulkBusy}
                      >
                        <Check className="mr-1 h-3.5 w-3.5" />
                        Approve
                      </Button>
                    </div>
                  </div>
                  {isMissing ? (
                    <input
                      type="email"
                      placeholder="Enter recipient email…"
                      value={overrides[row.id] ?? ''}
                      onChange={(e) =>
                        setOverrides((o) => ({ ...o, [row.id]: e.target.value }))
                      }
                      className="border-border focus:border-accent bg-bg-card text-text-primary placeholder:text-text-muted w-full rounded-xl border px-3 py-2 text-sm outline-none"
                    />
                  ) : null}
                  {expanded ? (
                    <div className="border-border bg-bg-base/40 space-y-2 rounded-xl border p-3">
                      <p className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
                        Subject
                      </p>
                      <p className="text-text-primary text-sm">
                        {row.proposedSubject}
                      </p>
                      <p className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
                        Body
                      </p>
                      <pre className="text-text-primary font-sans text-sm leading-relaxed whitespace-pre-wrap">
                        {row.proposedBody}
                      </pre>
                    </div>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function describeTrigger(t: PendingRow['triggerSnapshot']): string {
  const metric =
    t.metric === 'aging_days'
      ? 'aging'
      : t.metric === 'balance'
        ? 'balance'
        : 'heat';
  const value =
    t.metric === 'balance'
      ? new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          maximumFractionDigits: 0,
        }).format(t.metricValueAtFire)
      : t.metric === 'aging_days'
        ? `${t.metricValueAtFire}d`
        : Math.round(t.metricValueAtFire);
  return `${metric} crossed ${t.threshold} → ${value}`;
}
