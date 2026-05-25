/**
 * csv.imports worker handler (SP-6 Task 20).
 *
 * Consumes admin CSV uploads of product/variant rows. Two payload shapes are
 * accepted so this handler can survive the inline-base64 transport that the
 * SP-2 admin route ships today and the asset-backed transport SP-8/SP-6 will
 * move to:
 *
 *   1. Inline:   { storeId, uploadedBy, bodyBase64, mappingProfile? }
 *   2. Asset:    { storeId, userId|uploadedBy, assetId, mappingProfile? }
 *   3. URL:      { storeId, userId|uploadedBy, fileUrl, mappingProfile? }
 *
 * The handler is intentionally tolerant: per-row failures are accumulated into
 * a results summary, never throwing out of the whole job. A job that fails
 * fast (zero rows imported) returns the error counts so BullMQ records them
 * via the histogram on the worker entrypoint.
 *
 * Persistence: this iteration logs the results (via pino) tagged with the
 * job id and storeId — no `import_results` table exists yet (see Grep audit).
 * TODO(SP-6): persist results to a dedicated `csv_import_runs` table so the
 * admin UI can render a "last import" report. Logging is the bridge.
 *
 * Tenancy: all DB work runs under `withTenant(storeId, ...)` since the worker
 * is outside the request lifecycle. The catalog module services (createProduct
 * / updateProduct / createVariant / updateVariant) each open their own
 * `withTenant` scope so we don't pass the tx through — but row lookups for
 * "upsert by sku" require their own tenant scope here.
 */

import type { Job } from 'bullmq';
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { withTenant } from '@/modules/tenant/with-tenant';
import { productVariants, products } from '@/db/schema/catalog';
import {
  createProduct,
  updateProduct,
  getProductBySlug,
} from '@/modules/catalog/products';
import {
  createVariant,
  updateVariant,
  type CreateVariantInput,
} from '@/modules/catalog/variants';
import { getCategoryBySlug } from '@/modules/catalog/categories';

// --- Payload schema ----------------------------------------------------------
// The producer (admin route) currently ships `bodyBase64` inline; future
// versions will switch to assetId/fileUrl. Validate loosely so a producer
// change doesn't break the worker.

export interface CsvImportPayload {
  storeId: string;
  /** Either field works; some producers used uploadedBy, the plan uses userId. */
  userId?: string;
  uploadedBy?: string;
  /** Inline CSV body, base64-encoded. Mutually exclusive with assetId/fileUrl. */
  bodyBase64?: string;
  /** Asset reference (object-storage). SP-8 path. */
  assetId?: string;
  /** Direct file URL. Lower-trust fallback. */
  fileUrl?: string;
  /** Optional named mapping profile; defaults to the platform-export shape. */
  mappingProfile?: string;
  fileName?: string;
}

export interface CsvImportResult {
  totalRows: number;
  productsCreated: number;
  productsUpdated: number;
  variantsCreated: number;
  variantsUpdated: number;
  errors: Array<{ row: number; sku?: string; message: string }>;
}

// Row schema after column mapping. Mirrors the platform's own export columns:
//   sku, name, brand, price_cents, compare_at_cents, status, category_slug,
//   product_slug, description_md
const rowSchema = z
  .object({
    sku: z.string().min(1),
    name: z.string().min(1).optional(),
    brand: z.string().optional(),
    price_cents: z.coerce.number().int().nonnegative(),
    compare_at_cents: z
      .union([z.coerce.number().int().nonnegative(), z.literal('')])
      .optional()
      .transform(v => (v === '' || v === undefined ? null : Number(v))),
    status: z.enum(['draft', 'active', 'archived']).optional().default('draft'),
    category_slug: z.string().optional(),
    product_slug: z.string().optional(),
    description_md: z.string().optional(),
  })
  .passthrough();

