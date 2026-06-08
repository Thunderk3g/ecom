export const storefrontCategories: Record<string, string> = {
  'notebooks': '/images/categories/notebooks.png',
  'pens-writing': '/images/categories/pens-writing.png',
  'art-supplies': '/images/categories/art-supplies.png',
  'office-supplies': '/images/categories/office-supplies.png',
  'school-supplies': '/images/categories/school-supplies.png',
  'paper-stationery': '/images/categories/paper-stationery.png',
  'bags-cases': '/images/categories/bags-cases.png',
  'gifting': '/images/categories/gifting.png',
};

export const storefrontProducts: Record<string, string[]> = {
  'classic-a5-notebook': [
    '/images/products/classic-a5-notebook-blue.png',
    '/images/products/classic-a5-notebook-black.png',
  ],
  'classic-a4-notebook': [
    '/images/products/classic-a4-notebook.png',
  ],
  'dotted-journal-a5': [
    '/images/products/dotted-journal-a5.png',
  ],
  'gel-pen-v5': [
    '/images/products/gel-pen-v5-blue.png',
    '/images/products/gel-pen-v5-black.png',
  ],
  'rollerball-classic': [
    '/images/products/rollerball-classic.png',
  ],
  'fountain-pen-starter': [
    '/images/products/fountain-pen-starter.png',
  ],
  'watercolor-set-12': [
    '/images/products/watercolor-set-12.png',
  ],
  'sketchbook-a4': [
    '/images/products/sketchbook-a4.png',
  ],
  'sticky-notes-pack': [
    '/images/products/sticky-notes-pack.png',
  ],
  'paper-clips-jar': [
    '/images/products/paper-clips-jar.png',
  ],
  'back-to-school-starter': [
    '/images/products/back-to-school-starter.png',
  ],
};

export function getProductImage(slug: string, index = 0): string | null {
  const images = storefrontProducts[slug];
  if (!images || images.length === 0) return null;
  return images[index % images.length] || images[0] || null;
}

export function getProductThumbnails(slug: string): string[] {
  return storefrontProducts[slug] || [];
}

export function getCategoryImage(slug: string): string | null {
  return storefrontCategories[slug] || null;
}
