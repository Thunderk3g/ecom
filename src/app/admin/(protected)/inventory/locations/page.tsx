import Link from 'next/link';
import { getAdminContext } from '../../_lib/context';
import { listLocations, type LocationRow } from '@/modules/inventory/locations';
import { LocationsManager } from './LocationsManager';

export const dynamic = 'force-dynamic';

export default async function LocationsPage() {
  const { storeId } = await getAdminContext();
  const rows: LocationRow[] = await listLocations(storeId);

  return (
    <>
      <div className="between" style={{ marginBottom: 20 }}>
        <div>
          <h2 className="h-md" style={{ fontFamily: 'var(--serif)' }}>
            Locations
          </h2>
          <span className="t-sub">Warehouses, stores, and transit hubs.</span>
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

      <LocationsManager rows={rows} />
    </>
  );
}
