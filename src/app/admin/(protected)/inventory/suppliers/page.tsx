import { getAdminContext } from '../../_lib/context';
import { listSuppliers, type SupplierRow } from '@/modules/inventory/suppliers';
import { SuppliersManager } from './SuppliersManager';

export const dynamic = 'force-dynamic';

export default async function SuppliersPage() {
  const { storeId } = await getAdminContext();

  const { items } = await listSuppliers(storeId, { limit: 200 });

  return (
    <div>
      <div className="between" style={{ marginBottom: 20 }}>
        <div>
          <h2 className="h-md" style={{ fontFamily: 'var(--serif)' }}>
            Suppliers
          </h2>
          <span className="t-sub">Manage supplier contacts and lead times.</span>
        </div>
      </div>

      <SuppliersManager rows={items} />
    </div>
  );
}
