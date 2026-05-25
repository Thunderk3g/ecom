import { and, sql, type SQL } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { products } from '@/db/schema/catalog';
import {
  encodeCursor,
  decodeCursor,
  parseLimit,
  type CursorPayload,
} from '@/lib/cursor';
import {
  listProducts,
  buildProductFilters,
  type ProductSummary,
  type ListProductsFilters,
} from './products';

export type SearchProductsOptions = {
  cursor?: string;
  limit?: number;
  filters?: ListProductsFilters;
};

export type SearchProductsResult = {
  items: ProductSummary[];
  nextCursor: string | null;
};

export type Suggestion = {
  term: string;
  productId: string;
  name: string;
};

/**
 * Full-text + trigram search over products. When `q` is empty, delegates to
 * the standard list endpoint so the same filters and pagination semantics apply.
 *
 * Ranking: `ts_rank(search_tsv, plainto_tsquery(q)) + similarity(name, q) * 0.3`,
 * tiebroken by id. Cursor payload is `{ k: <rank string>, id }` — keyset uses
 * the float rank.
 */
export async function searchProducts(
  storeId: string,
  q: string,
  opts: SearchProductsOptions = {},
): Promise<SearchProductsResult> {
  const trimmed = q.trim();
  if (trimmed === '') {
    return listProducts(storeId, {
      ...(opts.filters ?? {}),
      ...(opts.cursor !== undefined ? { cursor: opts.cursor } : {}),
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
    });
  }

  const limit = parseLimit(opts.limit !== undefined ? String(opts.limit) : undefined);
  const cursor = decodeCursor(opts.cursor);

  return withTenant(storeId, async tx => {
    const filters = opts.filters ?? {};
    const conds: SQL[] = buildProductFilters(filters);

    // FTS match — also seeded by trigram similarity for typo tolerance.
    conds.push(
      sql`(${products.id} IS NOT NULL AND (
        ${products.name} % ${trimmed}
        OR to_tsvector('simple', unaccent(coalesce(${products.name}, '') || ' ' || coalesce(${products.brand}, '') || ' ' || coalesce(${products.descriptionMd}, ''))) @@ plainto_tsquery('simple', unaccent(${trimmed}))
      ))`,
    );

    const rankExpr = sql<number>`(
      ts_rank(
        coalesce(${products}.search_tsv, ''::tsvector),
        plainto_tsquery('simple', unaccent(${trimmed}))
      )
      + similarity(${products.name}, ${trimmed}) * 0.3
    )`;

    if (cursor) {
      const cursorRank = Number(cursor.k);
      if (Number.isFinite(cursorRank)) {
        conds.push(
          sql`(${rankExpr}, ${products.id}) < (${cursorRank}::float, ${cursor.id}::uuid)`,
        );
      }
    }

    const rows = await tx
      .select({
        // Spread of all product columns + computed rank.
        id: products.id,
        storeId: products.storeId,
        slug: products.slug,
        name: products.name,
        descriptionMd: products.descriptionMd,
        brand: products.brand,
        categoryId: products.categoryId,
        type: products.type,
        status: products.status,
        attributes: products.attributes,
        taxClass: products.taxClass,
        seo: products.seo,
        publishedAt: products.publishedAt,
        deletedAt: products.deletedAt,
        createdAt: products.createdAt,
        updatedAt: products.updatedAt,
        rank: rankExpr,
      })
      .from(products)
      .where(and(...conds))
      .orderBy(sql`${rankExpr} DESC`, sql`${products.id} DESC`)
      .limit(limit + 1);

    let items = rows.map(({ rank: _rank, ...r }) => r as ProductSummary);
    let nextCursor: string | null = null;
    if (rows.length > limit) {
      items = items.slice(0, limit);
      const last = rows[limit - 1];
      if (last) {
        const payload: CursorPayload = {
          k: String(Number(last.rank ?? 0)),
          id: last.id,
        };
        nextCursor = encodeCursor(payload);
      }
    }
    return { items, nextCursor };
  });
}

/**
 * Typeahead suggestions. Returns up to `limit` product names ranked by
 * trigram similarity. Each suggestion includes the product id so the
 * frontend can deep-link directly.
 */
export async function suggest(
  storeId: string,
  q: string,
  limit = 8,
): Promise<Suggestion[]> {
  const trimmed = q.trim();
  if (trimmed === '') return [];
  const cappedLimit = Math.min(Math.max(limit, 1), 50);

  return withTenant(storeId, async tx => {
    const rows = await tx
      .select({
        id: products.id,
        name: products.name,
        sim: sql<number>`similarity(${products.name}, ${trimmed})`,
      })
      .from(products)
      .where(
        and(
          sql`${products.deletedAt} IS NULL`,
          sql`${products.name} % ${trimmed}`,
        ),
      )
      .orderBy(sql`similarity(${products.name}, ${trimmed}) DESC`, products.name)
      .limit(cappedLimit);

    return rows.map(r => ({ term: r.name, productId: r.id, name: r.name }));
  });
}
