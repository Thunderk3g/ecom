/**
 * Shared helpers for SP-3 admin inventory routes (Stream E).
 *
 * Mirrors `src/app/api/v1/admin/catalog/_lib.ts`:
 *
 * - `runAdminPipeline(req, opts)` collapses the
 *     resolveTenant → getSession → RBAC → (optional) CSRF + Idempotency-Key
 *   pipeline into a single call. Returns either a success tuple with the
 *   resolved `storeId`, `session`, and (for mutations) the `Idempotency-Key`
 *   value, or a ready-to-return `problem(...)` `NextResponse`.
 *
 * - `mapInventoryError(err)` translates the typed errors from
 *   `src/modules/inventory/errors.ts` into RFC 7807 problem responses.
 *
 * - `readJsonBody(req)` safely parses a JSON body and returns a discriminated
 *   union so handlers can keep the happy path linear.
 *
 * Permissions used: `inventory:read` for GETs, `inventory:write` for
 * mutations. RBAC (`requireStorePermission`) already understands the
 * `*` and `inventory:*` wildcards.
 */

import { NextResponse } from 'next/server';
import { resolveTenant } from '@/modules/tenant/resolve';
import { getSessionFromRequest, requireStorePermission, type Session } from '@/modules/auth/rbac';
import { requireCsrf } from '@/modules/auth/csrf';
import { problem } from '@/lib/errors';
import {
  InsufficientStockError,
  LocationInUseError,
  LocationMismatchError,
  LocationNotFoundError,
  NegativeAvailableError,
  OverReceiveError,
  PurchaseOrderNotFoundError,
  ReservationNotActiveError,
  ReservationNotFoundError,
  SupplierInUseError,
  SupplierNotFoundError,
  ThresholdNotFoundError,
} from '@/modules/inventory/errors';

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
  /** Permission slug to check, e.g. `'inventory:write'`. */
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
 * Map a thrown error from the inventory module services to an RFC 7807
 * response. Unknown errors return an opaque 500 (never leak the message).
 * Callers should `return mapInventoryError(err)` from within `catch`.
 */
export function mapInventoryError(err: unknown): NextResponse {
  if (err instanceof LocationNotFoundError) {
    return problem(404, 'location-not-found', err.message, []);
  }
  if (err instanceof SupplierNotFoundError) {
    return problem(404, 'supplier-not-found', err.message, []);
  }
  if (err instanceof PurchaseOrderNotFoundError) {
    return problem(404, 'purchase-order-not-found', err.message, []);
  }
  if (err instanceof ThresholdNotFoundError) {
    return problem(404, 'threshold-not-found', err.message, []);
  }
  if (err instanceof ReservationNotFoundError) {
    return problem(404, 'reservation-not-found', err.message, []);
  }
  if (err instanceof LocationInUseError) {
    return problem(409, 'location-in-use', err.message, [
      { path: ['stock_levels'], message: `referenced by ${err.levelCount} level row(s)` },
    ]);
  }
  if (err instanceof SupplierInUseError) {
    return problem(409, 'supplier-in-use', err.message, [
      { path: ['purchase_orders'], message: `referenced by ${err.activePoCount} active PO(s)` },
    ]);
  }
  if (err instanceof ReservationNotActiveError) {
    return problem(409, 'reservation-not-active', err.message, [
      { path: ['status'], message: `current status: ${err.status}` },
    ]);
  }
  if (err instanceof OverReceiveError) {
    return problem(422, 'over-receive', err.message, [
      { path: ['qty'], message: `outstanding: ${err.outstanding}` },
    ]);
  }
  if (err instanceof InsufficientStockError) {
    return problem(422, 'insufficient-stock', err.message, [
      { path: ['qty'], message: `available: ${err.available}` },
    ]);
  }
  if (err instanceof NegativeAvailableError) {
    return problem(422, 'negative-available', err.message, []);
  }
  if (err instanceof LocationMismatchError) {
    return problem(422, 'location-mismatch', err.message, []);
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
