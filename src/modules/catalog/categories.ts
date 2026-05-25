import { and, eq, sql } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { categories, products } from '@/db/schema/catalog';
import {
  CategoryNotFoundError,
  CategoryInUseError,
  SlugConflictError,
} from './errors';

export type CategoryRow = typeof categories.$inferSelect;

export type CategoryNode = CategoryRow & { children: CategoryNode[] };

export type CreateCategoryInput = {
  slug: string;
  name: string;
  parentId?: string | null;
  description?: string | null;
  imageAssetId?: string | null;
  sortOrder?: number;
  published?: boolean;
};

export type UpdateCategoryInput = Partial<CreateCategoryInput>;

function buildTree(rows: CategoryRow[]): CategoryNode[] {
  const byId = new Map<string, CategoryNode>();
  for (const r of rows) {
    byId.set(r.id, { ...r, children: [] });
  }
  const roots: CategoryNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  // Stable order: sortOrder asc, then name.
  const sortNodes = (nodes: CategoryNode[]): void => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    for (const n of nodes) sortNodes(n.children);
  };
  sortNodes(roots);
  return roots;
}

/**
 * Storefront read: tree of published categories.
 */
export async function getCategoryTree(storeId: string): Promise<CategoryNode[]> {
  return withTenant(storeId, async tx => {
    const rows = await tx
      .select()
      .from(categories)
      .where(eq(categories.published, true));
    return buildTree(rows);
  });
}

/**
 * Admin read: tree including unpublished categories.
 */
export async function getAdminCategoryTree(storeId: string): Promise<CategoryNode[]> {
  return withTenant(storeId, async tx => {
    const rows = await tx.select().from(categories);
    return buildTree(rows);
  });
}

export async function getCategoryBySlug(
  storeId: string,
  slug: string,
): Promise<CategoryRow | null> {
  return withTenant(storeId, async tx => {
    const rows = await tx
      .select()
      .from(categories)
      .where(eq(categories.slug, slug))
      .limit(1);
    return rows[0] ?? null;
  });
}

export async function getCategoryById(
  storeId: string,
  id: string,
): Promise<CategoryRow | null> {
  return withTenant(storeId, async tx => {
    const rows = await tx
      .select()
      .from(categories)
      .where(eq(categories.id, id))
      .limit(1);
    return rows[0] ?? null;
  });
}

export async function createCategory(
  storeId: string,
  input: CreateCategoryInput,
): Promise<CategoryRow> {
  return withTenant(storeId, async tx => {
    // Slug uniqueness pre-check (defense in depth; RLS+DB constraint backs this).
    const existing = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, input.slug))
      .limit(1);
    if (existing[0]) throw new SlugConflictError(input.slug);

    if (input.parentId) {
      const parent = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.id, input.parentId))
        .limit(1);
      if (!parent[0]) throw new CategoryNotFoundError(input.parentId);
    }

    const inserted = await tx
      .insert(categories)
      .values({
        storeId,
        slug: input.slug,
        name: input.name,
        parentId: input.parentId ?? null,
        description: input.description ?? null,
        imageAssetId: input.imageAssetId ?? null,
        sortOrder: input.sortOrder ?? 0,
        published: input.published ?? true,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('createCategory: insert returned no row');
    return row;
  });
}

export async function updateCategory(
  storeId: string,
  id: string,
  patch: UpdateCategoryInput,
): Promise<CategoryRow> {
  return withTenant(storeId, async tx => {
    const current = await tx
      .select()
      .from(categories)
      .where(eq(categories.id, id))
      .limit(1);
    if (!current[0]) throw new CategoryNotFoundError(id);

    if (patch.slug && patch.slug !== current[0].slug) {
      const dupe = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.slug, patch.slug))
        .limit(1);
      if (dupe[0]) throw new SlugConflictError(patch.slug);
    }

    if (patch.parentId === id) {
      throw new CategoryNotFoundError(id); // Self-parent is invalid; reuse as "bad parent".
    }
    if (patch.parentId) {
      const parent = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.id, patch.parentId))
        .limit(1);
      if (!parent[0]) throw new CategoryNotFoundError(patch.parentId);
    }

    const updated = await tx
      .update(categories)
      .set({
        ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.parentId !== undefined ? { parentId: patch.parentId } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.imageAssetId !== undefined ? { imageAssetId: patch.imageAssetId } : {}),
        ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
        ...(patch.published !== undefined ? { published: patch.published } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(categories.id, id))
      .returning();
    const row = updated[0];
    if (!row) throw new CategoryNotFoundError(id);
    return row;
  });
}

/**
 * Delete a category. FKs are configured so that:
 *  - child categories have `parentId` set to NULL (handled by FK ON DELETE SET NULL)
 *  - products in this category have `categoryId` set to NULL (FK ON DELETE SET NULL)
 *
 * We expose an opt-in guard: pass `{ blockIfProductsExist: true }` to refuse
 * deletion when any product still references this category. Default behaviour
 * relies on the database cascade and silently sets `products.category_id = NULL`.
 */
export async function deleteCategory(
  storeId: string,
  id: string,
  opts: { blockIfProductsExist?: boolean } = {},
): Promise<void> {
  await withTenant(storeId, async tx => {
    const existing = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, id))
      .limit(1);
    if (!existing[0]) throw new CategoryNotFoundError(id);

    if (opts.blockIfProductsExist) {
      const countRows = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(products)
        .where(and(eq(products.categoryId, id), sql`${products.deletedAt} IS NULL`));
      const count = countRows[0]?.count ?? 0;
      if (count > 0) throw new CategoryInUseError(id, count);
    }

    await tx.delete(categories).where(eq(categories.id, id));
  });
}
