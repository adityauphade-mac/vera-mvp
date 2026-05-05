import Link from 'next/link';
import { MessageCircle } from 'lucide-react';
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
        <Link href="/" className="border-border block border-b px-6 py-6">
          <p className="text-text-muted text-[0.65rem] tracking-[0.25em] uppercase">
            Vera Calloway
          </p>
          <p className="font-display mt-1 text-2xl tracking-tight">AR Studio</p>
        </Link>
        <SidebarNav />
        <div className="border-border border-t px-6 py-5">
          <p className="text-text-muted flex items-center gap-2 text-xs">
            <MessageCircle className="h-3 w-3" />
            <span>Chat opens bottom-right →</span>
          </p>
        </div>
      </aside>

      {/* Main content area, offset by sidebar width on md+ */}
      <div className="md:ml-60">
        <header className="border-border bg-bg-base/85 sticky top-0 z-10 flex items-center justify-between border-b px-8 py-5 backdrop-blur">
          <div>
            <p className="text-text-muted text-[0.65rem] tracking-[0.2em] uppercase">
              Briefing for
            </p>
            <p className="font-display text-xl tracking-tight">{asOfDate}</p>
          </div>
          <div className="text-text-secondary text-sm italic">
            Vera is watching · 130 jobs in AR
          </div>
        </header>
        <main className="px-8 py-10">{children}</main>
      </div>
      <ChatPanel />
    </div>
  );
}
