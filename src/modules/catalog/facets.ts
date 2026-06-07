import { and, eq, sql, type SQL } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { products, categories, attributeDefinitions } from '@/db/schema/catalog';
import { buildProductFilters, type ListProductsFilters } from './products';

export type CategoryFacet = { id: string; name: string; count: number };
export type BrandFacet = { brand: string; count: number };
export type AttributeFacet = { value: string; count: number };

export type Facets = {
  categories: CategoryFacet[];
  brands: BrandFacet[];
  attributes: Record<string, AttributeFacet[]>;
};

/**
 * Compute facet counts for the product listing under `baseFilter`. For each
 * facet axis, the count reflects "what would happen if THIS axis filter is
 * removed", which is the standard storefront UX: counts indicate what's
 * available if the user adds another value, not the current intersection.
 *
 * Implementation: for each facet axis we re-run a count query with that axis
 * omitted from the filter set, then group by the axis column. This is N+1 in
 * the number of facet axes; acceptable at this scale (≤ ~20 filterable
 * attributes per store).
 */
export async function computeFacets(
  storeId: string,
  baseFilter: ListProductsFilters = {},
): Promise<Facets> {
  return withTenant(storeId, async tx => {
    const filterableAttrs = await tx
      .select({ key: attributeDefinitions.key })
      .from(attributeDefinitions)
      .where(eq(attributeDefinitions.filterable, true));

    // -- Category facet --
    const catFilters = { ...baseFilter };
    delete catFilters.categoryId;
    const catConds: SQL[] = buildProductFilters(catFilters);
    catConds.push(sql`${products.categoryId} IS NOT NULL`);
    const catBaseQuery = tx
      .select({
        id: categories.id,
        name: categories.name,
        count: sql<number>`count(${products.id})::int`,
      })
      .from(products)
      .innerJoin(categories, eq(categories.id, products.categoryId));
    const catRows = await (catConds.length > 0
      ? catBaseQuery.where(and(...catConds))
      : catBaseQuery
    )
      .groupBy(categories.id, categories.name)
      .orderBy(sql`count(${products.id}) DESC`, categories.name);
    const categoriesFacet: CategoryFacet[] = catRows.map(r => ({
      id: r.id,
      name: r.name,
      count: r.count,
    }));

    // -- Brand facet --
    const brandFilters = { ...baseFilter };
    delete brandFilters.brand;
    const brandConds: SQL[] = buildProductFilters(brandFilters);
    brandConds.push(sql`${products.brand} IS NOT NULL`);
    const brandBaseQuery = tx
      .select({
        brand: products.brand,
        count: sql<number>`count(*)::int`,
      })
      .from(products);
    const brandRows = await (brandConds.length > 0
      ? brandBaseQuery.where(and(...brandConds))
      : brandBaseQuery
    )
      .groupBy(products.brand)
      .orderBy(sql`count(*) DESC`, products.brand);
    const brandsFacet: BrandFacet[] = brandRows
      .filter((r): r is { brand: string; count: number } => r.brand !== null)
      .map(r => ({ brand: r.brand, count: r.count }));

    // -- Attribute facets (one per filterable attribute key) --
    const attributesFacet: Record<string, AttributeFacet[]> = {};
    for (const { key } of filterableAttrs) {
      const attrFilters: ListProductsFilters = {
        ...baseFilter,
        attrs: { ...(baseFilter.attrs ?? {}) },
      };
      // Remove THIS attribute key from the filter set for counting.
      if (attrFilters.attrs) delete attrFilters.attrs[key];
      const conds: SQL[] = buildProductFilters(attrFilters);
      conds.push(sql`${products.attributes} ? ${key}`);

      const baseQ = tx
        .select({
          value: sql<string>`${products.attributes} ->> ${key}`,
          count: sql<number>`count(*)::int`,
        })
        .from(products);
      const rows = await (conds.length > 0 ? baseQ.where(and(...conds)) : baseQ)
        // GROUP BY by ordinal (the first SELECT column = the `->> key` value).
        // Repeating the `${products.attributes} ->> ${key}` fragment here would
        // bind `key` as a SECOND parameter, which Postgres treats as a distinct
        // expression from the SELECT one ("must appear in the GROUP BY clause").
        .groupBy(sql`1`)
        .orderBy(sql`count(*) DESC`);

      attributesFacet[key] = rows
        .filter((r): r is { value: string; count: number } => r.value !== null)
        .map(r => ({ value: r.value, count: r.count }));
    }

    return {
      categories: categoriesFacet,
      brands: brandsFacet,
      attributes: attributesFacet,
    };
  });
}
