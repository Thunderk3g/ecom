import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { products, productVariants, productImages, categories } from '@/db/schema/catalog';
import {
  encodeCursor,
  decodeCursor,
  parseLimit,
  DEFAULT_LIMIT,
  type CursorPayload,
} from '@/lib/cursor';
import { validateProductAttributes } from './attributes';
import { ProductNotFoundError, SlugConflictError } from './errors';

export type ProductRow = typeof products.$inferSelect;
export type ProductVariantRow = typeof productVariants.$inferSelect;
export type ProductImageRow = typeof productImages.$inferSelect;

export type ProductSummary = ProductRow;

export type ProductDetail = ProductRow & {
  variants: ProductVariantRow[];
  images: ProductImageRow[];
};

export type ProductStatus = ProductRow['status'];
export type ProductType = ProductRow['type'];

export type ListProductsFilters = {
  categoryId?: string;
  status?: ProductStatus;
  brand?: string;
  /** Map of attribute key -> value or value array; matches products whose attributes jsonb contains the key with one of the values. */
  attrs?: Record<string, string | string[]>;
  /** Include soft-deleted rows. Default false. */
  includeDeleted?: boolean;
};

export type ListProductsOptions = ListProductsFilters & {
  cursor?: string;
  limit?: number;
};

export type ListProductsResult = {
  items: ProductSummary[];
  nextCursor: string | null;
};

export type CreateProductInput = {
  slug: string;
  name: string;
  descriptionMd?: string | null;
  brand?: string | null;
  categoryId?: string | null;
  type?: ProductType;
  status?: ProductStatus;
  attributes?: Record<string, unknown>;
  taxClass?: string | null;
  seo?: { title?: string; description?: string; keywords?: string[] } | null;
  publishedAt?: Date | null;
};

export type UpdateProductInput = Partial<CreateProductInput>;

/**
 * Build the WHERE clauses common to list/search queries.
 * Returns an array of SQL fragments suitable for `and(...filters)`.
 */
export function buildProductFilters(filters: ListProductsFilters): SQL[] {
  const conds: SQL[] = [];
  if (!filters.includeDeleted) {
    conds.push(sql`${products.deletedAt} IS NULL`);
  }
  if (filters.categoryId) {
    conds.push(eq(products.categoryId, filters.categoryId));
  }
  if (filters.status) {
    conds.push(eq(products.status, filters.status));
  }
  if (filters.brand) {
    conds.push(eq(products.brand, filters.brand));
  }
  if (filters.attrs) {
    for (const [key, val] of Object.entries(filters.attrs)) {
      if (Array.isArray(val)) {
        if (val.length === 0) continue;
        // attributes->>key IN (...) via jsonb operator.
        const literals = sql.join(
          val.map(v => sql`${v}`),
          sql`, `,
        );
        conds.push(sql`${products.attributes} ->> ${key} IN (${literals})`);
      } else {
        conds.push(sql`${products.attributes} ->> ${key} = ${val}`);
      }
    }
  }
  return conds;
}

/**
 * Cursor pagination: products are ordered by (created_at DESC, id DESC).
 * Page break uses keyset `(created_at, id) < (cursor.k, cursor.id)`.
 */
