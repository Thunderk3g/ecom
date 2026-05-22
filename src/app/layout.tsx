import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { resolveTenant } from '@/modules/tenant/resolve';
import { loadSiteConfig } from '@/modules/config/loader';
import { platformDefaults } from '@/platform.defaults';
import { themeVars } from '@/lib/theme';

export const metadata = { title: 'Stationery Store', description: 'Paper goods, properly.' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const h = await headers();
  const host = h.get('x-store-host') ?? '';
  const storeId = host ? await resolveTenant(host) : null;
  const cfg = storeId ? await loadSiteConfig(storeId) : platformDefaults;

  return (
    <html lang={cfg.locale.default}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: `:root{${themeVars(cfg)}}` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
