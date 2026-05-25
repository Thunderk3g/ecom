import { redirect } from 'next/navigation';

import {
  getAssetsAdminContext,
  assertPermission,
  AdminContextError,
} from '../_lib/admin-context';
import { RebuildSpriteForm } from './RebuildSpriteForm';

export const dynamic = 'force-dynamic';

/**
 * Admin → Assets → Rebuild SVG sprite.
 *
 * Single-action page: a button that triggers `rebuildSpriteAction`, which
 * aggregates every `kind = 'svg'` asset for the store into
 * `public/sprites/icons-<storeSlug>.svg`. RBAC requires `media:write`.
 */
export default async function RebuildSpritePage() {
  try {
    const ctx = await getAssetsAdminContext();
    assertPermission(ctx, 'media:write');
  } catch (err) {
    if (err instanceof AdminContextError) redirect('/admin/login');
    throw err;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">SVG sprite</h1>
        <p className="text-muted-foreground">
          Rebuild the aggregate <code>icons-&lt;store&gt;.svg</code> sprite from every SVG asset in
          this store. The storefront <code>&lt;Icon&gt;</code> component renders <code>&lt;use&gt;</code> references against this file.
        </p>
      </div>

      <RebuildSpriteForm />
    </div>
  );
}