// --- Minimal CSV parser ------------------------------------------------------
// Handles RFC 4180 essentials: quoted fields, embedded commas, escaped quotes
// ("" inside quoted), CRLF or LF line endings. NOT installed: papaparse — per
// the brief, we inline a small parser instead of adding a dep.

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const len = text.length;
  // Strip a leading UTF-8 BOM if present — Excel exports sometimes prepend one.
  if (len > 0 && text.charCodeAt(0) === 0xfeff) i = 1;

  while (i < len) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < len && text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      // Treat \r\n as one line break; bare \r as one too.
      row.push(field);
      rows.push(row);
      field = '';
      row = [];
      i += 1;
      if (i < len && text[i] === '\n') i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      field = '';
      row = [];
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // Tail: flush any remaining buffer if the file didn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully-empty trailing rows (e.g. Excel sometimes appends one).
  while (rows.length > 0 && rows[rows.length - 1]!.every(c => c === '')) {
    rows.pop();
  }
  return rows;
}

function rowsToRecords(grid: string[][]): Record<string, string>[] {
  if (grid.length === 0) return [];
  const header = grid[0]!.map(h => h.trim().toLowerCase());
  const out: Record<string, string>[] = [];
  for (let i = 1; i < grid.length; i += 1) {
    const cells = grid[i]!;
    const rec: Record<string, string> = {};
    for (let c = 0; c < header.length; c += 1) {
      rec[header[c]!] = (cells[c] ?? '').trim();
    }
    out.push(rec);
  }
  return out;
}

// Look up a variant by (storeId, sku) using the appDb pool with RLS.
async function findVariantBySku(
  storeId: string,
  sku: string,
): Promise<{ id: string; productId: string } | null> {
  return withTenant(storeId, async tx => {
    const rows = await tx
      .select({ id: productVariants.id, productId: productVariants.productId })
      .from(productVariants)
      .where(eq(productVariants.sku, sku))
      .limit(1);
    return rows[0] ?? null;
  });
}

// Look up a product by (storeId, slug) ignoring soft-deleted rows.
async function findProductIdBySlug(
  storeId: string,
  slug: string,
): Promise<string | null> {
  return withTenant(storeId, async tx => {
    const rows = await tx
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.slug, slug), isNull(products.deletedAt)))
      .limit(1);
    return rows[0]?.id ?? null;
  });
}

// Slugify fallback used when a row provides a name but no product_slug.
function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function loadCsvBody(payload: CsvImportPayload): Promise<string> {
  if (payload.bodyBase64) {
    return Buffer.from(payload.bodyBase64, 'base64').toString('utf-8');
  }
  if (payload.fileUrl) {
    // Direct URL fetch. Trust boundary: callers must only enqueue URLs from
    // trusted asset hosts. Future: switch to a signed object-storage fetch.
    const res = await fetch(payload.fileUrl);
    if (!res.ok) {
      throw new Error(`csv-import: fetch ${payload.fileUrl} -> ${res.status}`);
    }
    return await res.text();
  }
  if (payload.assetId) {
    // TODO(SP-6): once the assets module exposes a signed-download helper,
    // resolve assetId -> URL -> body. For now, throw a clear error so the
    // job fails fast rather than silently importing zero rows.
    throw new Error('csv-import: assetId payload not yet supported; switch to fileUrl or bodyBase64');
  }
  throw new Error('csv-import: payload missing bodyBase64, fileUrl, and assetId');
}

