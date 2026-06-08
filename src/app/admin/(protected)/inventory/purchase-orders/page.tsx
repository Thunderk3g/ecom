import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { getAdminContext } from '../../_lib/context';
import { withTenant } from '@/modules/tenant/with-tenant';
import { productVariants } from '@/db/schema/catalog';
import { listPurchaseOrders, type PurchaseOrderRow } from '@/modules/inventory/purchase-orders';
import { listSuppliers, type SupplierRow } from '@/modules/inventory/suppliers';
import { listLocations, type LocationRow } from '@/modules/inventory/locations';
import { PurchaseOrdersManager } from './PurchaseOrdersManager';

export const dynamic = 'force-dynamic';

export type VariantRef = {
  id: string;
  sku: string;
  name: string | null;
};

export default async function PurchaseOrdersPage() {
  const { storeId } = await getAdminContext();

  const [{ items: pos }, { items: suppliers }, variantRows, locations] = await Promise.all([
    listPurchaseOrders(storeId, { limit: 200 }),
    listSuppliers(storeId, { limit: 500 }),
    withTenant(storeId, async tx =>
      tx
        .select({ id: productVariants.id, sku: productVariants.sku, name: productVariants.name })
        .from(productVariants)
        .limit(500),
    ),
    listLocations(storeId),
  ]);

  return (
    <>
      <div className="between" style={{ marginBottom: 20 }}>
        <div>
          <h2 className="h-md" style={{ fontFamily: 'var(--serif)' }}>
            Purchase orders
          </h2>
          <span className="t-sub">Track inbound stock orders with suppliers.</span>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <Link
            className="btn btn-ghost btn-sm"
            href={'/admin/inventory' as Parameters<typeof Link>[0]['href']}
          >
            ← Inventory
          </Link>
        </div>
      </div>

      <PurchaseOrdersManager
        pos={pos}
        suppliers={suppliers}
        variants={variantRows}
        locations={locations}
      />
    </>
  );
}
