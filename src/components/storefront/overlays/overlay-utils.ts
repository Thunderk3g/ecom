'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Shared behaviour for modal-ish overlays (cart drawer, search overlay,
 * mobile menu): body scroll lock, Escape-to-close, Tab focus trap, initial
 * focus, and focus return to the invoking element on close.
 *
 * The overlay panel stays mounted (CSS class transitions handle enter/exit);
 * pair this hook with `inert={!open}` on the panel so hidden content is
 * unreachable by keyboard and assistive tech.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

// Counter-based body scroll lock so stacked overlays don't fight each other.
let scrollLocks = 0;
let savedOverflow = '';
let savedPaddingRight = '';

function lockBodyScroll(): void {
  scrollLocks += 1;
  if (scrollLocks > 1) return;
  const scrollbar = window.innerWidth - document.documentElement.clientWidth;
  savedOverflow = document.body.style.overflow;
  savedPaddingRight = document.body.style.paddingRight;
  document.body.style.overflow = 'hidden';
  if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;
}

function unlockBodyScroll(): void {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks > 0) return;
  document.body.style.overflow = savedOverflow;
  document.body.style.paddingRight = savedPaddingRight;
}

function isVisible(el: HTMLElement): boolean {
  return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
}

export type UseOverlayOptions = {
  /** Whether the overlay is currently open. */
  open: boolean;
  /** Called when the user presses Escape. */
  onClose: () => void;
  /** Ref to the overlay panel element (the focus-trap boundary). */
  panelRef: RefObject<HTMLElement | null>;
  /**
   * Element to focus when the overlay opens. Falls back to the first
   * `[data-autofocus]` inside the panel, then the first focusable element,
   * then the panel itself.
   */
  initialFocusRef?: RefObject<HTMLElement | null>;
};

export function useOverlay({ open, onClose, panelRef, initialFocusRef }: UseOverlayOptions): void {
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    lockBodyScroll();

    // Focus after the open transition has started so focus() doesn't scroll a
    // mid-animation panel.
    const focusTimer = window.setTimeout(() => {
      const target =
        initialFocusRef?.current ??
        panel.querySelector<HTMLElement>('[data-autofocus]') ??
        panel.querySelector<HTMLElement>(FOCUSABLE) ??
        panel;
      target.focus({ preventScroll: true });
    }, 30);

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible);
      if (nodes.length === 0) {
        e.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && panel.contains(active);
      if (e.shiftKey) {
        if (!inside || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown, true);
      unlockBodyScroll();
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [open, onClose, panelRef, initialFocusRef]);
}

/**
 * Client-side minor-unit money formatter for overlay UI. Mirrors the approach
 * used by the cart page: format from the cart's own currency code (the client
 * has no `site_config` access; server surfaces should keep using
 * `src/app/(storefront)/_lib/money.ts`).
 */
export function formatMinor(cents: number, currency: string | undefined): string {
  const value = cents / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency ?? 'INR',
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value);
  } catch {
    return value.toFixed(2);
  }
}
