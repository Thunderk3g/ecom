import Link from 'next/link';
import { desc, eq, inArray } from 'drizzle-orm';
import { getAdminContext } from '../../_lib/context';
import { withTenant } from '@/modules/tenant/with-tenant';
import { stockMovements, locations } from '@/db/schema/inventory';
import { productVariants } from '@/db/schema/catalog';
import type { MovementKind } from '@/modules/inventory/movements';

export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<MovementKind, string> = {
  inbound: 'Inbound',
  outbound: 'Outbound',
  adjustment: 'Adjustment',
  reservation: 'Reservation',
  release: 'Release',
  transfer_out: 'Transfer out',
  transfer_in: 'Transfer in',
};

const KIND_PILL: Record<MovementKind, string> = {
  inbound: 'sp-active',
  outbound: 'sp-out',
  adjustment: 'sp-low',
  reservation: 'sp-low',
  release: 'sp-active',
  transfer_out: 'sp-out',
  transfer_in: 'sp-active',
};

export default async function MovementsPage() {
  const { storeId } = await getAdminContext();

  const rows = await withTenant(storeId, async tx => {
    const movements = await tx
      .select()
      .from(stockMovements)
      .orderBy(desc(stockMovements.id))
      .limit(200);

    if (movements.length === 0) return [];

    // Collect unique IDs for label lookups
    const variantIds = [...new Set(movements.map(m => m.variantId))];
    const locationIds = [...new Set(movements.map(m => m.locationId))];

    const [variants, locs] = await Promise.all([
      tx
        .select({ id: productVariants.id, sku: productVariants.sku, name: productVariants.name })
        .from(productVariants)
        .where(inArray(productVariants.id, variantIds)),
      tx
        .select({ id: locations.id, name: locations.name })
        .from(locations)
        .where(inArray(locations.id, locationIds)),
    ]);

    const variantMap = new Map(variants.map(v => [v.id, v]));
    const locationMap = new Map(locs.map(l => [l.id, l]));

    return movements.map(m => ({
      id: m.id.toString(),
      variantId: m.variantId,
      locationId: m.locationId,
      qty: m.qty,
      kind: m.kind,
      reason: m.reason,
      createdBy: m.createdBy,
      createdAt: m.createdAt,
      sku: variantMap.get(m.variantId)?.sku ?? m.variantId,
      variantName: variantMap.get(m.variantId)?.name ?? null,
      locationName: locationMap.get(m.locationId)?.name ?? m.locationId,
    }));
  });

  return (
    <>
      <div className="between" style={{ marginBottom: 20 }}>
        <div>
          <h2 className="h-md" style={{ fontFamily: 'var(--serif)' }}>
            Stock movements
          </h2>
          <span className="t-sub">Append-only ledger of all stock changes. Most recent first.</span>
        </div>
        <Link
          className="btn btn-ghost btn-sm"
          href={'/admin/inventory' as Parameters<typeof Link>[0]['href']}
        >
          ← Back to inventory
        </Link>
      </div>

      <div className="panel">
        <table className="dtable">
          <thead>
            <tr>
              <th>Date / time</th>
              <th>Variant</th>
              <th>Location</th>
              <th className="num">Qty</th>
              <th>Kind</th>
              <th>Reason</th>
              <th>By</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '40px 16px' }}
                >
                  No stock movements yet.
                </td>
              </tr>
            ) : (
              rows.map(row => (
                <tr key={row.id}>
                  <td className="t-sub" style={{ whiteSpace: 'nowrap' }}>
                    {row.createdAt.toLocaleString()}
                  </td>
                  <td>
                    <div className="t-strong">{row.sku}</div>
                    {row.variantName ? <div className="t-sub">{row.variantName}</div> : null}
                  </td>
                  <td>{row.locationName}</td>
                  <td className={`num ${row.qty >= 0 ? 't-strong' : 'sp-out'}`}>
                    {row.qty >= 0 ? `+${row.qty}` : row.qty}
                  </td>
                  <td>
                    <span className={`statpill ${KIND_PILL[row.kind]}`}>
                      {KIND_LABEL[row.kind]}
                    </span>
                  </td>
                  <td className="t-sub">{row.reason ?? '—'}</td>
                  <td className="t-sub">{row.createdBy ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
