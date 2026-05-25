/**
 * Tax helpers used by the pricing engine.
 *
 * `computeLineTax` is pure — given a unit price, qty, fractional rate, and
 * mode (inclusive/exclusive) it returns the line subtotal and the tax slice.
 * Rounding is `Math.round` (away-from-zero on .5) per the SP-4 plan §Risks.
 *
 * `resolveTaxRate` looks up the most specific rate for a (storeId, address,
 * taxClass) tuple. Fallback order:
 *   1. exact regionCode = `<country>-<region>` with the given taxClass
 *   2. exact regionCode = `<country>` with the given taxClass
 *   3. exact regionCode = `<country>-<region>` with taxClass='default'
 *   4. exact regionCode = `<country>` with taxClass='default'
 *   5. site_config default (0 rate, mode from config)
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsTransaction } from 'drizzle-orm/postgres-js';
import { taxRates } from '@/db/schema/tax';
import type { Address } from '@/db/schema/carts';
import { loadSiteConfig } from '@/modules/config/loader';

type Tx = PostgresJsTransaction<Record<string, never>, Record<string, never>>;

export type TaxMode = 'inclusive' | 'exclusive';

export type ResolvedTaxRate = {
  rate: number;
  mode: TaxMode;
  label: string;
};

export type ComputedLineTax = {
  lineSubtotalCents: number;
  lineTaxCents: number;
};

/**
 * Compute tax for a line of (unitPrice × qty).
 *
 *   inclusive: gross already contains the tax. Back-calc tax = gross × r/(1+r).
 *   exclusive: tax = gross × r (added on top by the pricing engine roll-up).
 *
 * Returns integer cents. Sub-cent results are rounded with `Math.round` (the
 * standard "half away from zero" rule — see Risks note in the SP-4 plan).
 */
export function computeLineTax(
  unitPriceCents: number,
  qty: number,
  rate: number,
  mode: TaxMode,
): ComputedLineTax {
  const gross = unitPriceCents * qty;
  if (mode === 'inclusive') {
    const tax = rate > 0 ? Math.round((gross * rate) / (1 + rate)) : 0;
    return { lineSubtotalCents: gross, lineTaxCents: tax };
  }
  const tax = rate > 0 ? Math.round(gross * rate) : 0;
  return { lineSubtotalCents: gross, lineTaxCents: tax };
}

function parseRateNumeric(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/**
 * Resolve the tax rate to apply for an address + tax class. Reads
 * `tax_rates` inside the supplied tenant-bound transaction. Falls back to
 * the site_config default if no row matches.
 */
export async function resolveTaxRate(
  tx: Tx,
  storeId: string,
  address: Address | undefined,
  taxClass: string,
): Promise<ResolvedTaxRate> {
  const country = address?.country?.trim() ?? '';
  const region = address?.region?.trim() ?? '';

  const candidateRegionCodes: string[] = [];
  if (country && region) candidateRegionCodes.push(`${country}-${region}`);
  if (country) candidateRegionCodes.push(country);

  const candidateClasses: string[] = taxClass === 'default' ? ['default'] : [taxClass, 'default'];

  if (candidateRegionCodes.length > 0) {
    const rows = await tx
      .select()
      .from(taxRates)
      .where(
        and(
          eq(taxRates.storeId, storeId),
          inArray(taxRates.regionCode, candidateRegionCodes),
          inArray(taxRates.taxClass, candidateClasses),
        ),
      );

    // Pick the most specific match: prefer region+class > region > country+class > country.
    for (const rc of candidateRegionCodes) {
      for (const cls of candidateClasses) {
        const hit = rows.find(r => r.regionCode === rc && r.taxClass === cls);
        if (hit) {
          return {
            rate: parseRateNumeric(hit.rate),
            mode: hit.inclusive ? 'inclusive' : 'exclusive',
            label: hit.label,
          };
        }
      }
    }
  }

  // Fallback: site_config default. Mode comes from config; rate is zero.
  const cfg = await loadSiteConfig(storeId);
  const configuredMode = (cfg as { tax?: { mode?: TaxMode } }).tax?.mode ?? 'inclusive';
  return { rate: 0, mode: configuredMode, label: 'No tax' };
}
