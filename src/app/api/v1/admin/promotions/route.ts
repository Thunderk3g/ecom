/**
 * GET  /api/v1/admin/promotions  — cursor-paginated list, filters: code, status
 * POST /api/v1/admin/promotions  — create promotion
 *
 * SP-4 Stream G (task 19). Routes query the `promotions` schema directly via
 * Drizzle inside `withTenant(...)`. No module-service layer exists yet for
 * these tables (the cart pricing engine in SP-4 Stream B reads them but does
 * not own CRUD). A future refactor can extract a `src/modules/cart/promotions`
 * service when shared query logic emerges.
 */

import { NextResponse } from 'next/server';
import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { promotions } from '@/db/schema/promotions';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { decodeCursor, encodeCursor, parseLimit } from '@/lib/cursor';
import {
  ResourceConflictError,
  createPromotionSchema,
  mapPromotionError,
  promotionStatusSchema,
  readJsonBody,
  runAdminPipeline,
} from './_lib';

type PromotionRow = typeof promotions.$inferSelect;

function serialize(row: PromotionRow): {
  id: string;
  storeId: string;
  code: string | null;
  name: string;
  type: PromotionRow['type'];
  status: PromotionRow['status'];
  valueCents: number | null;
  percent: number | null;
  conditions: PromotionRow['conditions'];
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  usedCount: number;
  stackable: boolean;
  createdAt: string;
} {
  return {
    id: row.id,
    storeId: row.storeId,
    code: row.code,
    name: row.name,
    type: row.type,
    status: row.status,
    valueCents: row.valueCents,
    percent: row.percent,
    conditions: row.conditions,
    startsAt: row.startsAt ? row.startsAt.toISOString() : null,
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    usageLimit: row.usageLimit,
    perCustomerLimit: row.perCustomerLimit,
    usedCount: row.usedCount,
    stackable: row.stackable,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function GET(req: Request): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: false,
    permission: 'promotions:read',
  });
  if (!pipeline.ok) return pipeline.response;

  const url = new URL(req.url);
  const cursorRaw = url.searchParams.get('after') ?? undefined;
  const limit = parseLimit(url.searchParams.get('limit'));
  const codeFilter = url.searchParams.get('code');
  const statusFilter = url.searchParams.get('status');

  let statusValue: ReturnType<typeof promotionStatusSchema.parse> | undefined;
  if (statusFilter !== null) {
    const parsed = promotionStatusSchema.safeParse(statusFilter);
    if (!parsed.success) {
      return problem(422, 'invalid-query', 'Invalid status filter', [
        { path: ['status'], message: 'must be one of draft|active|paused|archived' },
      ]);
    }
    statusValue = parsed.data;
  }

  try {
    const result = await withTenant(pipeline.storeId, async tx => {
      const filters: SQL[] = [];
      if (codeFilter) {
        filters.push(eq(promotions.code, codeFilter));
      }
      if (statusValue) {
        filters.push(eq(promotions.status, statusValue));
      }
      if (cursorRaw) {
        const decoded = decodeCursor(cursorRaw);
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
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const sliced = hasMore ? rows.slice(0, limit) : rows;
      const items = sliced.map(serialize);
      const last = sliced[sliced.length - 1];
      const nextCursor =
        hasMore && last
          ? encodeCursor({ k: last.createdAt.toISOString(), id: last.id })
          : null;
      return { items, nextCursor };
    });

    return NextResponse.json({ data: result.items, page: { nextCursor: result.nextCursor } });
  } catch (err) {
    return mapPromotionError(err);
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'promotions:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const validated = createPromotionSchema.safeParse(parsed.data);
  if (!validated.success) {
    return problem(
      422,
      'invalid-body',
      'Invalid promotion body',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  const body = validated.data;

  try {
    const created = await withIdempotency(
      `admin:promotions:create:${pipeline.storeId}`,
      pipeline.idempotencyKey!,
      async () =>
        withTenant(pipeline.storeId, async tx => {
          if (body.code) {
            const [existing] = await tx
              .select({ id: promotions.id })
              .from(promotions)
              .where(eq(promotions.code, body.code))
              .limit(1);
            if (existing) {
              throw new ResourceConflictError('promotion', 'code', body.code);
            }
          }

          const [row] = await tx
            .insert(promotions)
            .values({
              storeId: pipeline.storeId,
              code: body.code ?? null,
              name: body.name,
              type: body.type,
              ...(body.status !== undefined ? { status: body.status } : {}),
              valueCents: body.valueCents ?? null,
              percent: body.percent ?? null,
              ...(body.conditions !== undefined ? { conditions: body.conditions } : {}),
              startsAt: body.startsAt ? new Date(body.startsAt) : null,
              endsAt: body.endsAt ? new Date(body.endsAt) : null,
              usageLimit: body.usageLimit ?? null,
              perCustomerLimit: body.perCustomerLimit ?? null,
              ...(body.stackable !== undefined ? { stackable: body.stackable } : {}),
            })
            .returning();
          if (!row) throw new Error('promotion insert returned no row');
          return serialize(row);
        }),
    );

    return NextResponse.json({ data: created }, { status: 201 });
  } catch (err) {
    return mapPromotionError(err);
  }
}
