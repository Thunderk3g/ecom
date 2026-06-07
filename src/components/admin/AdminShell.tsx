'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Package,
  FolderTree,
  Tags,
  Boxes,
  ShoppingCart,
  Users,
  BadgePercent,
  FileText,
  Image as ImageIcon,
  Settings,
  ScrollText,
  LogOut,
  Menu,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type IconType = typeof LayoutDashboard;

type NavEntry = {
  label: string;
  href: string;
  icon: IconType;
  /** Permission scope required to see this entry. `null` = always visible. */
  permission: string | null;
  /** Section header this entry belongs under (Plume `.adm-nav .grp`). */
  group: string;
};

const NAV: readonly NavEntry[] = [
  { label: 'Dashboard', href: '/admin', icon: LayoutDashboard, permission: null, group: 'Overview' },
  { label: 'Products', href: '/admin/products', icon: Package, permission: 'catalog:read', group: 'Catalog' },
  { label: 'Categories', href: '/admin/categories', icon: FolderTree, permission: 'catalog:read', group: 'Catalog' },
  { label: 'Attributes', href: '/admin/attributes', icon: Tags, permission: 'catalog:read', group: 'Catalog' },
  { label: 'Inventory', href: '/admin/inventory', icon: Boxes, permission: 'inventory:read', group: 'Catalog' },
  { label: 'Orders', href: '/admin/orders', icon: ShoppingCart, permission: 'orders:read', group: 'Sales' },
  { label: 'Customers', href: '/admin/customers', icon: Users, permission: 'customers:read', group: 'Sales' },
  { label: 'Promotions', href: '/admin/promotions', icon: BadgePercent, permission: 'promotions:read', group: 'Sales' },
  { label: 'CMS', href: '/admin/cms', icon: FileText, permission: 'cms:read', group: 'Content' },
  { label: 'Assets', href: '/admin/assets', icon: ImageIcon, permission: 'assets:read', group: 'Content' },
  { label: 'Settings', href: '/admin/settings', icon: Settings, permission: 'settings:read', group: 'System' },
  { label: 'Audit Log', href: '/admin/audit', icon: ScrollText, permission: 'audit:read', group: 'System' },
];

export type AdminUser = {
  email: string;
  /** Permission strings granted to this user for the active store. */
  permissions: string[];
};

export type AdminShellProps = {
  storeName: string;
  user: AdminUser;
  children: ReactNode;
};

function hasPermission(permissions: string[], required: string | null): boolean {
  if (required === null) return true;
  if (permissions.includes('*')) return true;
  if (permissions.includes(required)) return true;
  const colon = required.indexOf(':');
  if (colon > 0 && permissions.includes(`${required.slice(0, colon)}:*`)) {
    return true;
  }
  return false;
}

export function AdminShell({ storeName, user, children }: AdminShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const visible = NAV.filter(n => hasPermission(user.permissions, n.permission));

  return (
    <div className="admin-body" style={{ minHeight: '100vh' }}>
      {/* Desktop fixed sidebar */}
      <aside className="adm-side hide-sm" aria-label="Admin navigation">
        <SidebarContent storeName={storeName} user={user} nav={visible} />
      </aside>

      <div className="adm-main">
        <header className="adm-top">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Open menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[248px] border-0 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <div className="adm-side" style={{ position: 'static', width: '100%', height: '100%' }}>
                <SidebarContent
                  storeName={storeName}
                  user={user}
                  nav={visible}
                  onNavigate={() => setMobileOpen(false)}
                />
              </div>
            </SheetContent>
          </Sheet>

          <div className="crumbs hide-sm">
            <span className="t-strong" style={{ fontWeight: 600 }}>{storeName}</span>
            <span className="sep">/</span>
            <span>Admin</span>
          </div>

          <div style={{ marginLeft: 'auto' }}>
            <UserMenu user={user} />
          </div>
        </header>

        <div className="adm-content">{children}</div>
      </div>
    </div>
  );
}

function SidebarContent({
  storeName,
  user,
  nav,
  onNavigate,
}: {
  storeName: string;
  user: AdminUser;
  nav: readonly NavEntry[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const initials = storeName.slice(0, 1).toUpperCase();

  // Preserve NAV order while emitting a group header the first time each
  // section appears.
  const seen = new Set<string>();

  return (
    <>
      <div className="adm-brand">
        <span className="logo">Plume</span>
        <span className="pill">Admin</span>
      </div>

      <div className="adm-store">
        <span className="av">{initials}</span>
        <div style={{ minWidth: 0 }}>
          <div className="nm" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {storeName}
          </div>
          <div className="sub">Operations desk</div>
        </div>
      </div>

      <nav className="adm-nav">
        {nav.map(entry => {
          const Icon = entry.icon;
          const active =
            entry.href === '/admin'
              ? pathname === '/admin'
              : pathname.startsWith(entry.href);
          const showGroup = !seen.has(entry.group);
          if (showGroup) seen.add(entry.group);
          return (
            <div key={entry.href}>
              {showGroup ? <div className="grp">{entry.group}</div> : null}
              <Link
                href={entry.href as Parameters<typeof Link>[0]['href']}
                onClick={onNavigate}
                className={cn(active && 'on')}
              >
                <Icon className="ai" />
                <span>{entry.label}</span>
              </Link>
            </div>
          );
        })}
      </nav>

      <div className="adm-user">
        <span className="av">{user.email.slice(0, 2).toUpperCase()}</span>
        <div style={{ minWidth: 0 }}>
          <div className="nm" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {user.email}
          </div>
          <div className="role">Signed in</div>
        </div>
      </div>
    </>
  );
}

function UserMenu({ user }: { user: AdminUser }) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST' });
      router.push('/admin/login' as Parameters<typeof router.push>[0]);
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  const initials = user.email.slice(0, 2).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="cellrow" style={{ background: 'none', border: 0, cursor: 'pointer' }} aria-label="User menu">
          <span className="av">{initials}</span>
          <span className="t-sub hide-sm" style={{ maxWidth: '12rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user.email}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={e => {
            e.preventDefault();
            void logout();
          }}
          disabled={loggingOut}
        >
          <LogOut className="h-4 w-4" />
          {loggingOut ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
