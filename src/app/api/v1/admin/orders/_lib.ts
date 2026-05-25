/**
 * Shared helpers for SP-5 admin orders routes (Stream E).
 *
 * Mirrors `src/app/api/v1/admin/inventory/_lib.ts`:
 *
 * - `runAdminPipeline(req, opts)` collapses
 *     resolveTenant → getSession → RBAC → (optional) CSRF + Idempotency-Key
 *   into a single call. Returns either a success tuple with the resolved
 *   `storeId`, `session`, and (for mutations) the `Idempotency-Key` value,
 *   or a ready-to-return `problem(...)` `NextResponse`.
 *
 * - `mapOrderError(err)` translates the typed errors from
 *   `src/modules/orders/errors.ts` into RFC 7807 problem responses.
 *
 * - `readJsonBody(req)` safely parses a JSON body and returns a discriminated
 *   union so handlers can keep the happy path linear.
 *
 * Permissions used: `orders:read` for GETs, `orders:write` for mutations.
 * RBAC (`requireStorePermission`) already understands the `*` and
 * `orders:*` wildcards.
 */

import { NextResponse } from 'next/server';
import { resolveTenant } from '@/modules/tenant/resolve';
import { getSessionFromRequest, requireStorePermission, type Session } from '@/modules/auth/rbac';
import { requireCsrf } from '@/modules/auth/csrf';
import { problem } from '@/lib/errors';
import {
  AlreadyFulfilledError,
  FulfillmentItemQtyExceededError,
  InvalidOrderTransitionError,
  OrderNotFoundError,
  RefundAmountExceededError,
  RefundFailedError,
} from '@/modules/orders/errors';

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
  /** Permission slug to check, e.g. `'orders:write'`. */
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
 * Map a thrown error from the orders module services to an RFC 7807 response.
 * Unknown errors return an opaque 500 (never leak the message). Callers should
 * `return mapOrderError(err)` from within `catch`.
 */
export function mapOrderError(err: unknown): NextResponse {
  if (err instanceof OrderNotFoundError) {
    return problem(404, 'order-not-found', err.message, []);
  }
  if (err instanceof InvalidOrderTransitionError) {
    return problem(409, 'invalid-order-transition', err.message, [
      { path: ['status'], message: `cannot go ${err.from} -> ${err.to}` },
    ]);
  }
  if (err instanceof AlreadyFulfilledError) {
    return problem(409, 'already-fulfilled', err.message, []);
  }
  if (err instanceof FulfillmentItemQtyExceededError) {
    return problem(422, 'fulfillment-qty-exceeded', err.message, [
      { path: ['items', 'qty'], message: `remaining: ${err.remainingQty}` },
    ]);
  }
  if (err instanceof RefundAmountExceededError) {
    return problem(422, 'refund-amount-exceeded', err.message, [
      { path: ['items', 'amountCents'], message: `available: ${err.availableCents}` },
    ]);
  }
  if (err instanceof RefundFailedError) {
    return problem(502, 'refund-failed', err.message, []);
  }
  // Unknown error: opaque 500 — never leak the message.
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
