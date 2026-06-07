import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { Playfair_Display, Hanken_Grotesk } from 'next/font/google';
import { resolveTenant } from '@/modules/tenant/resolve';
import { loadSiteConfig } from '@/modules/config/loader';
import { platformDefaults } from '@/platform.defaults';
import { themeVars } from '@/lib/theme';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';
// Plume design system — vendored from the Claude Design handoff. Imported after
// globals.css so its tokens + component classes layer on top of the Tailwind
// base. overrides.css comes last and re-points --serif/--sans at the self-hosted
// next/font variables below (CSP forbids the Google Fonts <link>).
import '@/styles/plume/styles.css';
import '@/styles/plume/store-pages.css';
import '@/styles/plume/admin.css';
import '@/styles/plume/overrides.css';

export const metadata = { title: 'Plume — Fine Stationery', description: 'Paper goods, properly.' };

// Plume's editorial type pairing, self-hosted via next/font: Playfair Display
// (serif display, with italics) + Hanken Grotesk (sans body). Their generated
// CSS variables back the design system's --serif / --sans (see overrides.css)
// and the brand font fallbacks in globals.css. Per-tenant site_config can still
// override via the inline <style> injected after globals.css.
const playfair = Playfair_Display({
  subsets: ['latin'],
  display: 'swap',
  style: ['normal', 'italic'],
  variable: '--font-playfair',
});
const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-hanken',
});

export default async function RootLayout({ children }: { children: ReactNode }) {
  const h = await headers();
  const host = h.get('x-store-host') ?? '';
  const storeId = host ? await resolveTenant(host) : null;
  const cfg = storeId ? await loadSiteConfig(storeId) : platformDefaults;

  return (
    <html lang={cfg.locale.default} className={`${playfair.variable} ${hanken.variable}`}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: `:root{${themeVars(cfg)}}` }} />
      </head>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
