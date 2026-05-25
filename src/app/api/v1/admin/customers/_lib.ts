/**
 * Shared helpers for SP-5 admin customers routes (Stream E).
 *
 * Mirrors `src/app/api/v1/admin/orders/_lib.ts`. The pipeline is identical;
 * only the permission slug + error mapping differ.
 *
 * Permissions used: `customers:read` for GETs, `customers:write` for
 * mutations. RBAC understands `*` and `customers:*` wildcards.
 */

import { NextResponse } from 'next/server';
import { resolveTenant } from '@/modules/tenant/resolve';
import { getSessionFromRequest, requireStorePermission, type Session } from '@/modules/auth/rbac';
import { requireCsrf } from '@/modules/auth/csrf';
import { problem } from '@/lib/errors';
import {
  AddressNotFoundError,
  CustomerNotFoundError,
  EmailConflictError,
} from '@/modules/customers/errors';

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
  /** Permission slug to check, e.g. `'customers:write'`. */
  permission: string;
};

function getHost(req: Request): string {
  return req.headers.get('x-store-host') ?? req.headers.get('host') ?? '';
}

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

export function mapCustomerError(err: unknown): NextResponse {
  if (err instanceof CustomerNotFoundError) {
    return problem(404, 'customer-not-found', err.message, []);
  }
  if (err instanceof AddressNotFoundError) {
    return problem(404, 'address-not-found', err.message, []);
  }
  if (err instanceof EmailConflictError) {
    return problem(409, 'email-conflict', err.message, [
      { path: ['email'], message: 'already registered' },
    ]);
  }
  // Unknown error: opaque 500 — never leak the message.
  return problem(500, 'internal-error', 'Internal server error', []);
}

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
