/**
 * Shared helpers for SP-2 admin catalog routes (Stream D).
 *
 * - `runAdminPipeline` collapses the resolveTenant → getSession → RBAC →
 *   (optional) CSRF + Idempotency-Key check into a single call. Returns either
 *   `{ ok: true, storeId, session, idempotencyKey }` to be threaded into the
 *   module-service call, or `{ ok: false, response }` carrying a ready-to-return
 *   `problem(...)` payload.
 * - `mapCatalogError` translates typed catalog domain errors (from
 *   `src/modules/catalog/errors.ts`) into RFC 7807 responses.
 */

import { NextResponse } from 'next/server';
import { resolveTenant } from '@/modules/tenant/resolve';
import { getSessionFromRequest, requireStorePermission, type Session } from '@/modules/auth/rbac';
import { requireCsrf } from '@/modules/auth/csrf';
import { problem } from '@/lib/errors';
import {
  AttributeInUseError,
  AttributeKeyConflictError,
  AttributeNotFoundError,
  AttributeValidationError,
  BundleSelfReferenceError,
  CategoryInUseError,
  CategoryNotFoundError,
  ImageNotFoundError,
  NotABundleError,
  ProductNotFoundError,
  SkuConflictError,
  SlugConflictError,
  VariantNotFoundError,
} from '@/modules/catalog/errors';

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
  /** Permission slug to check, e.g. `'catalog:write'`. */
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
 * Map a thrown error from the catalog module services to an RFC 7807 response.
 * Unknown errors return a 500. Always returns a NextResponse — callers should
 * `return mapCatalogError(err)` from within `catch`.
 */
export function mapCatalogError(err: unknown): NextResponse {
  if (err instanceof ProductNotFoundError) {
    return problem(404, 'product-not-found', err.message, []);
  }
  if (err instanceof CategoryNotFoundError) {
    return problem(404, 'category-not-found', err.message, []);
  }
  if (err instanceof VariantNotFoundError) {
    return problem(404, 'variant-not-found', err.message, []);
  }
  if (err instanceof AttributeNotFoundError) {
    return problem(404, 'attribute-not-found', err.message, []);
  }
  if (err instanceof ImageNotFoundError) {
    return problem(404, 'image-not-found', err.message, []);
  }
  if (err instanceof SlugConflictError) {
    return problem(409, 'slug-conflict', err.message, [
      { path: ['slug'], message: 'already exists' },
    ]);
  }
  if (err instanceof SkuConflictError) {
    return problem(409, 'sku-conflict', err.message, [
      { path: ['sku'], message: 'already exists' },
    ]);
  }
  if (err instanceof AttributeKeyConflictError) {
    return problem(409, 'attribute-key-conflict', err.message, [
      { path: ['key'], message: 'already exists' },
    ]);
  }
  if (err instanceof CategoryInUseError) {
    return problem(409, 'category-in-use', err.message, [
      { path: ['products'], message: `referenced by ${err.productCount} product(s)` },
    ]);
  }
  if (err instanceof AttributeInUseError) {
    return problem(409, 'attribute-in-use', err.message, [
      { path: ['products'], message: `referenced by ${err.productCount} product(s)` },
    ]);
  }
  if (err instanceof BundleSelfReferenceError) {
    return problem(422, 'bundle-self-reference', err.message, []);
  }
  if (err instanceof NotABundleError) {
    return problem(422, 'not-a-bundle', err.message, []);
  }
  if (err instanceof AttributeValidationError) {
    return problem(422, 'attribute-validation', err.message, err.issues);
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
