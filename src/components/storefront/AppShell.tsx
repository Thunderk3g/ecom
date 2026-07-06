import Link from 'next/link';
import type { ReactNode } from 'react';
import { User } from 'lucide-react';

import type { SiteConfig } from '@/platform.defaults';
import type { NavItem } from '@/modules/cms/navigation';
import { Marquee } from '@/components/storefront/motion';
import {
  ChromeProvider,
  StickyHeader,
  MegaNav,
  CartButton,
  SearchTrigger,
  CartDrawer,
  SearchOverlay,
  MobileMenu,
  MobileMenuTrigger,
  Toaster,
  NewsletterForm,
} from '@/components/storefront/overlays';

/**
 * Storefront chrome — Plume design system.
 *
 * Server component. The storefront route-group layout resolves the tenant,
 * loads `site_config` and the header/footer nav menus, and passes them in.
 * Interactive pieces (sticky header, mega-menu, cart drawer, search overlay,
 * mobile menu, toasts, newsletter form) are client islands from
 * `./overlays/*`, composed here around server-rendered markup. Visual styling
 * comes from the vendored Plume CSS (src/styles/plume/*) extended by
 * src/styles/chrome.css and src/styles/motion.css.
 */
export type AppShellProps = {
  config: SiteConfig;
  headerNav: NavItem[];
  footerNav: NavItem[];
  children: ReactNode;
};

const ANNOUNCEMENTS = [
  'Free shipping on orders over ₹999',
  'School-season stock is in — notebooks, geometry sets & more',
  'New in: cricket, badminton & fitness gear',
  'Same-week dispatch across India',
];

export function AppShell({
  config,
  headerNav,
  footerNav,
  children,
}: AppShellProps) {
  const brandName = config.brand.name;
  const tagline = config.brand.tagline;

  return (
    <ChromeProvider>
      <div className="stack" style={{ minHeight: '100vh' }}>
        <div className="topbar annbar">
          <Marquee speed={45} aria-label="Store announcements">
            {ANNOUNCEMENTS.map(message => (
              <span className="annbar-item" key={message}>
                {message}
                <span className="annbar-sep" aria-hidden="true">
                  ✦
                </span>
              </span>
            ))}
          </Marquee>
        </div>

        <StickyHeader>
          <div className="wrap-wide">
            <div className="hdr-main">
              <div className="hdr-left">
                <MobileMenuTrigger />
                <SearchTrigger className="hide-sm" />
              </div>

              <Link href="/" className="logo">
                {brandName}
                {tagline ? <span className="sub">{tagline}</span> : null}
              </Link>

              <div className="hdr-icons">
                <SearchTrigger variant="icon" className="so-icon-mobile" />
                <Link href="/account" className="icon-btn" aria-label="Account">
                  <User aria-hidden />
                </Link>
                <CartButton />
              </div>
            </div>

            <MegaNav items={headerNav} />
          </div>
        </StickyHeader>

        <main className="grow">{children}</main>

        <footer className="site-footer">
          <div className="foot-watermark" aria-hidden="true">
            {brandName}
          </div>
          <div className="wrap-wide">
            <div className="foot-grid">
              <div>
                <div className="foot-logo">{brandName}</div>
                {tagline ? (
                  <p
                    className="meta"
                    style={{ marginTop: 14, maxWidth: '34ch', color: 'rgba(255,255,255,.6)' }}
                  >
                    {tagline}
                  </p>
                ) : null}
                <NewsletterForm />
              </div>
              {footerNav.map((item, i) => (
                <FooterColumn key={`${item.label}-${i}`} item={item} />
              ))}
            </div>
            <div className="foot-bot">
              <span>
                &copy; {new Date().getFullYear()} {brandName}. All rights reserved.
              </span>
              <span>Made with care · Pens to pavilions.</span>
            </div>
          </div>
        </footer>

        <CartDrawer />
        <SearchOverlay />
        <MobileMenu items={headerNav} />
        <Toaster />
      </div>
    </ChromeProvider>
  );
}

function FooterColumn({ item }: { item: NavItem }) {
  return (
    <div>
      <h5>{item.label}</h5>
      <div className="foot-links">
        {item.children?.map((child, i) =>
          child.href ? (
            <Link
              key={`${child.label}-${i}`}
              href={child.href as Parameters<typeof Link>[0]['href']}
            >
              {child.label}
            </Link>
          ) : (
            <span key={`${child.label}-${i}`}>{child.label}</span>
          ),
        )}
      </div>
    </div>
  );
}
