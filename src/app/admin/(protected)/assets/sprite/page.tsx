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
    <>
      <div className="between" style={{ marginBottom: 20 }}>
        <div>
          <h2 className="h-md" style={{ fontFamily: 'var(--serif)' }}>SVG sprite</h2>
          <span className="t-sub">Aggregate every SVG asset into one storefront sprite file.</span>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Rebuild sprite</h3>
        </div>
        <div className="panel-pad" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p className="t-sub" style={{ lineHeight: 1.6 }}>
            Rebuild the aggregate <code>icons-&lt;store&gt;.svg</code> sprite from every SVG asset in
            this store. The storefront <code>&lt;Icon&gt;</code> component renders <code>&lt;use&gt;</code> references against this file.
          </p>
          <RebuildSpriteForm />
        </div>
      </div>
    </>
  );
}
