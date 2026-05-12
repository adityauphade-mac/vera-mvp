'use client';

/**
 * Custom filled toast icons. Each state uses a DIFFERENT shape so users
 * tell them apart by silhouette, not just color:
 *
 *   success  →  circle           (sage)
 *   error    →  octagon          (heat-critical brick)
 *   warning  →  triangle         (heat-warm mustard)
 *   info     →  rounded square   (--color-info slate blue) ← distinct from circle
 *   loading  →  circle w/ arc    (accent — animates)
 *
 * Colors come from currentColor; sonner's CSS rules in globals.css set
 * `color` on `[data-icon]` per `[data-type]`. All icons share viewBox 0 0 20 20
 * and the same h-5 w-5 footprint so they line up vertically.
 *
 * Why filled instead of lucide's outline icons: filled icons read better at
 * 20px in a corner toast — the colored mass anchors the message, and the
 * white symbol on top stays legible against busy backgrounds.
 */

const ICON_CLASS = 'h-5 w-5 shrink-0';

export function ToastSuccessIcon() {
  return (
    <svg viewBox="0 0 20 20" className={ICON_CLASS} aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="currentColor" />
      <path
        d="m6 10.5 2.7 2.7L14 7.6"
        stroke="white"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ToastErrorIcon() {
  return (
    <svg viewBox="0 0 20 20" className={ICON_CLASS} aria-hidden="true">
      <path
        d="M6.5 1.5h7L18.5 6.5v7L13.5 18.5h-7L1.5 13.5v-7z"
        fill="currentColor"
      />
      <path
        d="m7 7 6 6m0-6-6 6"
        stroke="white"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ToastWarningIcon() {
  return (
    <svg viewBox="0 0 20 20" className={ICON_CLASS} aria-hidden="true">
      <path
        d="M9.13 2.5a1 1 0 0 1 1.74 0l7.5 13a1 1 0 0 1-.87 1.5h-15a1 1 0 0 1-.87-1.5z"
        fill="currentColor"
      />
      <path
        d="M10 7v4"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="10" cy="14" r="1" fill="white" />
    </svg>
  );
}

export function ToastInfoIcon() {
  return (
    <svg viewBox="0 0 20 20" className={ICON_CLASS} aria-hidden="true">
      <rect x="1.5" y="1.5" width="17" height="17" rx="4" fill="currentColor" />
      <circle cx="10" cy="6" r="1" fill="white" />
      <path
        d="M10 9v5.5"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ToastLoadingIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className={`${ICON_CLASS} animate-spin`}
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="8.5" fill="currentColor" fillOpacity="0.18" />
      <path
        d="M18.5 10a8.5 8.5 0 0 0-8.5-8.5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
