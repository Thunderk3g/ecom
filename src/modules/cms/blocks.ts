import { z } from 'zod';
import { BlockValidationError } from './errors';

/**
 * Server-side block registry: maps a block `kind` to the zod schema that
 * validates its `props`. This is pure data + zod — NO React/JSX. The future
 * storefront renderer imports BLOCK_REGISTRY to dispatch on kind, and the admin
 * form builder uses it (alongside content_blocks_lib) to know what fields a
 * block accepts. Adding a new block kind = add one entry here.
 *
 * Every stored block has the shape { kind: <key of registry>, props: {...} }.
 */

// ---------- Shared sub-schemas ----------

const ctaSchema = z.object({
  label: z.string().min(1),
  href: z.string().min(1),
});

const imageRefSchema = z.object({
  // assetId is the SP-8 asset library reference; url is an escape hatch for
  // externally hosted images. At least one is required.
  assetId: z.string().uuid().optional(),
  url: z.string().url().optional(),
  alt: z.string().optional(),
}).refine(v => v.assetId !== undefined || v.url !== undefined, {
  message: 'image requires assetId or url',
});

// ---------- Per-kind prop schemas ----------

const heroSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  cta: ctaSchema.optional(),
  image: imageRefSchema.optional(),
});

const featuredCategoriesSchema = z.object({
  heading: z.string().optional(),
  categorySlugs: z.array(z.string().min(1)).min(1),
});

const productGridSchema = z.object({
  heading: z.string().optional(),
  // Either a collection slug OR explicit product ids — and a display limit.
  collectionSlug: z.string().min(1).optional(),
  productIds: z.array(z.string().uuid()).optional(),
  limit: z.number().int().positive().max(48).default(12),
  layout: z.enum(['grid', 'carousel']).default('grid'),
}).refine(
  v => v.collectionSlug !== undefined || (v.productIds !== undefined && v.productIds.length > 0),
  { message: 'product-grid requires collectionSlug or non-empty productIds' },
);

const bannerSchema = z.object({
  image: imageRefSchema,
  text: z.string().optional(),
  cta: ctaSchema.optional(),
});

const richTextSchema = z.object({
  // Markdown body; rendered to HTML at the storefront with a sanitizer.
  markdown: z.string().min(1),
});

const testimonialsSchema = z.object({
  heading: z.string().optional(),
  items: z.array(z.object({
    quote: z.string().min(1),
    name: z.string().min(1),
    role: z.string().optional(),
  })).min(1),
});

const newsletterSchema = z.object({
  heading: z.string().optional(),
  placeholder: z.string().optional(),
  buttonLabel: z.string().optional(),
});

// two-column references other blocks recursively (each column is a list of
// blocks). We validate columns with the generic block validator at runtime to
// avoid a self-referential zod type; here we just shape the container.
const twoColumnSchema = z.object({
  left: z.array(z.unknown()).default([]),
  right: z.array(z.unknown()).default([]),
  ratio: z.enum(['1-1', '1-2', '2-1']).default('1-1'),
});

// ---------- Registry ----------

export const BLOCK_REGISTRY = {
  hero: heroSchema,
  'featured-categories': featuredCategoriesSchema,
  'product-grid': productGridSchema,
  banner: bannerSchema,
  'rich-text': richTextSchema,
  testimonials: testimonialsSchema,
  newsletter: newsletterSchema,
  'two-column': twoColumnSchema,
} as const;

export type BlockKind = keyof typeof BLOCK_REGISTRY;

export const BLOCK_KINDS: readonly BlockKind[] = Object.keys(BLOCK_REGISTRY) as BlockKind[];

export function isBlockKind(value: unknown): value is BlockKind {
  return typeof value === 'string' && value in BLOCK_REGISTRY;
}

/** A single stored/validated block. props shape depends on kind. */
export type ContentBlock = {
  kind: BlockKind;
  props: Record<string, unknown>;
};

/**
 * Validate an array of raw blocks against the registry. Returns the parsed
 * blocks (with zod defaults applied) on success; throws BlockValidationError
 * with one issue per failing block otherwise.
 *
 * Recurses into `two-column` columns so nested blocks are validated too.
 */
export function validateBlocks(blocks: unknown[]): ContentBlock[] {
  const issues: string[] = [];
  const out: ContentBlock[] = [];

  blocks.forEach((raw, i) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      issues.push(`block[${i}]: must be an object with { kind, props }`);
      return;
    }
    const record = raw as Record<string, unknown>;
    const kind = record['kind'];
    if (!isBlockKind(kind)) {
      issues.push(`block[${i}]: unknown kind ${JSON.stringify(kind)}`);
      return;
    }
    const schema = BLOCK_REGISTRY[kind];
    const parsed = schema.safeParse(record['props'] ?? {});
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const path = issue.path.length ? issue.path.join('.') : '(root)';
        issues.push(`block[${i}] (${kind}).${path}: ${issue.message}`);
      }
      return;
    }
    const props = parsed.data as Record<string, unknown>;

    if (kind === 'two-column') {
      // Validate nested columns recursively. Any nested failure is reported
      // with a column-qualified prefix.
      for (const col of ['left', 'right'] as const) {
        const colBlocks = props[col];
        if (Array.isArray(colBlocks) && colBlocks.length > 0) {
          try {
            props[col] = validateBlocks(colBlocks);
          } catch (err) {
            if (err instanceof BlockValidationError) {
              for (const nested of err.issues) {
                issues.push(`block[${i}] (two-column.${col}) -> ${nested}`);
              }
            } else {
              throw err;
            }
          }
        }
      }
    }

    out.push({ kind, props });
  });

  if (issues.length > 0) throw new BlockValidationError(issues);
  return out;
}
