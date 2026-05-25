import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { Inter, Source_Serif_4 } from 'next/font/google';
import { resolveTenant } from '@/modules/tenant/resolve';
import { loadSiteConfig } from '@/modules/config/loader';
import { platformDefaults } from '@/platform.defaults';
import { themeVars } from '@/lib/theme';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

export const metadata = { title: 'Stationery Store', description: 'Paper goods, properly.' };

// Default platform fonts, self-hosted via next/font. The generated CSS variables
// are wired as the *fallback* values for the brand font vars in globals.css
// (`--font-sans` / `--font-serif`). Per-tenant `site_config` still wins because
// the root layout injects an inline <style> AFTER globals.css in <head>
// (see themeVars / globals.css for the cascade rationale).
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});
const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-source-serif',
});

export default async function RootLayout({ children }: { children: ReactNode }) {
  const h = await headers();
  const host = h.get('x-store-host') ?? '';
  const storeId = host ? await resolveTenant(host) : null;
  const cfg = storeId ? await loadSiteConfig(storeId) : platformDefaults;

  return (
    <html lang={cfg.locale.default} className={`${inter.variable} ${sourceSerif.variable}`}>
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
