import { redirect } from 'next/navigation';

import { getMenu, NAV_SLOTS, type NavSlot } from '@/modules/cms/navigation';
import {
  getCmsAdminContext,
  assertPermission,
  AdminContextError,
} from '../_lib/admin-context';
import { NavEditor, type NavNode } from '../_components/NavEditor';

export const dynamic = 'force-dynamic';

function toNodes(items: unknown[]): NavNode[] {
  const out: NavNode[] = [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.label !== 'string') continue;
    out.push({
      label: rec.label,
      href: typeof rec.href === 'string' ? rec.href : undefined,
      children: Array.isArray(rec.children) ? toNodes(rec.children) : undefined,
    });
  }
  return out;
}

export default async function CmsNavigationPage() {
  let ctx;
  try {
    ctx = await getCmsAdminContext();
    assertPermission(ctx, 'cms:read');
  } catch (err) {
    if (err instanceof AdminContextError) redirect('/admin/login');
    throw err;
  }

  const rows = await Promise.all(NAV_SLOTS.map(slot => getMenu(ctx.storeId, slot)));
  const menus = NAV_SLOTS.reduce<Record<NavSlot, NavNode[]>>(
    (acc, slot, i) => {
      const row = rows[i];
      acc[slot] = row ? toNodes(row.items ?? []) : [];
      return acc;
    },
    { header: [], footer: [], mobile: [] },
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Navigation</h1>
        <p className="text-muted-foreground">Edit the header, footer, and mobile menus.</p>
      </div>
      <NavEditor menus={menus} />
    </div>
  );
}
