/**
 * GET  /api/v1/admin/customers   — cursor-paginated customer list with filters
 * POST /api/v1/admin/customers   — idempotent upsert (merge by userId or email)
 *
 * GET filters (AND-combined):
 *   - email       case-insensitive substring (ilike '%term%')
 *   - segment     exact match
 *   - after       opaque cursor
 *   - limit       page size (1..200, default 50)
 *
 * POST body matches `UpsertCustomerInput` — userId optional (guest path).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { listCustomers, upsertCustomer } from '@/modules/customers/customers';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapCustomerError, readJsonBody, runAdminPipeline } from './_lib';

const querySchema = z
  .object({
    email: z.string().min(1).optional(),
    segment: z.string().min(1).optional(),
    after: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

const upsertBody = z
  .object({
    userId: z.string().uuid().nullable().optional(),
    email: z.string().email(),
    phone: z.string().min(1).nullable().optional(),
    locale: z.string().min(2).optional(),
    segment: z.string().min(1).nullable().optional(),
    acceptsMarketing: z.boolean().optional(),
  })
  .strict();

export async function GET(req: Request): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: false,
    permission: 'customers:read',
  });
  if (!pipeline.ok) return pipeline.response;

  const url = new URL(req.url);
  const rawQuery: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) {
    rawQuery[k] = v;
  }
  const validated = querySchema.safeParse(rawQuery);
  if (!validated.success) {
    return problem(
      422,
      'invalid-query',
      'Invalid customers list query',
      validated.error.issues.map(i => ({
        path: i.path.map(p => String(p)),
        message: i.message,
      })),
    );
  }

  const opts: Parameters<typeof listCustomers>[1] = {};
  if (validated.data.email !== undefined) opts.email = validated.data.email;
  if (validated.data.segment !== undefined) opts.segment = validated.data.segment;
  if (validated.data.after !== undefined) opts.cursor = validated.data.after;
  if (validated.data.limit !== undefined) opts.limit = validated.data.limit;

  try {
    const result = await listCustomers(pipeline.storeId, opts);
    return NextResponse.json({
      data: result.items,
      page: { nextCursor: result.nextCursor },
    });
  } catch (err) {
    return mapCustomerError(err);
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'customers:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const validated = upsertBody.safeParse(parsed.data);
  if (!validated.success) {
    return problem(
      422,
      'invalid-body',
      'Invalid customer body',
      validated.error.issues.map(i => ({
        path: i.path.map(p => String(p)),
        message: i.message,
      })),
    );
  }

  try {
    const customer = await withIdempotency(
      `admin:customers:upsert:${pipeline.storeId}`,
      pipeline.idempotencyKey!,
      async () =>
        upsertCustomer(pipeline.storeId, {
          ...(validated.data.userId !== undefined ? { userId: validated.data.userId } : {}),
          email: validated.data.email,
          ...(validated.data.phone !== undefined ? { phone: validated.data.phone } : {}),
          ...(validated.data.locale !== undefined ? { locale: validated.data.locale } : {}),
          ...(validated.data.segment !== undefined ? { segment: validated.data.segment } : {}),
          ...(validated.data.acceptsMarketing !== undefined
            ? { acceptsMarketing: validated.data.acceptsMarketing }
            : {}),
        }),
    );
    return NextResponse.json({ data: customer }, { status: 201 });
  } catch (err) {
    return mapCustomerError(err);
  }
}
