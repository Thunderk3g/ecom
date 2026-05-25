import Link from 'next/link';
import { getCategoryBySlug } from '@/modules/catalog/categories';
import { Card, CardContent } from '@/components/ui/card';

export type FeaturedCategoriesProps = {
  heading?: string;
  categorySlugs: string[];
};

/**
 * Featured-categories block. Resolves each configured slug to a category and
 * renders a card grid linking into the category listing. Missing/unpublished
 * slugs are skipped so a stale CMS reference never 500s the page.
 */
export async function FeaturedCategories({
  storeId,
  heading,
  categorySlugs,
}: FeaturedCategoriesProps & { storeId: string }) {
  const resolved = await Promise.all(
    categorySlugs.map(async slug => {
      const cat = await getCategoryBySlug(storeId, slug);
      return cat && cat.published ? cat : null;
    }),
  );
  const categories = resolved.filter((c): c is NonNullable<typeof c> => c !== null);
  if (categories.length === 0) return null;

  return (
    <section className="container py-12">
      {heading ? (
        <h2 className="mb-6 font-serif text-2xl font-semibold tracking-tight">{heading}</h2>
      ) : null}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {categories.map(cat => (
          <Link key={cat.id} href={`/c/${cat.slug}`} className="group">
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardContent className="flex aspect-square flex-col items-center justify-center gap-2 p-4 text-center">
                <span className="font-medium group-hover:text-brand">{cat.name}</span>
                {cat.description ? (
                  <span className="line-clamp-2 text-xs text-muted-foreground">
                    {cat.description}
                  </span>
                ) : null}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
