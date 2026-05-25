import Link from 'next/link';
import { and, asc, eq, sql } from 'drizzle-orm';
import { Button } from '@/components/ui/button';
import { getAdminContext } from '../_lib/context';
import { PageHeader } from '../_lib/ui';
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
    <div className="space-y-4">
      <PageHeader
        title="Inventory"
        description="Stock levels by variant and location."
        action={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href={'/admin/inventory/movements' as Parameters<typeof Link>[0]['href']}>
                Movements
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={'/admin/inventory/thresholds' as Parameters<typeof Link>[0]['href']}>
                Thresholds
              </Link>
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2 text-sm">
        <Button asChild variant={lowOnly ? 'outline' : 'default'} size="sm">
          <Link href={'/admin/inventory' as Parameters<typeof Link>[0]['href']}>All</Link>
        </Button>
        <Button asChild variant={lowOnly ? 'default' : 'outline'} size="sm">
          <Link href={'/admin/inventory?lowOnly=true' as Parameters<typeof Link>[0]['href']}>
            Low stock only
          </Link>
        </Button>
        <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <Link className="hover:underline" href={'/admin/inventory/locations' as Parameters<typeof Link>[0]['href']}>
            Locations
          </Link>
          <Link className="hover:underline" href={'/admin/inventory/suppliers' as Parameters<typeof Link>[0]['href']}>
            Suppliers
          </Link>
          <Link className="hover:underline" href={'/admin/inventory/purchase-orders' as Parameters<typeof Link>[0]['href']}>
            Purchase orders
          </Link>
        </span>
      </div>

      <LevelsGrid rows={levels} />
    </div>
  );
}
