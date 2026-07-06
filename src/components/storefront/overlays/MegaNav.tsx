'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import type { NavItem } from '@/modules/cms/navigation';

/**
 * Primary header navigation with accessible per-item dropdown panels.
 *
 * - Leaf items (`href`, no `children`) render as plain links inside Plume's
 *   `.mainnav`.
 * - Items with `children` render a `.mm-trigger` button + anchored `.mm-panel`
 *   card (column of child links, plus a highlighted "View all" link when the
 *   parent itself has an `href`).
 * - Opens on mouse hover (with intent delays) AND on click/Enter (touch &
 *   keyboard); closes on Escape (focus returns to the trigger), on outside
 *   click, and when focus leaves the item. `aria-expanded`/`aria-controls`
 *   are wired on every trigger; the closed panel is `inert`.
 */
export function MegaNav({ items }: { items: NavItem[] }) {
  const navRef = useRef<HTMLElement | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  // Outside pointer-down closes any open panel.
  useEffect(() => {
    if (openIndex === null) return;
    const onPointerDown = (e: PointerEvent): void => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenIndex(null);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [openIndex]);

  if (items.length === 0) return null;

  return (
    <nav className="mainnav" aria-label="Primary" ref={navRef}>
      {items.map((item, i) =>
        item.children && item.children.length > 0 ? (
          <MegaItem
            key={`${item.label}-${i}`}
            item={item}
            open={openIndex === i}
            onOpen={() => setOpenIndex(i)}
            onClose={() => setOpenIndex(cur => (cur === i ? null : cur))}
          />
        ) : (
          <LeafLink key={`${item.label}-${i}`} item={item} />
        ),
      )}
    </nav>
  );
}

function LeafLink({ item }: { item: NavItem }): ReactNode {
  if (!item.href) return <span className="muted">{item.label}</span>;
  return <Link href={item.href as Parameters<typeof Link>[0]['href']}>{item.label}</Link>;
}

function MegaItem({
  item,
  open,
  onOpen,
  onClose,
}: {
  item: NavItem;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const hoverTimer = useRef<number | null>(null);

  const clearHoverTimer = (): void => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };

  useEffect(() => clearHoverTimer, []);

  const scheduleOpen = (): void => {
    clearHoverTimer();
    hoverTimer.current = window.setTimeout(onOpen, 50);
  };
  const scheduleClose = (): void => {
    clearHoverTimer();
    hoverTimer.current = window.setTimeout(onClose, 140);
  };

  return (
    <div
      className={open ? 'mm-item open' : 'mm-item'}
      onPointerEnter={e => {
        if (e.pointerType === 'mouse') scheduleOpen();
      }}
      onPointerLeave={e => {
        if (e.pointerType === 'mouse') scheduleClose();
      }}
      onKeyDown={e => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          onClose();
          triggerRef.current?.focus();
        }
      }}
      onBlur={e => {
        // Close when keyboard focus leaves the item entirely.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onClose();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="mm-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? onClose() : onOpen())}
      >
        {item.label}
        <ChevronDown className="mm-chevron" aria-hidden />
      </button>

      <div id={panelId} className="mm-panel" aria-label={item.label} inert={!open}>
        <ul className="mm-list">
          {item.children?.map((child, i) =>
            child.href ? (
              <li key={`${child.label}-${i}`}>
                <Link href={child.href as Parameters<typeof Link>[0]['href']} onClick={onClose}>
                  {child.label}
                </Link>
              </li>
            ) : (
              <li key={`${child.label}-${i}`}>
                <span className="muted" style={{ display: 'block', padding: '9px 12px' }}>
                  {child.label}
                </span>
              </li>
            ),
          )}
        </ul>
        {item.href ? (
          <Link
            className="mm-viewall"
            href={item.href as Parameters<typeof Link>[0]['href']}
            onClick={onClose}
          >
            View all {item.label} →
          </Link>
        ) : null}
      </div>
    </div>
  );
}
