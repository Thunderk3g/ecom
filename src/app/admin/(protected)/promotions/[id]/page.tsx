import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getAdminContext } from '../../_lib/context';
import { PageHeader } from '../../_lib/ui';
import { withTenant } from '@/modules/tenant/with-tenant';
import { promotions } from '@/db/schema/promotions';
import { PromotionForm } from '../_components/PromotionForm';
import type { PromotionFormInput } from '../actions';

export const dynamic = 'force-dynamic';

export default async function EditPromotionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { storeId } = await getAdminContext();

  const row = await withTenant(storeId, async tx => {
    const [r] = await tx
      .select()
      .from(promotions)
      .where(eq(promotions.id, id))
      .limit(1);
    return r ?? null;
  });

  if (!row) notFound();

  const initial: PromotionFormInput = {
    code: row.code ?? '',
    name: row.name,
    type: row.type,
    status: row.status,
    percent: row.percent,
    valueCents: row.valueCents,
    minSubtotalCents: row.conditions.minSubtotalCents ?? null,
    bxgyBuy: row.conditions.bxgyBuy ?? null,
    bxgyGet: row.conditions.bxgyGet ?? null,
    startsAt: row.startsAt ? row.startsAt.toISOString() : '',
    endsAt: row.endsAt ? row.endsAt.toISOString() : '',
    usageLimit: row.usageLimit,
    perCustomerLimit: row.perCustomerLimit,
    stackable: row.stackable,
  };

  const subtitle = row.code ? `Code: ${row.code}` : 'Automatic promotion';

  return (
    <div className="space-y-4">
      <PageHeader title={row.name} description={subtitle} />
      <PromotionForm mode="edit" promotionId={row.id} initial={initial} />
    </div>
  );
}
