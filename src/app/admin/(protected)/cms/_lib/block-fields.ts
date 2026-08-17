import type { BlockKind } from '@/modules/cms/blocks';

/**
 * UI field descriptors for the admin block builder.
 *
 * The authoritative validation lives server-side in `BLOCK_REGISTRY` (zod).
 * This map is a *presentation* layer: it tells the generic form renderer which
 * editable fields each block exposes and how to render them. Server-side
 * validation still runs on save, so this never bypasses the schema — it just
 * avoids brittle runtime zod introspection in the browser.
 *
 * Nested/structured props (nested column blocks, arrays) are edited via a JSON
 * textarea so every block kind stays editable without a bespoke widget per
 * shape. Image refs are the one exception — they get a real picker (`image`),
 * because hand-typing an `assetId` uuid into JSON is not an authoring flow.
 */

export type FieldType = 'text' | 'textarea' | 'number' | 'json' | 'select' | 'image';

export interface FieldSpec {
  /** Dot-free key within the block's props object. */
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  /** Default value applied when adding a fresh block. */
  defaultValue?: unknown;
  /** `image` fields only: whether the block's schema demands one. */
  required?: boolean;
}

export interface BlockSpec {
  kind: BlockKind;
  label: string;
  description: string;
  fields: FieldSpec[];
}

const cta = (key: string): FieldSpec => ({
  key,
  label: 'CTA (JSON: { label, href })',
  type: 'json',
  placeholder: '{ "label": "Shop now", "href": "/c/all" }',
});

const imageRef = (key: string, required: boolean): FieldSpec => ({
  key,
  label: `Image${required ? '' : ' — optional'}`,
  type: 'image',
  required,
  help: 'Pick from the asset library, or point at an external URL.',
});

export const BLOCK_SPECS: Record<BlockKind, BlockSpec> = {
  hero: {
    kind: 'hero',
    label: 'Hero',
    description: 'Headline banner with optional CTA and image.',
    fields: [
      { key: 'title', label: 'Title', type: 'text', defaultValue: 'New heading' },
      { key: 'subtitle', label: 'Subtitle', type: 'text' },
      cta('cta'),
      imageRef('image', false),
    ],
  },
  'featured-categories': {
    kind: 'featured-categories',
    label: 'Featured categories',
    description: 'A row of category cards.',
    fields: [
      { key: 'heading', label: 'Heading', type: 'text' },
      {
        key: 'categorySlugs',
        label: 'Category slugs (JSON array)',
        type: 'json',
        placeholder: '["pens", "notebooks"]',
        defaultValue: [],
      },
    ],
  },
  'product-grid': {
    kind: 'product-grid',
    label: 'Product grid',
    description: 'Products from a collection or explicit ids.',
    fields: [
      { key: 'heading', label: 'Heading', type: 'text' },
      { key: 'collectionSlug', label: 'Collection slug', type: 'text', placeholder: 'best-sellers' },
      { key: 'productIds', label: 'Product ids (JSON array)', type: 'json', placeholder: '[]' },
      { key: 'limit', label: 'Limit', type: 'number', defaultValue: 12 },
      {
        key: 'layout',
        label: 'Layout',
        type: 'select',
        defaultValue: 'grid',
        options: [
          { value: 'grid', label: 'Grid' },
          { value: 'carousel', label: 'Carousel' },
        ],
      },
    ],
  },
  banner: {
    kind: 'banner',
    label: 'Banner',
    description: 'Full-width image with optional text and CTA.',
    fields: [
      imageRef('image', true),
      { key: 'text', label: 'Text', type: 'text' },
      cta('cta'),
    ],
  },
  'rich-text': {
    kind: 'rich-text',
    label: 'Rich text',
    description: 'Markdown content block.',
    fields: [
      { key: 'markdown', label: 'Markdown', type: 'textarea', defaultValue: '## Heading\n\nBody text.' },
    ],
  },
  testimonials: {
    kind: 'testimonials',
    label: 'Testimonials',
    description: 'Customer quotes.',
    fields: [
      { key: 'heading', label: 'Heading', type: 'text' },
      {
        key: 'items',
        label: 'Items (JSON array of { quote, name, role? })',
        type: 'json',
        placeholder: '[{ "quote": "Great!", "name": "Asha" }]',
        defaultValue: [{ quote: 'Great products!', name: 'Customer' }],
      },
    ],
  },
  newsletter: {
    kind: 'newsletter',
    label: 'Newsletter',
    description: 'Email capture form.',
    fields: [
      { key: 'heading', label: 'Heading', type: 'text' },
      { key: 'placeholder', label: 'Input placeholder', type: 'text' },
      { key: 'buttonLabel', label: 'Button label', type: 'text' },
    ],
  },
  'two-column': {
    kind: 'two-column',
    label: 'Two column',
    description: 'Split layout. Each column is a JSON array of nested blocks.',
    fields: [
      { key: 'left', label: 'Left column (JSON array of blocks)', type: 'json', placeholder: '[]', defaultValue: [] },
      { key: 'right', label: 'Right column (JSON array of blocks)', type: 'json', placeholder: '[]', defaultValue: [] },
      {
        key: 'ratio',
        label: 'Ratio',
        type: 'select',
        defaultValue: '1-1',
        options: [
          { value: '1-1', label: '1 : 1' },
          { value: '1-2', label: '1 : 2' },
          { value: '2-1', label: '2 : 1' },
        ],
      },
    ],
  },
};

/** Build a fresh props object for a newly added block from its field defaults. */
export function defaultProps(kind: BlockKind): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of BLOCK_SPECS[kind].fields) {
    if (field.defaultValue !== undefined) out[field.key] = field.defaultValue;
  }
  return out;
}
