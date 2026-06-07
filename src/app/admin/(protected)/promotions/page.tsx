import Link from 'next/link';
import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import { getAdminContext } from '../_lib/context';
import { CursorPager } from '../_lib/ui';
import { withTenant } from '@/modules/tenant/with-tenant';
import { promotions } from '@/db/schema/promotions';
import { decodeCursor, encodeCursor } from '@/lib/cursor';
import { PromotionsTable, type PromotionListRow } from './_components/PromotionsTable';
import { PromotionsFilters } from './_components/PromotionsFilters';

export const dynamic = 'force-dynamic';

const STATUSES = ['draft', 'active', 'paused', 'archived'] as const;
type PromotionStatus = (typeof STATUSES)[number];

const LIMIT = 50;

export default async function PromotionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { storeId } = await getAdminContext();
  const params = await searchParams;

  const statusParam = params.status;
  const status: PromotionStatus | undefined =
    statusParam && (STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as PromotionStatus)
      : undefined;
  const after = params.after || undefined;

  const result = await withTenant(storeId, async tx => {
    const filters: SQL[] = [];
    if (status) {
      filters.push(eq(promotions.status, status));
    }
    if (after) {
      const decoded = decodeCursor(after);
      if (decoded) {
        const cutoff = new Date(decoded.k);
        filters.push(
          or(
            lt(promotions.createdAt, cutoff),
            and(eq(promotions.createdAt, cutoff), lt(promotions.id, decoded.id)),
          ) as SQL,
        );
      }
    }

    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const rows = await tx
      .select()
      .from(promotions)
      .where(whereClause)
      .orderBy(desc(promotions.createdAt), desc(promotions.id))
      .limit(LIMIT + 1);

    const hasMore = rows.length > LIMIT;
    const sliced = hasMore ? rows.slice(0, LIMIT) : rows;
    const last = sliced[sliced.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ k: last.createdAt.toISOString(), id: last.id })
        : null;
    return { items: sliced, nextCursor };
  });

  const rows: PromotionListRow[] = result.items.map(p => ({
    id: p.id,
    code: p.code,
    name: p.name,
    type: p.type,
    status: p.status,
    percent: p.percent,
    valueCents: p.valueCents,
    bxgyBuy: p.conditions.bxgyBuy ?? null,
    bxgyGet: p.conditions.bxgyGet ?? null,
    usedCount: p.usedCount,
    usageLimit: p.usageLimit,
    startsAt: p.startsAt ? p.startsAt.toISOString() : null,
    endsAt: p.endsAt ? p.endsAt.toISOString() : null,
  }));

  return (
    <>
      <div className="between" style={{ marginBottom: 20 }}>
        <div>
          <h2 className="h-md" style={{ fontFamily: 'var(--serif)' }}>
            Promotions
          </h2>
          <span className="t-sub">Coupon codes and automatic discounts.</span>
        </div>
        <Link
          className="btn btn-clay btn-sm"
          href={'/admin/promotions/new' as Parameters<typeof Link>[0]['href']}
        >
          + New promotion
        </Link>
      </div>

      <div className="panel">
        <div className="tbar">
          <PromotionsFilters status={status ?? ''} />
        </div>
        <PromotionsTable rows={rows} />
      </div>

      <CursorPager
        basePath="/admin/promotions"
        nextCursor={result.nextCursor}
        params={{ status }}
      />
    </>
  );
}
