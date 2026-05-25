import type { SiteConfig } from '@/platform.defaults';

/**
 * Format an integer amount of minor currency units (cents/paise) using the
 * tenant's configured currency. The platform stores all money as integer cents
 * to avoid float drift; the storefront only ever formats for display.
 *
 * Falls back to a bare symbol + 2-decimal string when `Intl.NumberFormat` does
 * not recognise the configured currency code, so an exotic per-tenant currency
 * never throws at render time.
 */
export function formatMoney(cents: number, config: Pick<SiteConfig, 'currency' | 'locale'>): string {
  const code = config.currency.code;
  const locale = config.locale.default;
  const major = cents / 100;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
    }).format(major);
  } catch {
    const symbol = config.currency.symbol ?? '';
    return `${symbol}${major.toFixed(2)}`;
  }
}
