/**
 * Shared helpers for SP-8 admin media routes.
 *
 * Reuses the generic `runAdminPipeline` from the catalog admin _lib (it takes a
 * permission slug, so the media routes pass `'media:*'`-family permissions),
 * and adds a media-domain RFC 7807 error mapper plus a tenant-scoped store-slug
 * lookup used to build content-addressed object keys.
 */

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { stores } from '@/db/schema/tenancy';
import { problem } from '@/lib/errors';
import {
  AssetInUseError,
  AssetNotFinalizedError,
  AssetNotFoundError,
  AssetValidationError,
  MediaProviderConfigError,
} from '@/modules/media/errors';

export { runAdminPipeline, readJsonBody } from '../catalog/_lib';

/** Look up the tenant's slug (used as the object-key prefix). */
export async function getStoreSlug(storeId: string): Promise<string | null> {
  return withTenant(storeId, async tx => {
    const [row] = await tx.select({ slug: stores.slug }).from(stores).where(eq(stores.id, storeId));
    return row?.slug ?? null;
  });
}

/** Map a thrown media-module error to an RFC 7807 response. */
export function mapMediaError(err: unknown): NextResponse {
  if (err instanceof AssetNotFoundError) {
    return problem(404, 'asset-not-found', err.message, []);
  }
  if (err instanceof AssetNotFinalizedError) {
    return problem(409, 'asset-not-finalized', err.message, []);
  }
  if (err instanceof AssetInUseError) {
    return problem(409, 'asset-in-use', err.message, []);
  }
  if (err instanceof AssetValidationError) {
    return problem(422, 'asset-validation', err.message, err.issues);
  }
  if (err instanceof MediaProviderConfigError) {
    // Misconfiguration is an operator problem, not a client one: 503.
    return problem(503, 'media-provider-unconfigured', err.message, []);
  }
  return problem(500, 'internal-error', 'Internal server error', []);
}
