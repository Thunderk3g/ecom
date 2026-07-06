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
// Motion vocabulary + storefront chrome (header/overlays/footer) — extend the
// Plume system, so they load after it to win the cascade where they refine it.
import '@/styles/motion.css';
import '@/styles/chrome.css';
// Per-surface storefront styles (home, listing, product/cart/checkout) — same
// layering rationale as motion/chrome above.
import '@/styles/home.css';
import '@/styles/listing.css';
import '@/styles/pdp.css';

export const metadata = {
  title: 'Mahaveer Stationery and Sports — school, sport & craft under one roof',
  description: 'Stationery, sports gear, art & craft supplies and gifts.',
};

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
