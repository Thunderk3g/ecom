/**
 * Shared helpers for SP-5 storefront customer-account routes (Stream F).
 *
 * The customer surface (`/api/v1/customer/...`) is reachable only by a
 * logged-in storefront user. The pipeline is:
 *
 *   1. resolveTenant(host)        — 404 on unknown host
 *   2. getSessionFromRequest(req) — 401 when no `sid` cookie / expired session
 *   3. getCustomerByUserId(...)   — 401 when the authenticated user has no
 *                                   customer row in this store (registration
 *                                   short-circuit on first interaction)
 *   4. requireCsrf(req, session.id) — 403 (mutations only; CSRF token bound to
 *                                     the user session id)
 *   5. requireIdempotencyKey(req) — 400 (mutations only)
 *
 * 404 vs 403 vs 401 rules (mirrors the cart surface):
 *   - 401 when the request is not authenticated as a customer.
 *   - 404 when the addressed entity does not exist OR exists but belongs to
 *     another customer. We never disclose enumeration of cross-customer ids.
 *
 * Mutation gating (CSRF + Idempotency-Key) follows the same shape used by the
 * cart routes, but the session id pinned for CSRF verification is always the
 * user-session id — there is no guest fallback on this surface.
 */

import { NextResponse } from 'next/server';
import { resolveTenant } from '@/modules/tenant/resolve';
import {
  getSessionFromRequest,
  type Session,
} from '@/modules/auth/rbac';
import { requireCsrf } from '@/modules/auth/csrf';
import { problem } from '@/lib/errors';
import {
  getCustomerByUserId,
  type CustomerRow,
} from '@/modules/customers/customers';
import {
  AddressNotFoundError,
  CustomerError,
  CustomerNotFoundError,
  EmailConflictError,
} from '@/modules/customers/errors';

// ──────────────────────────────────────────────────────────────────────────────
// Context resolution
// ──────────────────────────────────────────────────────────────────────────────

export type CustomerContext = {
  storeId: string;
  session: Session;
  customer: CustomerRow;
};

export type CustomerResolveResult =
  | { ok: true; ctx: CustomerContext }
  | { ok: false; response: NextResponse };

/**
 * Best-effort: returns the storefront context if a tenant resolves AND the
 * caller has a session AND a customer row exists for that user in the store.
 *
 * Returns the explicit error response on the first miss:
 *   - 404 problem `tenant-not-found` when the host header doesn't resolve.
 *   - 401 problem `unauthenticated` when no session OR no customer record.
 *
 * The 401 fallback for "no customer row" intentionally matches the no-session
 * case so we don't disclose whether the user has ever transacted with the
 * store — callers see "log in again" either way.
 */
export async function resolveTenantAndCustomerSession(
  req: Request,
): Promise<CustomerResolveResult> {
  const host = req.headers.get('x-store-host') ?? req.headers.get('host') ?? '';
  const storeId = host ? await resolveTenant(host) : null;
  if (!storeId) {
    return {
      ok: false,
      response: problem(404, 'tenant-not-found', 'Unknown host', []),
    };
  }

  const session = await getSessionFromRequest(req);
  if (!session) {
    return {
      ok: false,
      response: problem(401, 'unauthenticated', 'Authentication required', []),
    };
  }

  const customer = await getCustomerByUserId(storeId, session.userId);
  if (!customer) {
    return {
      ok: false,
      response: problem(401, 'unauthenticated', 'Authentication required', []),
    };
  }

  return { ok: true, ctx: { storeId, session, customer } };
}

/**
 * Strict variant: 401s when the session has no resolved customer id. Identical
 * behaviour to `resolveTenantAndCustomerSession` today; provided as a named
 * helper so individual routes can read self-documenting without re-importing
 * the longer name.
 */
export async function requireCustomerSession(
  req: Request,
): Promise<CustomerResolveResult> {
  return resolveTenantAndCustomerSession(req);
}

// ──────────────────────────────────────────────────────────────────────────────
// Mutation gate: CSRF + Idempotency-Key
// ──────────────────────────────────────────────────────────────────────────────

export type MutationGateResult =
  | { ok: true; idempotencyKey: string }
  | { ok: false; response: NextResponse };

/**
 * Enforce CSRF + Idempotency-Key for customer-surface mutations. CSRF is
 * verified against the user-session id (no guest fallback on this surface).
 */
export function requireMutationGate(
  req: Request,
  ctx: CustomerContext,
): MutationGateResult {
  if (!requireCsrf(req, ctx.session.id)) {
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
  return { ok: true, idempotencyKey };
}

// ──────────────────────────────────────────────────────────────────────────────
// JSON body parser
// ──────────────────────────────────────────────────────────────────────────────

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
// Error mapping for customer-domain errors
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Translate typed customer-module errors into RFC 7807 problem responses.
 *
 * `CustomerNotFoundError` and `AddressNotFoundError` both render as 404 — the
 * route layer is responsible for *also* mapping cross-customer ownership
 * failures to 404 (see CLAUDE.md: no enumeration leak).
 */
export function mapCustomerError(err: unknown): NextResponse {
  if (err instanceof CustomerNotFoundError) {
    return problem(404, 'customer-not-found', err.message, []);
  }
  if (err instanceof AddressNotFoundError) {
    return problem(404, 'address-not-found', err.message, []);
  }
  if (err instanceof EmailConflictError) {
    return problem(409, 'email-conflict', err.message, [
      { path: ['email'], message: 'already in use' },
    ]);
  }
  if (err instanceof CustomerError) {
    return problem(400, 'customer-error', err.message, []);
  }
  return problem(500, 'internal-error', 'Internal server error', []);
}
