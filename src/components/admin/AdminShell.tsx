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
import { Separator } from '@/components/ui/separator';
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

type IconType = typeof LayoutDashboard;

type NavEntry = {
  label: string;
  href: string;
  icon: IconType;
  /** Permission scope required to see this entry. `null` = always visible. */
  permission: string | null;
};

const NAV: readonly NavEntry[] = [
  { label: 'Dashboard', href: '/admin', icon: LayoutDashboard, permission: null },
  { label: 'Products', href: '/admin/products', icon: Package, permission: 'catalog:read' },
  { label: 'Categories', href: '/admin/categories', icon: FolderTree, permission: 'catalog:read' },
  { label: 'Attributes', href: '/admin/attributes', icon: Tags, permission: 'catalog:read' },
  { label: 'Inventory', href: '/admin/inventory', icon: Boxes, permission: 'inventory:read' },
  { label: 'Orders', href: '/admin/orders', icon: ShoppingCart, permission: 'orders:read' },
  { label: 'Customers', href: '/admin/customers', icon: Users, permission: 'customers:read' },
  { label: 'Promotions', href: '/admin/promotions', icon: BadgePercent, permission: 'promotions:read' },
  { label: 'CMS', href: '/admin/cms', icon: FileText, permission: 'cms:read' },
  { label: 'Assets', href: '/admin/assets', icon: ImageIcon, permission: 'assets:read' },
  { label: 'Settings', href: '/admin/settings', icon: Settings, permission: 'settings:read' },
  { label: 'Audit Log', href: '/admin/audit', icon: ScrollText, permission: 'audit:read' },
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
    <div className="flex min-h-screen bg-muted/30 text-foreground">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-background lg:flex">
        <SidebarContent storeName={storeName} nav={visible} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          storeName={storeName}
          user={user}
          mobileOpen={mobileOpen}
          onMobileOpenChange={setMobileOpen}
          nav={visible}
        />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}

function SidebarContent({
  storeName,
  nav,
  onNavigate,
}: {
  storeName: string;
  nav: readonly NavEntry[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <>
      <div className="flex h-16 items-center px-5">
        <span className="truncate font-serif text-lg font-semibold text-brand">
          {storeName}
        </span>
      </div>
      <Separator />
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {nav.map(entry => {
          const active =
            entry.href === '/admin'
              ? pathname === '/admin'
              : pathname.startsWith(entry.href);
          const Icon = entry.icon;
          return (
            <Link
              key={entry.href}
              href={entry.href as Parameters<typeof Link>[0]['href']}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {entry.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

function Topbar({
  storeName,
  user,
  mobileOpen,
  onMobileOpenChange,
  nav,
}: {
  storeName: string;
  user: AdminUser;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
  nav: readonly NavEntry[];
}) {
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
    <header className="flex h-16 items-center gap-3 border-b bg-background px-4 lg:px-6">
      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden">
            <Menu className="h-5 w-5" />
            <span className="sr-only">Open menu</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-60 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent
            storeName={storeName}
            nav={nav}
            onNavigate={() => onMobileOpenChange(false)}
          />
        </SheetContent>
      </Sheet>

      <div className="ml-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="flex items-center gap-2 px-2"
              aria-label="User menu"
            >
              <Avatar className="h-7 w-7">
                <AvatarFallback className="text-xs">{initials}</AvatarFallback>
              </Avatar>
              <span className="hidden max-w-[12rem] truncate text-sm sm:inline">
                {user.email}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="truncate">
              {user.email}
            </DropdownMenuLabel>
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
      </div>
    </header>
  );
}
