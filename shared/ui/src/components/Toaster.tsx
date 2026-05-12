'use client';

import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner';
import {
  ToastErrorIcon,
  ToastInfoIcon,
  ToastLoadingIcon,
  ToastSuccessIcon,
  ToastWarningIcon,
} from './ToastIcons';

/**
 * App-wide toast surface. Mount once at the app root. All transient
 * success / error / loading notifications flow through `toast()` from here.
 *
 * Theming lives in `apps/web/app/globals.css` under the
 * `[data-sonner-toaster]` block — CSS variables map sonner's internal slots
 * (--normal-bg, --success-border, etc.) to Vera's design tokens. The
 * font-display serif is applied to titles; descriptions use the sans body
 * stack. See CLAUDE.md hard rule #11.
 *
 * Icons are custom filled SVG (see ToastIcons.tsx). Each toast state uses
 * a distinct silhouette so the user reads info vs error at a glance, not
 * by color alone:
 *   • success → filled circle (sage)
 *   • error → filled octagon (heat-critical brick)
 *   • warning → filled triangle (heat-warm mustard)
 *   • info → filled rounded square (slate blue — --color-info)
 *   • loading → filled circle with rotating arc (accent)
 *
 * `richColors` is intentionally OFF: we don't want sonner's stock green /
 * red — they don't match the warm cream palette. The CSS overrides supply
 * a Vera-on-brand alternative.
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      closeButton
      duration={4500}
      gap={10}
      offset={20}
      visibleToasts={4}
      icons={{
        loading: <ToastLoadingIcon />,
        success: <ToastSuccessIcon />,
        error: <ToastErrorIcon />,
        info: <ToastInfoIcon />,
        warning: <ToastWarningIcon />,
      }}
    />
  );
}

/** Re-exported from sonner for one consistent import surface across the app. */
export const toast: typeof sonnerToast = sonnerToast;
