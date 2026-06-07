import Link from 'next/link';
import { and, asc, eq, sql } from 'drizzle-orm';
import { getAdminContext } from '../_lib/context';
import { withTenant } from '@/modules/tenant/with-tenant';
import { stockLevels, stockThresholds, locations } from '@/db/schema/inventory';
import { productVariants } from '@/db/schema/catalog';
import { listLocations } from '@/modules/inventory/locations';
import { LevelsGrid, type LevelRow } from './LevelsGrid';

export const dynamic = 'force-dynamic';

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { storeId } = await getAdminContext();
  const params = await searchParams;
  const lowOnly = params.lowOnly === 'true';

  const [rows, locs] = await Promise.all([
    withTenant(storeId, async tx => {
      const availableExpr = sql<number>`(${stockLevels.onHand} - ${stockLevels.reserved})::int`;
      const result = await tx
        .select({
          variantId: stockLevels.variantId,
          locationId: stockLevels.locationId,
          onHand: stockLevels.onHand,
          reserved: stockLevels.reserved,
          available: availableExpr,
          sku: productVariants.sku,
          variantName: productVariants.name,
          locationName: locations.name,
          reorderPoint: stockThresholds.reorderPoint,
        })
        .from(stockLevels)
        .innerJoin(productVariants, eq(productVariants.id, stockLevels.variantId))
        .innerJoin(locations, eq(locations.id, stockLevels.locationId))
        .leftJoin(
          stockThresholds,
          and(
            eq(stockThresholds.variantId, stockLevels.variantId),
            eq(stockThresholds.locationId, stockLevels.locationId),
          ),
        )
        .orderBy(asc(productVariants.sku), asc(locations.code))
        .limit(500);
      return result;
    }),
    listLocations(storeId),
  ]);

  const levels: LevelRow[] = rows
    .map(r => ({
      variantId: r.variantId,
      locationId: r.locationId,
      sku: r.sku,
      variantName: r.variantName,
      locationName: r.locationName,
      onHand: r.onHand,
      reserved: r.reserved,
      available: r.available,
      reorderPoint: r.reorderPoint,
      low: r.reorderPoint !== null && r.available <= r.reorderPoint,
    }))
    .filter(r => (lowOnly ? r.low : true));

  return (
    <>
      <div className="between" style={{ marginBottom: 20 }}>
        <div>
          <h2 className="h-md" style={{ fontFamily: 'var(--serif)' }}>
            Inventory
          </h2>
          <span className="t-sub">Stock levels by variant and location.</span>
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <Link
            className="btn btn-ghost btn-sm"
            href={'/admin/inventory/movements' as Parameters<typeof Link>[0]['href']}
          >
            Movements
          </Link>
          <Link
            className="btn btn-ghost btn-sm"
            href={'/admin/inventory/thresholds' as Parameters<typeof Link>[0]['href']}
          >
            Thresholds
          </Link>
          <Link
            className="btn btn-ghost btn-sm"
            href={'/admin/inventory/locations' as Parameters<typeof Link>[0]['href']}
          >
            Locations
          </Link>
          <Link
            className="btn btn-ghost btn-sm"
            href={'/admin/inventory/suppliers' as Parameters<typeof Link>[0]['href']}
          >
            Suppliers
          </Link>
          <Link
            className="btn btn-ghost btn-sm"
            href={'/admin/inventory/purchase-orders' as Parameters<typeof Link>[0]['href']}
          >
            Purchase orders
          </Link>
        </div>
      </div>

      <LevelsGrid rows={levels} lowOnly={lowOnly} />
    </>
  );
}
