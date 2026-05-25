/**
 * Shared helpers for SP-4 admin promotion/tax/shipping routes (Stream G).
 *
 * Mirrors `src/app/api/v1/admin/catalog/_lib.ts` and
 * `src/app/api/v1/admin/inventory/_lib.ts`:
 *
 * - `runAdminPipeline(req, opts)` collapses
 *     resolveTenant → getSession → RBAC → (optional) CSRF + Idempotency-Key
 *   into one call.
 * - `mapPromotionError(err)` converts a small set of internal errors into
 *   RFC 7807 responses. SP-4 Stream G has no module-service layer for these
 *   tables yet (intentional — see route comments), so the surface is limited
 *   to NotFoundError / ConflictError thrown directly from routes.
 * - `readJsonBody(req)` safely parses a JSON body and returns a discriminated
 *   union so handlers can keep the happy path linear.
 *
 * Permissions used (matches the `scope:*` wildcards from the SP-4 plan task 19):
 *   - promotions:read  / promotions:write
 *   - tax:read         / tax:write
 *   - shipping:read    / shipping:write
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveTenant } from '@/modules/tenant/resolve';
import {
  getSessionFromRequest,
  requireStorePermission,
  type Session,
} from '@/modules/auth/rbac';
import { requireCsrf } from '@/modules/auth/csrf';
import { problem } from '@/lib/errors';

export type PipelineResult =
  | {
      ok: true;
      storeId: string;
      session: Session;
      /** Present only when `requireMutation: true`. */
      idempotencyKey?: string;
    }
  | { ok: false; response: NextResponse };

export type PipelineOptions = {
  /** When true, enforce CSRF + Idempotency-Key. Mutations should pass true. */
  requireMutation: boolean;
  /** Permission slug to check, e.g. `'promotions:write'`. */
  permission: string;
};

function getHost(req: Request): string {
  return req.headers.get('x-store-host') ?? req.headers.get('host') ?? '';
}

/**
 * Runs the standard admin-route preamble. On failure returns a
 * pre-built `problem(...)` response; on success returns the resolved
 * tenant id and session for the route to use.
 */
export async function runAdminPipeline(
  req: Request,
  opts: PipelineOptions,
): Promise<PipelineResult> {
  const host = getHost(req);
  const storeId = host ? await resolveTenant(host) : null;
  if (!storeId) {
    return { ok: false, response: problem(404, 'tenant-not-found', 'Unknown host', []) };
  }

  const session = await getSessionFromRequest(req);
  if (!session) {
    return { ok: false, response: problem(401, 'unauthenticated', 'Authentication required', []) };
  }

  const rbac = await requireStorePermission(storeId, session.userId, opts.permission);
  if (!rbac.ok) {
    return {
      ok: false,
      response: problem(403, 'forbidden', `Forbidden: ${rbac.reason}`, []),
    };
  }

  if (opts.requireMutation) {
    if (!requireCsrf(req, session.id)) {
      return {
        ok: false,
        response: problem(403, 'csrf-invalid', 'CSRF token missing or invalid', []),
      };
    }
    const idempotencyKey = req.headers.get('idempotency-key');
    if (!idempotencyKey) {
      return {
        ok: false,
        response: problem(400, 'idempotency-key-required', 'Idempotency-Key header is required', [
          { path: ['idempotency-key'], message: 'required' },
        ]),
      };
    }
    return { ok: true, storeId, session, idempotencyKey };
  }

  return { ok: true, storeId, session };
}

/**
 * Lightweight typed errors used inside Stream G routes. There is no
 * module-service layer for promotions / tax_rates / shipping_zones yet —
 * routes throw these from inside withTenant(...) and the catch maps them
 * to RFC 7807. A future refactor can extract these to `src/modules/cart`
 * once the pricing engine starts sharing the queries.
 */
export class ResourceNotFoundError extends Error {
  constructor(public readonly resource: string, public readonly id: string) {
    super(`${resource} not found: ${id}`);
    this.name = 'ResourceNotFoundError';
  }
}

export class ResourceConflictError extends Error {
  constructor(
    public readonly resource: string,
    public readonly field: string,
    public readonly value: string,
  ) {
    super(`${resource} ${field} conflict: ${value}`);
    this.name = 'ResourceConflictError';
  }
}

/**
 * Map errors thrown from Stream G routes (promotions / tax / shipping) into
 * RFC 7807 responses. Unknown errors return an opaque 500.
 */
export function mapPromotionError(err: unknown): NextResponse {
  if (err instanceof ResourceNotFoundError) {
    return problem(404, `${err.resource}-not-found`, err.message, []);
  }
  if (err instanceof ResourceConflictError) {
    return problem(409, `${err.resource}-${err.field}-conflict`, err.message, [
      { path: [err.field], message: 'already exists' },
    ]);
  }
  return problem(500, 'internal-error', 'Internal server error', []);
}

/**
 * Safely parse a JSON body. Returns `{ ok: false, response }` on parse
 * failure so handlers can `if (!parsed.ok) return parsed.response;` —
 * keeps the happy path linear.
 */
export async function readJsonBody(
  req: Request,
): Promise<{ ok: true; data: unknown } | { ok: false; response: NextResponse }> {
  try {
    const data = (await req.json()) as unknown;
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      response: problem(400, 'invalid-json', 'Request body must be valid JSON', []),
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Zod schemas for promotion bodies. Used by the promotions routes; kept here
// (rather than inside the route files) so the [id] route can re-use the
// patch schema without circular imports.
// ──────────────────────────────────────────────────────────────────────────────

export const promotionConditionsSchema = z
  .object({
    minSubtotalCents: z.number().int().nonnegative().optional(),
    variantIds: z.array(z.string().uuid()).optional(),
    categoryIds: z.array(z.string().uuid()).optional(),
    bxgyBuy: z.number().int().positive().optional(),
    bxgyGet: z.number().int().positive().optional(),
    customerSegments: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const promotionTypeSchema = z.enum(['percent', 'amount', 'free_shipping', 'bxgy']);
export const promotionStatusSchema = z.enum(['draft', 'active', 'paused', 'archived']);

export const createPromotionSchema = z.object({
  code: z.string().min(1).max(64).nullish(),
  name: z.string().min(1),
  type: promotionTypeSchema,
  status: promotionStatusSchema.optional(),
  valueCents: z.number().int().nonnegative().nullish(),
  percent: z.number().int().min(0).max(100).nullish(),
  conditions: promotionConditionsSchema.optional(),
  startsAt: z.string().datetime().nullish(),
  endsAt: z.string().datetime().nullish(),
  usageLimit: z.number().int().positive().nullish(),
  perCustomerLimit: z.number().int().positive().nullish(),
  stackable: z.boolean().optional(),
});

export const patchPromotionSchema = z.object({
  code: z.string().min(1).max(64).nullable().optional(),
  name: z.string().min(1).optional(),
  type: promotionTypeSchema.optional(),
  status: promotionStatusSchema.optional(),
  valueCents: z.number().int().nonnegative().nullable().optional(),
  percent: z.number().int().min(0).max(100).nullable().optional(),
  conditions: promotionConditionsSchema.optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  usageLimit: z.number().int().positive().nullable().optional(),
  perCustomerLimit: z.number().int().positive().nullable().optional(),
  stackable: z.boolean().optional(),
});

export type CreatePromotionBody = z.infer<typeof createPromotionSchema>;
export type PatchPromotionBody = z.infer<typeof patchPromotionSchema>;
