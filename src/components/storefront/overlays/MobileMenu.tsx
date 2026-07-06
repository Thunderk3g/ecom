'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { ChevronDown, Menu, ShoppingBag, User, X } from 'lucide-react';
import type { NavItem } from '@/modules/cms/navigation';
import { useChrome } from './chrome-context';
import { useOverlay } from './overlay-utils';

/**
 * Hamburger trigger for the mobile menu. Hidden ≥ 880px via the
 * `.mnav-trigger` class in chrome.css (where the desktop `.mainnav` hides).
 */
export function MobileMenuTrigger() {
  const { mobileOpen, openMobileMenu } = useChrome();
  return (
    <button
      type="button"
      className="icon-btn mnav-trigger"
      onClick={openMobileMenu}
      aria-haspopup="dialog"
      aria-expanded={mobileOpen}
      aria-controls="mobile-menu"
    >
      <Menu aria-hidden />
      <span className="sr-only">Menu</span>
    </button>
  );
}

/**
 * Mobile navigation drawer (left slide-over). Nav items with `children`
 * expand as accordions (grid-rows animation); leaf items are plain links.
 * Account and Cart links sit pinned at the bottom; list items enter with a
 * small stagger. Focus trap / Escape / scroll lock via `useOverlay`.
 */
export function MobileMenu({ items }: { items: NavItem[] }) {
  const { mobileOpen, closeMobileMenu } = useChrome();
  const panelRef = useRef<HTMLElement | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  useOverlay({ open: mobileOpen, onClose: closeMobileMenu, panelRef });

  // Collapse any open accordion when the drawer closes.
  useEffect(() => {
    if (!mobileOpen) setExpanded(null);
  }, [mobileOpen]);

  return (
    <>
      <div
        className={mobileOpen ? 'overlay-scrim open' : 'overlay-scrim'}
        onClick={closeMobileMenu}
        aria-hidden="true"
      />
      <aside
        id="mobile-menu"
        ref={panelRef}
        className={mobileOpen ? 'mnav-drawer open' : 'mnav-drawer'}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        inert={!mobileOpen}
      >
        <div className="mnav-head">
          <span className="eyebrow">Menu</span>
          <button type="button" className="icon-btn" onClick={closeMobileMenu}>
            <X aria-hidden />
            <span className="sr-only">Close menu</span>
          </button>
        </div>

        <nav className="mnav-list" aria-label="Mobile">
          {items.map((item, i) => (
            <div key={`${item.label}-${i}`} style={{ '--i': i } as CSSProperties}>
              {item.children && item.children.length > 0 ? (
                <MobileAccordion
                  item={item}
                  open={expanded === i}
                  onToggle={() => setExpanded(cur => (cur === i ? null : i))}
                  onNavigate={closeMobileMenu}
                />
              ) : item.href ? (
                <Link
                  className="mnav-link"
                  href={item.href as Parameters<typeof Link>[0]['href']}
                  onClick={closeMobileMenu}
                >
                  {item.label}
                </Link>
              ) : (
                <span className="mnav-link muted">{item.label}</span>
              )}
            </div>
          ))}
        </nav>

        <div className="mnav-foot">
          <Link href="/account" onClick={closeMobileMenu}>
            <User aria-hidden /> Account
          </Link>
          <Link href="/cart" onClick={closeMobileMenu}>
            <ShoppingBag aria-hidden /> Cart
          </Link>
        </div>
      </aside>
    </>
  );
}

function MobileAccordion({
  item,
  open,
  onToggle,
  onNavigate,
}: {
  item: NavItem;
  open: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  const bodyId = useId();
  return (
    <>
      <button
        type="button"
        className="mnav-acc-trigger"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        {item.label}
        <ChevronDown aria-hidden />
      </button>
      <div id={bodyId} className={open ? 'mnav-acc-body open' : 'mnav-acc-body'}>
        <div>
          <div className="mnav-sub" inert={!open}>
            {item.children?.map((child, i) =>
              child.href ? (
                <Link
                  key={`${child.label}-${i}`}
                  href={child.href as Parameters<typeof Link>[0]['href']}
                  onClick={onNavigate}
                >
                  {child.label}
                </Link>
              ) : (
                <span key={`${child.label}-${i}`} className="muted">
                  {child.label}
                </span>
              ),
            )}
            {item.href ? (
              <Link
                className="mnav-viewall"
                href={item.href as Parameters<typeof Link>[0]['href']}
                onClick={onNavigate}
              >
                View all {item.label} →
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
