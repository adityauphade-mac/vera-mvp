import Link from 'next/link';
import { VeraAvatar } from '@vera/ui';
import { getData } from '@/lib/data';
import { ChatPanel } from './_components/ChatPanel';
import { SidebarNav } from './_components/SidebarNav';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { asOf } = getData();
  const asOfDate = new Date(asOf).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="bg-bg-base min-h-screen">
      {/* Fixed sidebar */}
      <aside className="border-border bg-bg-card fixed top-0 left-0 z-20 hidden h-screen w-60 flex-col border-r md:flex">
        <Link
          href="/"
          className="border-border flex h-[84px] items-center gap-3 border-b px-6"
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
        <SidebarNav />
      </aside>

      {/* Main content */}
      <div className="md:ml-60">
        <header className="border-border bg-bg-base/85 sticky top-0 z-10 flex h-[84px] items-center border-b px-8 backdrop-blur">
          <div>
            <p className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
              Briefing for
            </p>
            <p className="font-display text-xl tracking-tight leading-none mt-1">
              {asOfDate}
            </p>
          </div>
        </header>
        <main className="px-8 pt-10 pb-32">{children}</main>
      </div>
      <ChatPanel />
    </div>
  );
}
