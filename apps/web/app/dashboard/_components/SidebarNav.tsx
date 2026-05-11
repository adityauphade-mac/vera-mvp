'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  ClipboardCheck,
  GaugeCircle,
  History,
  Home,
  ListChecks,
  LogOut,
  Trophy,
} from 'lucide-react';
import { signOutAction } from '../../_actions/auth';

const NAV = [
  { href: '/dashboard', label: 'Today', icon: Home, exact: true },
  { href: '/dashboard/aging', label: 'Aging & anomalies', icon: AlertTriangle },
  { href: '/dashboard/milestones', label: 'Milestones', icon: ListChecks },
  { href: '/dashboard/follow-ups', label: 'Follow-ups', icon: GaugeCircle },
  { href: '/dashboard/rep-leaderboard', label: 'Rep leaderboard', icon: Trophy },
  { href: '/dashboard/reconciliation', label: 'Reconciliation', icon: ClipboardCheck },
  { href: '/dashboard/scheduler', label: 'Scheduler', icon: CalendarClock },
  { href: '/dashboard/audit-logs', label: 'Audit log', icon: History },
];

export function SidebarNav() {
  const pathname = usePathname() ?? '';
  return (
    <nav className="flex flex-1 flex-col gap-1 px-3 py-6">
      {NAV.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + '/');
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={
              active
                ? 'bg-bg-base text-text-primary border-accent flex items-center gap-3 rounded-lg border-l-2 px-3 py-2 text-sm font-medium'
                : 'text-text-secondary hover:bg-bg-base hover:text-text-primary flex items-center gap-3 rounded-lg border-l-2 border-transparent px-3 py-2 text-sm transition-colors'
            }
          >
            <Icon className={`h-4 w-4 ${active ? 'text-accent' : ''}`} />
            {label}
          </Link>
        );
      })}

      <div className="border-border mt-auto space-y-1 border-t pt-4">
        <Link
          href="/docs"
          className="text-text-secondary hover:bg-bg-base hover:text-text-primary flex items-center gap-3 rounded-lg border-l-2 border-transparent px-3 py-2 text-sm transition-colors"
        >
          <BookOpen className="h-4 w-4" />
          How I work
        </Link>
        <form action={signOutAction}>
          <button
            type="submit"
            className="text-text-secondary hover:bg-bg-base hover:text-text-primary flex w-full items-center gap-3 rounded-lg border-l-2 border-transparent px-3 py-2 text-sm transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </form>
      </div>
    </nav>
  );
}