export async function listProducts(
  storeId: string,
  opts: ListProductsOptions = {},
): Promise<ListProductsResult> {
  const limit = parseLimit(opts.limit !== undefined ? String(opts.limit) : undefined);
  const cursor = decodeCursor(opts.cursor);

  return withTenant(storeId, async tx => {
    const conds = buildProductFilters(opts);
    if (cursor) {
      const ts = new Date(cursor.k);
      if (!Number.isNaN(ts.getTime())) {
        conds.push(
          sql`(${products.createdAt}, ${products.id}) < (${ts.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
        );
      }
    }
    const whereExpr = conds.length > 0 ? and(...conds) : undefined;
    const baseQuery = tx.select().from(products);
    const filtered = whereExpr ? baseQuery.where(whereExpr) : baseQuery;
    const rows = await filtered
      .orderBy(sql`${products.createdAt} DESC`, sql`${products.id} DESC`)
      .limit(limit + 1);

    let nextCursor: string | null = null;
    let items = rows;
    if (rows.length > limit) {
      items = rows.slice(0, limit);
      const last = items[items.length - 1];
      if (last) {
        const payload: CursorPayload = {
          k: last.createdAt.toISOString(),
          id: last.id,
        };
        nextCursor = encodeCursor(payload);
      }
    }
    return { items, nextCursor };
  });
}

export async function getProductBySlug(
  storeId: string,
  slug: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<ProductDetail | null> {
  return withTenant(storeId, async tx => {
    const conds: SQL[] = [eq(products.slug, slug)];
    if (!opts.includeDeleted) {
      conds.push(sql`${products.deletedAt} IS NULL`);
    }
    const rows = await tx
      .select()
      .from(products)
      .where(and(...conds))
      .limit(1);
    const product = rows[0];
    if (!product) return null;

    const variants = await tx
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, product.id))
      .orderBy(productVariants.createdAt);

    const images = await tx
      .select()
      .from(productImages)
      .where(eq(productImages.productId, product.id))
      .orderBy(productImages.sortOrder, productImages.createdAt);

    return { ...product, variants, images };
  });
}

export async function getProductById(
  storeId: string,
  id: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<ProductRow | null> {
  return withTenant(storeId, async tx => {
    const conds: SQL[] = [eq(products.id, id)];
    if (!opts.includeDeleted) {
      conds.push(sql`${products.deletedAt} IS NULL`);
    }
    const rows = await tx
      .select()
      .from(products)
      .where(and(...conds))
      .limit(1);
    return rows[0] ?? null;
  });
}

export async function createProduct(
  storeId: string,
  input: CreateProductInput,
): Promise<ProductRow> {
  // Validate attributes against registry BEFORE entering the transaction —
  // buildProductAttributeSchema opens its own tenant scope.
  const attrs = input.attributes ?? {};
  const validatedAttrs = await validateProductAttributes(storeId, attrs);

  return withTenant(storeId, async tx => {
    // Slug uniqueness pre-check.
    const dupe = await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.slug, input.slug))
      .limit(1);
    if (dupe[0]) throw new SlugConflictError(input.slug);

    if (input.categoryId) {
      const cat = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.id, input.categoryId))
        .limit(1);
      if (!cat[0]) throw new ProductNotFoundError(`category:${input.categoryId}`);
    }

    const inserted = await tx
      .insert(products)
      .values({
        storeId,
        slug: input.slug,
        name: input.name,
        descriptionMd: input.descriptionMd ?? null,
        brand: input.brand ?? null,
        categoryId: input.categoryId ?? null,
        type: input.type ?? 'simple',
        status: input.status ?? 'draft',
        attributes: validatedAttrs,
        taxClass: input.taxClass ?? null,
        seo: input.seo ?? null,
        publishedAt: input.publishedAt ?? null,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('createProduct: insert returned no row');
    return row;
  });
}

export async function updateProduct(
  storeId: string,
  id: string,
  patch: UpdateProductInput,
): Promise<ProductRow> {
  let validatedAttrs: Record<string, unknown> | undefined;
  if (patch.attributes !== undefined) {
    validatedAttrs = await validateProductAttributes(storeId, patch.attributes);
  }

  return withTenant(storeId, async tx => {
    const current = await tx
      .select()
      .from(products)
      .where(and(eq(products.id, id), isNull(products.deletedAt)))
      .limit(1);
    if (!current[0]) throw new ProductNotFoundError(id);

    if (patch.slug && patch.slug !== current[0].slug) {
      const dupe = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.slug, patch.slug))
        .limit(1);
      if (dupe[0]) throw new SlugConflictError(patch.slug);
    }

    const updated = await tx
      .update(products)
      .set({
        ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.descriptionMd !== undefined ? { descriptionMd: patch.descriptionMd } : {}),
        ...(patch.brand !== undefined ? { brand: patch.brand } : {}),
        ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(validatedAttrs !== undefined ? { attributes: validatedAttrs } : {}),
        ...(patch.taxClass !== undefined ? { taxClass: patch.taxClass } : {}),
        ...(patch.seo !== undefined ? { seo: patch.seo } : {}),
        ...(patch.publishedAt !== undefined ? { publishedAt: patch.publishedAt } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(products.id, id))
      .returning();
    const row = updated[0];
    if (!row) throw new ProductNotFoundError(id);
    return row;
  });
}

/**
 * Soft-delete: sets deleted_at = now(). Preserves rows for historical
 * order_items references (SP-5).
 */
export async function softDeleteProduct(storeId: string, id: string): Promise<void> {
  await withTenant(storeId, async tx => {
    const result = await tx
      .update(products)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(products.id, id), isNull(products.deletedAt)))
      .returning({ id: products.id });
    if (!result[0]) throw new ProductNotFoundError(id);
  });
}

// Re-export filter builder for use by the search/facets modules.
export const _internal = { buildProductFilters };
