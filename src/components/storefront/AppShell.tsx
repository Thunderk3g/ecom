import Link from 'next/link';
import type { ReactNode } from 'react';
import { ShoppingBag, Search, User } from 'lucide-react';

import type { SiteConfig } from '@/platform.defaults';
import type { NavItem } from '@/modules/cms/navigation';

/**
 * Storefront chrome — Plume design system.
 *
 * Server component. The storefront route-group layout resolves the tenant,
 * loads `site_config` and the header/footer nav menus, and passes them in.
 * Visual styling comes from the vendored Plume CSS (src/styles/plume/*),
 * consumed via its semantic classes (`.site-header`, `.logo`, `.mainnav`,
 * `.site-footer`); brand colours/fonts still resolve from the per-tenant CSS
 * vars injected at SSR by the root layout.
 */
export type AppShellProps = {
  config: SiteConfig;
  headerNav: NavItem[];
  footerNav: NavItem[];
  children: ReactNode;
};

export function AppShell({
  config,
  headerNav,
  footerNav,
  children,
}: AppShellProps) {
  const brandName = config.brand.name;
  const tagline = config.brand.tagline;

  return (
    <div className="stack" style={{ minHeight: '100vh' }}>
      <div className="topbar">
        <div className="wrap-wide">
          <span>Complimentary shipping over ₹999 · Hand-finished in small batches</span>
        </div>
      </div>

      <header className="site-header">
        <div className="wrap-wide">
          <div className="hdr-main">
            <form action="/search" className="search hide-sm" style={{ maxWidth: 280 }}>
              <Search aria-hidden />
              <input type="search" name="q" placeholder="Search the catalogue…" aria-label="Search" />
            </form>

            <Link href="/" className="logo">
              {brandName}
              {tagline ? <span className="sub">{tagline}</span> : null}
            </Link>

            <div className="hdr-icons">
              <Link href="/account" className="icon-btn" aria-label="Account">
                <User aria-hidden />
              </Link>
              <Link href="/cart" className="icon-btn" aria-label="Cart">
                <ShoppingBag aria-hidden />
                <span className="cart-count">0</span>
              </Link>
            </div>
          </div>

          {headerNav.length > 0 ? (
            <nav className="mainnav">
              {headerNav.map((item, i) => (
                <NavLink key={`${item.label}-${i}`} item={item} />
              ))}
            </nav>
          ) : null}
        </div>
      </header>

      <main className="grow">{children}</main>

      <footer className="site-footer">
        <div className="wrap-wide">
          <div className="foot-grid">
            <div>
              <div className="foot-logo">{brandName}</div>
              {tagline ? (
                <p className="meta" style={{ marginTop: 14, maxWidth: '34ch', color: 'rgba(255,255,255,.6)' }}>
                  {tagline}
                </p>
              ) : null}
              <form className="news" onSubmit={undefined}>
                <input type="email" name="email" placeholder="Your email" aria-label="Email" />
                <button type="submit">Join</button>
              </form>
            </div>
            {footerNav.map((item, i) => (
              <FooterColumn key={`${item.label}-${i}`} item={item} />
            ))}
          </div>
          <div className="foot-bot">
            <span>&copy; {new Date().getFullYear()} {brandName}. All rights reserved.</span>
            <span>Made with care · Paper goods, properly.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function NavLink({ item }: { item: NavItem }) {
  if (!item.href) {
    return <span className="muted">{item.label}</span>;
  }
  return (
    <Link href={item.href as Parameters<typeof Link>[0]['href']}>{item.label}</Link>
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
