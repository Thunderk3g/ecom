/**
 * GET    /api/v1/admin/promotions/[id]
 * PATCH  /api/v1/admin/promotions/[id]
 * DELETE /api/v1/admin/promotions/[id]
 *
 * SP-4 Stream G (task 19). Routes query the `promotions` schema directly via
 * Drizzle inside `withTenant(...)`. Future refactor could extract a service.
 */

import { NextResponse } from 'next/server';
import { eq, and, ne } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { promotions } from '@/db/schema/promotions';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import {
  ResourceConflictError,
  ResourceNotFoundError,
  mapPromotionError,
  patchPromotionSchema,
  readJsonBody,
  runAdminPipeline,
} from '../_lib';

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

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: false,
    permission: 'promotions:read',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id } = await ctx.params;
  try {
    const row = await withTenant(pipeline.storeId, async tx => {
      const [r] = await tx.select().from(promotions).where(eq(promotions.id, id)).limit(1);
      if (!r) throw new ResourceNotFoundError('promotion', id);
      return r;
    });
    return NextResponse.json({ data: serialize(row) });
  } catch (err) {
    return mapPromotionError(err);
  }
}

export async function PATCH(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'promotions:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id } = await ctx.params;
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const validated = patchPromotionSchema.safeParse(parsed.data);
  if (!validated.success) {
    return problem(
      422,
      'invalid-body',
      'Invalid promotion patch',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  const body = validated.data;

  try {
    const updated = await withIdempotency(
      `admin:promotions:patch:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () =>
        withTenant(pipeline.storeId, async tx => {
          const [existing] = await tx
            .select()
            .from(promotions)
            .where(eq(promotions.id, id))
            .limit(1);
          if (!existing) throw new ResourceNotFoundError('promotion', id);

          if (body.code !== undefined && body.code !== null && body.code !== existing.code) {
            const [clash] = await tx
              .select({ id: promotions.id })
              .from(promotions)
              .where(and(eq(promotions.code, body.code), ne(promotions.id, id)))
              .limit(1);
            if (clash) {
              throw new ResourceConflictError('promotion', 'code', body.code);
            }
          }

          const patch: Partial<typeof promotions.$inferInsert> = {};
          if (body.code !== undefined) patch.code = body.code;
          if (body.name !== undefined) patch.name = body.name;
          if (body.type !== undefined) patch.type = body.type;
          if (body.status !== undefined) patch.status = body.status;
          if (body.valueCents !== undefined) patch.valueCents = body.valueCents;
          if (body.percent !== undefined) patch.percent = body.percent;
          if (body.conditions !== undefined) patch.conditions = body.conditions;
          if (body.startsAt !== undefined) {
            patch.startsAt = body.startsAt ? new Date(body.startsAt) : null;
          }
          if (body.endsAt !== undefined) {
            patch.endsAt = body.endsAt ? new Date(body.endsAt) : null;
          }
          if (body.usageLimit !== undefined) patch.usageLimit = body.usageLimit;
          if (body.perCustomerLimit !== undefined) patch.perCustomerLimit = body.perCustomerLimit;
          if (body.stackable !== undefined) patch.stackable = body.stackable;

          if (Object.keys(patch).length === 0) {
            return serialize(existing);
          }

          const [row] = await tx
            .update(promotions)
            .set(patch)
            .where(eq(promotions.id, id))
            .returning();
          if (!row) throw new ResourceNotFoundError('promotion', id);
          return serialize(row);
        }),
    );
    return NextResponse.json({ data: updated });
  } catch (err) {
    return mapPromotionError(err);
  }
}

export async function DELETE(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'promotions:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id } = await ctx.params;
  try {
    await withIdempotency(
      `admin:promotions:delete:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () =>
        withTenant(pipeline.storeId, async tx => {
          const [existing] = await tx
            .select({ id: promotions.id })
            .from(promotions)
            .where(eq(promotions.id, id))
            .limit(1);
          if (!existing) throw new ResourceNotFoundError('promotion', id);
          await tx.delete(promotions).where(eq(promotions.id, id));
          return { deleted: true } as const;
        }),
    );
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return mapPromotionError(err);
  }
}
