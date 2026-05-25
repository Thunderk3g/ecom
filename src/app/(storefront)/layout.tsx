import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { resolveTenant } from '@/modules/tenant/resolve';
import { loadSiteConfig } from '@/modules/config/loader';
import { platformDefaults } from '@/platform.defaults';
import { getMenu, validateNavItems, type NavItem } from '@/modules/cms/navigation';
import { AppShell } from '@/components/storefront/AppShell';
import { CartProvider } from '@/components/storefront/cart-context';

/**
 * Storefront route-group layout. Resolves the tenant, loads its site_config and
 * header/footer navigation, and wraps all storefront pages in <AppShell />.
 *
 * Nav items are stored as `unknown[]` (jsonb) and validated/normalised here via
 * the CMS `validateNavItems` helper; malformed menus degrade to an empty list
 * rather than crashing the whole storefront.
 */
export default async function StorefrontLayout({
  children,
}: {
  children: ReactNode;
}) {
  const h = await headers();
  const host = h.get('x-store-host') ?? '';
  const storeId = host ? await resolveTenant(host) : null;
  const config = storeId ? await loadSiteConfig(storeId) : platformDefaults;

  const headerNav = storeId ? await safeMenu(storeId, 'header') : [];
  const footerNav = storeId ? await safeMenu(storeId, 'footer') : [];

  return (
    <CartProvider>
      <AppShell config={config} headerNav={headerNav} footerNav={footerNav}>
        {children}
      </AppShell>
    </CartProvider>
  );
}

async function safeMenu(
  storeId: string,
  slot: 'header' | 'footer',
): Promise<NavItem[]> {
  try {
    const menu = await getMenu(storeId, slot);
    if (!menu) return [];
    return validateNavItems(menu.items);
  } catch {
    return [];
  }
}
