import type { Metadata } from 'next';
import { getWriteOffs } from '@/lib/write-offs-data';
import { WriteOffsView } from './WriteOffsView';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Write-offs' };

export default function WriteOffsPage() {
  const file = getWriteOffs();
  return <WriteOffsView file={file} />;
}
