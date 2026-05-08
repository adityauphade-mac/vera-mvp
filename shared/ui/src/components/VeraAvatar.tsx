'use client';

import { useState } from 'react';
import { cn } from '../lib/cn';

type Size = 'xs' | 'sm' | 'md' | 'lg';

const SIZE_PX: Record<Size, number> = { xs: 20, sm: 28, md: 40, lg: 56 };

const ASSET_URL = '/vera-avatar.png';

export function VeraAvatar({
  size = 'md',
  className,
  src = ASSET_URL,
  ring = false,
}: {
  size?: Size;
  className?: string;
  src?: string;
  ring?: boolean;
}) {
  const [errored, setErrored] = useState(false);
  const px = SIZE_PX[size];

  if (errored || !src) {
    return <VeraAvatarFallback px={px} className={className} ring={ring} />;
  }

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full',
        ring && 'ring-bg-card ring-2',
        className,
      )}
      style={{ width: px, height: px }}
      role="img"
      aria-label="Vera"
    >
      <img
        src={src}
        alt=""
        width={px}
        height={px}
        onError={() => setErrored(true)}
        className="h-full w-full object-cover vera-avatar-idle"
      />
    </span>
  );
}

function VeraAvatarFallback({
  px,
  className,
  ring,
}: {
  px: number;
  className?: string;
  ring?: boolean;
}) {
  return (
    <span
      className={cn(
        'from-accent/90 to-accent font-display inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]',
        ring && 'ring-bg-card ring-2',
        className,
      )}
      style={{ width: px, height: px, fontSize: Math.round(px * 0.46), lineHeight: 1 }}
      role="img"
      aria-label="Vera"
    >
      V
    </span>
  );
}
