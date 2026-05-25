'use server';

import { revalidatePath } from 'next/cache';
import { buildSpriteForStore } from '@/modules/media/sprite';
import {
  getAssetsAdminContext,
  assertPermission,
  AdminContextError,
} from '../_lib/admin-context';

export interface RebuildSpriteResult {
  ok: boolean;
  error?: string;
  /** Public URL of the rebuilt sprite (e.g. /sprites/icons-acme.svg). */
  url?: string;
  /** Aggregate size in bytes. */
  bytes?: number;
  /** Number of <symbol> entries packed in. */
  symbols?: number;
}

/**
 * Rebuild the SVG sprite aggregate for the current admin's store. Requires
 * `media:write`. The asset listing inside `buildSpriteForStore` runs under
 * `withTenant`, so RLS scopes it to the same store.
 */
export async function rebuildSpriteAction(): Promise<RebuildSpriteResult> {
  try {
    const ctx = await getAssetsAdminContext();
    assertPermission(ctx, 'media:write');
    const result = await buildSpriteForStore(ctx.storeId);
    revalidatePath('/admin/assets/sprite');
    return {
      ok: true,
      url: result.url,
      bytes: result.bytes,
      symbols: result.symbols,
    };
  } catch (err) {
    if (err instanceof AdminContextError) return { ok: false, error: err.message };
    return { ok: false, error: 'Failed to rebuild sprite. Check the server logs.' };
  }
}
