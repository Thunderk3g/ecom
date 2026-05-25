/**
 * GET  /api/v1/admin/tax-rates  — list tax rates for tenant (filterable)
 * POST /api/v1/admin/tax-rates  — create tax rate
 *
 * SP-4 Stream G (task 19). Routes query the `tax_rates` schema directly via
 * Drizzle inside `withTenant(...)`. No module-service layer exists yet for
 * these tables; future refactor could extract a service when the pricing
 * engine starts sharing the query logic.
 */

import { NextResponse } from 'next/server';
import { and, asc, eq, gt, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { withTenant } from '@/modules/tenant/with-tenant';
import { taxRates } from '@/db/schema/tax';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { decodeCursor, encodeCursor, parseLimit } from '@/lib/cursor';
import {
  ResourceConflictError,
  mapPromotionError,
  readJsonBody,
  runAdminPipeline,
} from '../promotions/_lib';

type TaxRateRow = typeof taxRates.$inferSelect;

function serialize(row: TaxRateRow): {
  id: string;
  storeId: string;
  regionCode: string;
  rate: string;
  label: string;
  inclusive: boolean;
  taxClass: string;
} {
  return {
    id: row.id,
    storeId: row.storeId,
    regionCode: row.regionCode,
    rate: row.rate,
    label: row.label,
    inclusive: row.inclusive,
    taxClass: row.taxClass,
  };
}

// rate is stored as numeric(6,4); accept either string or numeric input and
// normalize to a string (Drizzle returns numeric as string).
const rateInput = z.union([
  z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/, 'must be a decimal with up to 4 fractional digits'),
  z.number().nonnegative(),
]);

const createBody = z.object({
  regionCode: z.string().min(1).max(16),
  rate: rateInput,
  label: z.string().min(1),
  inclusive: z.boolean().optional(),
  taxClass: z.string().min(1).optional(),
});

function rateToString(v: string | number): string {
  return typeof v === 'string' ? v : v.toString();
}

export async function GET(req: Request): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: false,
    permission: 'tax:read',
  });
  if (!pipeline.ok) return pipeline.response;

  const url = new URL(req.url);
  const cursorRaw = url.searchParams.get('after') ?? undefined;
  const limit = parseLimit(url.searchParams.get('limit'));
  const regionFilter = url.searchParams.get('region');
  const taxClassFilter = url.searchParams.get('taxClass');

  try {
    const result = await withTenant(pipeline.storeId, async tx => {
      const filters: SQL[] = [];
      if (regionFilter) filters.push(eq(taxRates.regionCode, regionFilter));
      if (taxClassFilter) filters.push(eq(taxRates.taxClass, taxClassFilter));
      if (cursorRaw) {
        const decoded = decodeCursor(cursorRaw);
        if (decoded) {
          // Order is regionCode asc, id asc (no createdAt on tax_rates).
          filters.push(
            or(
              gt(taxRates.regionCode, decoded.k),
              and(eq(taxRates.regionCode, decoded.k), gt(taxRates.id, decoded.id)),
            ) as SQL,
          );
        }
      }

      const whereClause = filters.length > 0 ? and(...filters) : undefined;

      const rows = await tx
        .select()
        .from(taxRates)
        .where(whereClause)
        .orderBy(asc(taxRates.regionCode), asc(taxRates.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const sliced = hasMore ? rows.slice(0, limit) : rows;
      const items = sliced.map(serialize);
      const last = sliced[sliced.length - 1];
      const nextCursor =
        hasMore && last ? encodeCursor({ k: last.regionCode, id: last.id }) : null;
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
    permission: 'tax:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const validated = createBody.safeParse(parsed.data);
  if (!validated.success) {
    return problem(
      422,
      'invalid-body',
      'Invalid tax rate body',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  const body = validated.data;
  const taxClass = body.taxClass ?? 'default';

  try {
    const created = await withIdempotency(
      `admin:tax-rates:create:${pipeline.storeId}`,
      pipeline.idempotencyKey!,
      async () =>
        withTenant(pipeline.storeId, async tx => {
          const [clash] = await tx
            .select({ id: taxRates.id })
            .from(taxRates)
            .where(
              and(
                eq(taxRates.regionCode, body.regionCode),
                eq(taxRates.taxClass, taxClass),
              ),
            )
            .limit(1);
          if (clash) {
            throw new ResourceConflictError(
              'tax-rate',
              'region-class',
              `${body.regionCode}/${taxClass}`,
            );
          }

          const [row] = await tx
            .insert(taxRates)
            .values({
              storeId: pipeline.storeId,
              regionCode: body.regionCode,
              rate: rateToString(body.rate),
              label: body.label,
              ...(body.inclusive !== undefined ? { inclusive: body.inclusive } : {}),
              taxClass,
            })
            .returning();
          if (!row) throw new Error('tax_rates insert returned no row');
          return serialize(row);
        }),
    );
    return NextResponse.json({ data: created }, { status: 201 });
  } catch (err) {
    return mapPromotionError(err);
  }
}