export async function csvImport(
  job: Job<CsvImportPayload>,
): Promise<CsvImportResult> {
  const { storeId } = job.data;
  const userId = job.data.userId ?? job.data.uploadedBy ?? 'unknown';

  if (!storeId) {
    throw new Error('csv-import: storeId is required');
  }

  logger.info(
    {
      jobId: job.id,
      storeId,
      userId,
      fileName: job.data.fileName,
      mappingProfile: job.data.mappingProfile ?? 'platform-export',
    },
    'csv-import received',
  );

  const csvText = await loadCsvBody(job.data);
  const grid = parseCsv(csvText);
  const records = rowsToRecords(grid);

  const result: CsvImportResult = {
    totalRows: records.length,
    productsCreated: 0,
    productsUpdated: 0,
    variantsCreated: 0,
    variantsUpdated: 0,
    errors: [],
  };

  // Resolve a category slug -> id once per unique slug; small caches keep us
  // off the DB in the common case of all rows sharing a category.
  const categoryCache = new Map<string, string | null>();
  const productSlugCache = new Map<string, string>(); // slug -> productId

  for (let idx = 0; idx < records.length; idx += 1) {
    const rec = records[idx]!;
    // Row number is 1-indexed and accounts for the header row.
    const rowNumber = idx + 2;

    const parsed = rowSchema.safeParse(rec);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map(i => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      result.errors.push({ row: rowNumber, sku: rec.sku, message });
      continue;
    }
    const row = parsed.data;

    try {
      // Resolve the category (if any). A missing slug is non-fatal — the
      // product is created without a category and the admin can fix later.
      let categoryId: string | null = null;
      if (row.category_slug) {
        const cached = categoryCache.get(row.category_slug);
        if (cached !== undefined) {
          categoryId = cached;
        } else {
          const cat = await getCategoryBySlug(storeId, row.category_slug);
          categoryId = cat?.id ?? null;
          categoryCache.set(row.category_slug, categoryId);
        }
      }

      // Resolve or create the parent product. Priority order:
      //   1. variant with matching SKU already exists → use its productId
      //   2. product_slug provided → look up; create if missing
      //   3. otherwise → derive slug from name and create
      let productId: string | null = null;
      let productCreated = false;
      let productUpdated = false;

      const existingVariant = await findVariantBySku(storeId, row.sku);
      if (existingVariant) {
        productId = existingVariant.productId;
      } else {
        const slug = row.product_slug ?? (row.name ? slugify(row.name) : slugify(row.sku));
        const cached = productSlugCache.get(slug);
        if (cached) {
          productId = cached;
        } else {
          const found = await findProductIdBySlug(storeId, slug);
          if (found) {
            productId = found;
            productSlugCache.set(slug, found);
          } else {
            const created = await createProduct(storeId, {
              slug,
              name: row.name ?? row.sku,
              descriptionMd: row.description_md ?? null,
              brand: row.brand ?? null,
              categoryId,
              status: row.status,
            });
            productId = created.id;
            productSlugCache.set(slug, created.id);
            productCreated = true;
          }
        }
      }

      if (!productId) {
        result.errors.push({
          row: rowNumber,
          sku: row.sku,
          message: 'failed to resolve product for row',
        });
        continue;
      }

      // If the product already existed AND the row carries product-level
      // fields, patch them. Skip when we just created it (already current).
      if (!productCreated && (row.name || row.brand || categoryId)) {
        try {
          await updateProduct(storeId, productId, {
            ...(row.name ? { name: row.name } : {}),
            ...(row.brand !== undefined ? { brand: row.brand } : {}),
            ...(categoryId ? { categoryId } : {}),
            ...(row.description_md !== undefined ? { descriptionMd: row.description_md } : {}),
            ...(row.status ? { status: row.status } : {}),
          });
          productUpdated = true;
        } catch (err) {
          // Non-fatal: log and continue. The variant upsert is still attempted.
          logger.warn(
            { jobId: job.id, storeId, productId, err },
            'csv-import: product update failed (non-fatal)',
          );
        }
      }

      const variantInput: CreateVariantInput = {
        sku: row.sku,
        name: row.name ?? null,
        priceCents: row.price_cents,
        compareAtCents: row.compare_at_cents ?? null,
        status: 'active',
      };

      if (existingVariant) {
        await updateVariant(storeId, existingVariant.id, variantInput);
        result.variantsUpdated += 1;
      } else {
        await createVariant(storeId, productId, variantInput);
        result.variantsCreated += 1;
      }

      if (productCreated) result.productsCreated += 1;
      if (productUpdated) result.productsUpdated += 1;

      // Bookkeeping: cache the (slug -> id) lookup for follow-up rows that
      // share the same parent — only meaningful when we hit the slug branch.
      if (productId && row.product_slug && !productSlugCache.has(row.product_slug)) {
        productSlugCache.set(row.product_slug, productId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push({ row: rowNumber, sku: row.sku, message });
    }
  }

  // TODO(SP-6): persist `result` to a dedicated csv_import_runs table so the
  // admin UI can render historical runs. For now we log a structured summary
  // — operators can grep by jobId.
  logger.info(
    {
      jobId: job.id,
      storeId,
      userId,
      ...result,
      // Cap the error list in the log line to avoid blowing up the JSON.
      errors: result.errors.slice(0, 20),
      errorsTruncated: result.errors.length > 20,
    },
    'csv-import complete',
  );

  return result;
}
