import Link from 'next/link';
import type { ReactNode } from 'react';
import { ShoppingBag, Search, User } from 'lucide-react';

import type { SiteConfig } from '@/platform.defaults';
import type { NavItem } from '@/modules/cms/navigation';
import { Separator } from '@/components/ui/separator';

/**
 * Storefront chrome: themeable header + footer wrapping page content.
 *
 * Server component. The storefront route-group layout resolves the tenant,
 * loads `site_config` and the header/footer nav menus, and passes them in.
 * Brand colors and fonts come from the per-tenant CSS vars injected at SSR by
 * the root layout (see globals.css), so this shell only consumes semantic
 * Tailwind tokens (`bg-background`, `text-foreground`, `bg-brand`, `font-serif`).
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
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center gap-6">
          <Link
            href="/"
            className="font-serif text-xl font-semibold tracking-tight text-brand"
          >
            {brandName}
          </Link>

          <nav className="hidden items-center gap-5 text-sm md:flex">
            {headerNav.map((item, i) => (
              <NavLink key={`${item.label}-${i}`} item={item} />
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <form action="/search" className="hidden md:block">
              <label className="relative block">
                <span className="sr-only">Search</span>
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  name="q"
                  placeholder="Search products…"
                  className="h-9 w-56 rounded-md border border-input bg-transparent pl-8 pr-3 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </label>
            </form>

            <Link
              href="/account"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
              aria-label="Account"
            >
              <User className="h-5 w-5" />
            </Link>
            <Link
              href="/cart"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
              aria-label="Cart"
            >
              <ShoppingBag className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t bg-background">
        <div className="container py-10">
          <div className="flex flex-col gap-8 md:flex-row md:justify-between">
            <div className="max-w-xs">
              <div className="font-serif text-lg font-semibold text-brand">
                {brandName}
              </div>
              {tagline ? (
                <p className="mt-2 text-sm text-muted-foreground">{tagline}</p>
              ) : null}
            </div>
            {footerNav.length > 0 ? (
              <nav className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm sm:grid-cols-3">
                {footerNav.map((item, i) => (
                  <FooterColumn key={`${item.label}-${i}`} item={item} />
                ))}
              </nav>
            ) : null}
          </div>
          <Separator className="my-6" />
          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} {brandName}. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}

function NavLink({ item }: { item: NavItem }) {
  if (!item.href) {
    return <span className="text-muted-foreground">{item.label}</span>;
  }
  return (
    <Link
      href={item.href as Parameters<typeof Link>[0]['href']}
      className="text-foreground/80 transition-colors hover:text-foreground"
    >
      {item.label}
    </Link>
  );
}

function FooterColumn({ item }: { item: NavItem }) {
  return (
    <div className="flex flex-col gap-2">
      {item.href ? (
        <Link
          href={item.href as Parameters<typeof Link>[0]['href']}
          className="font-medium text-foreground hover:underline"
        >
          {item.label}
        </Link>
      ) : (
        <span className="font-medium text-foreground">{item.label}</span>
      )}
      {item.children?.map((child, i) => (
        <NavLink key={`${child.label}-${i}`} item={child} />
      ))}
    </div>
  );
}
