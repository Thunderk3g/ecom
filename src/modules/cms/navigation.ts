import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { navigationMenus } from '@/db/schema/cms';
import { BlockValidationError } from './errors';

export type NavigationMenuRow = typeof navigationMenus.$inferSelect;
export type NavSlot = NavigationMenuRow['slot'];

export const NAV_SLOTS: readonly NavSlot[] = ['header', 'footer', 'mobile'];

/**
 * A navigation node. `href` is the link target (optional for grouping-only
 * parents); `children` recurses to build a tree. Validation is bounded to a
 * sane depth via a recursive zod type.
 */
export type NavItem = {
  label: string;
  href?: string;
  children?: NavItem[];
};

// Recursive zod schema for the nav tree. z.lazy lets the schema reference
// itself for `children`.
export const navItemSchema: z.ZodType<NavItem> = z.lazy(() =>
  z.object({
    label: z.string().min(1),
    href: z.string().min(1).optional(),
    children: z.array(navItemSchema).optional(),
  }),
);

export const navItemsSchema = z.array(navItemSchema);

/**
 * Validate a raw nav items tree. Throws BlockValidationError (reused as the
 * CMS-domain validation error) with one issue per problem on failure; returns
 * the parsed tree otherwise.
 */
export function validateNavItems(items: unknown): NavItem[] {
  const parsed = navItemsSchema.safeParse(items);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(issue => {
      const path = issue.path.length ? issue.path.join('.') : '(root)';
      return `nav.${path}: ${issue.message}`;
    });
    throw new BlockValidationError(issues);
  }
  return parsed.data;
}

/** Read the menu for a slot. Returns null when the store has no menu in that slot. */
export async function getMenu(storeId: string, slot: NavSlot): Promise<NavigationMenuRow | null> {
  return withTenant(storeId, async tx => {
    const [row] = await tx
      .select()
      .from(navigationMenus)
      .where(eq(navigationMenus.slot, slot))
      .limit(1);
    return row ?? null;
  });
}

/**
 * Create or replace the menu for a slot (upsert on the unique (store, slot)
 * constraint). Validates the tree before writing.
 */
export async function upsertMenu(
  storeId: string,
  slot: NavSlot,
  items: unknown,
): Promise<NavigationMenuRow> {
  const validated = validateNavItems(items);

  return withTenant(storeId, async tx => {
    const [row] = await tx
      .insert(navigationMenus)
      .values({ storeId, slot, items: validated })
      .onConflictDoUpdate({
        target: [navigationMenus.storeId, navigationMenus.slot],
        set: { items: validated, updatedAt: sql`now()` },
      })
      .returning();
    if (!row) throw new Error('upsertMenu: upsert returned no row');
    return row;
  });
}
