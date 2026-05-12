import type { Metadata } from 'next';
import { Fraunces, Inter } from 'next/font/google';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { ConfirmProvider, Toaster } from '@vera/ui';
import './globals.css';

const fraunces = Fraunces({
  variable: '--font-display',
  subsets: ['latin'],
  axes: ['opsz', 'SOFT'],
});

const inter = Inter({
  variable: '--font-sans',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Vera — AR Intelligence',
  description: 'Vera Calloway, your Lead AR Intelligence Specialist.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable} h-full antialiased`}>
      <body className="bg-bg-base text-text-primary min-h-full font-sans">
        <NuqsAdapter>
          <ConfirmProvider>{children}</ConfirmProvider>
        </NuqsAdapter>
        <Toaster />
      </body>
    </html>
  );
}
