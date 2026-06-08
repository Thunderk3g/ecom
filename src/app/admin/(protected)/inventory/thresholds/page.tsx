import { asc } from 'drizzle-orm';
import { getAdminContext } from '../../_lib/context';
import { withTenant } from '@/modules/tenant/with-tenant';
import { productVariants } from '@/db/schema/catalog';
import { listThresholds } from '@/modules/inventory/thresholds';
import { listLocations } from '@/modules/inventory/locations';
import { ThresholdsManager } from './ThresholdsManager';

export const dynamic = 'force-dynamic';

export default async function ThresholdsPage() {
  const { storeId } = await getAdminContext();

  const [thresholds, variants, locs] = await Promise.all([
    listThresholds(storeId),
    withTenant(storeId, async tx => {
      return tx
        .select({ id: productVariants.id, sku: productVariants.sku, name: productVariants.name })
        .from(productVariants)
        .orderBy(asc(productVariants.sku))
        .limit(500);
    }),
    listLocations(storeId),
  ]);

  return (
    <>
      <div className="between" style={{ marginBottom: 20 }}>
        <div>
          <h2 className="h-md" style={{ fontFamily: 'var(--serif)' }}>
            Reorder Thresholds
          </h2>
          <span className="t-sub">Reorder point and qty per variant and location.</span>
        </div>
      </div>

      <ThresholdsManager thresholds={thresholds} variants={variants} locations={locs} />
    </>
  );
}
