'use server';

import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdmin } from '../_lib/context';
import { withTenant } from '@/modules/tenant/with-tenant';
import { siteConfig as siteConfigTable } from '@/db/schema/config';
import { invalidateSiteConfigCache, loadSiteConfig } from '@/modules/config/loader';
import type { SiteConfig } from '@/platform.defaults';

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Unexpected error';
}

/**
 * DeepPartial — the patch shape accepted by updateSiteConfigAction. The Server
 * Action validates the partial against `siteConfigPatchSchema` before merging
 * into the persisted JSON; unknown top-level keys are rejected (strict).
 */
export type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;

// ─── Validation ────────────────────────────────────────────────────────────
// Mirrors the shape of `platformDefaults` from src/platform.defaults.ts. Each
// branch is strict (rejects unknown fields) so a typo in the form payload
// surfaces as a validation error rather than silently expanding site_config.

const colorHex = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/u, 'must be a #rgb or #rrggbb color');

const brandPatch = z
  .object({
    name: z.string().min(1).max(120).optional(),
    tagline: z.string().max(240).optional(),
    logoAssetId: z.string().max(120).optional(),
    supportEmail: z.string().email().optional().or(z.literal('')),
    supportPhone: z.string().max(40).optional(),
  })
  .strict();

const themePatch = z
  .object({
    color: z
      .object({
        bg: colorHex.optional(),
        fg: colorHex.optional(),
        primary: colorHex.optional(),
        secondary: colorHex.optional(),
      })
      .strict()
      .optional(),
    type: z
      .object({
        sans: z.string().min(1).max(80).optional(),
        serif: z.string().min(1).max(80).optional(),
      })
      .strict()
      .optional(),
    radius: z.string().min(1).max(20).optional(),
    spacingScale: z.number().min(0.5).max(2).optional(),
  })
  .strict();

const localePatch = z
  .object({
    default: z.string().min(2).max(10).optional(),
    supported: z.array(z.string().min(2).max(10)).min(1).optional(),
  })
  .strict();

const currencyPatch = z
  .object({
    code: z.string().min(3).max(3).optional(),
    symbol: z.string().min(1).max(4).optional(),
    rounding: z.string().min(1).max(10).optional(),
  })
  .strict();

const featuresPatch = z.record(z.string(), z.boolean());

export const siteConfigPatchSchema = z
  .object({
    brand: brandPatch.optional(),
    theme: themePatch.optional(),
    locale: localePatch.optional(),
    currency: currencyPatch.optional(),
    features: featuresPatch.optional(),
  })
  .strict();

export type SiteConfigPatch = z.infer<typeof siteConfigPatchSchema>;

// ─── Deep merge ────────────────────────────────────────────────────────────
// Mirrors the loader's merge semantics so the persisted JSON ends up shaped
// like the runtime SiteConfig.

function deepMerge<T>(base: T, patch: DeepPartial<T>): T {
  if (typeof base !== 'object' || base === null) return (patch as T) ?? base;
  const out = (Array.isArray(base) ? [...(base as unknown[])] : { ...(base as object) }) as Record<
    string,
    unknown
  >;
  for (const [k, v] of Object.entries((patch ?? {}) as Record<string, unknown>)) {
    const current = (base as Record<string, unknown>)[k];
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      current &&
      typeof current === 'object' &&
      !Array.isArray(current)
    ) {
      out[k] = deepMerge(current, v as DeepPartial<typeof current>);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

// ─── Action ────────────────────────────────────────────────────────────────

/**
 * Persist a partial SiteConfig patch for the current tenant. Validates the
 * patch against the canonical schema, merges it onto the row's current
 * jsonb config (additive — fields not present in the patch are preserved),
 * writes back via withTenant (RLS), busts the Redis loader cache, and
 * revalidates the root layout so the SSR theme injection picks up new
 * theme/brand values on the next request.
 *
 * The accepted shape is the zod-inferred `SiteConfigPatch`. A
 * `DeepPartial<SiteConfig>` alias is accepted too, but note that
 * `platformDefaults` is declared `as const`, so its DeepPartial carries
 * literal types unsuitable for user-supplied form strings. Prefer
 * `SiteConfigPatch` at call sites.
 */
export async function updateSiteConfigAction(
  patch: SiteConfigPatch | DeepPartial<SiteConfig>,
): Promise<ActionResult<{ updatedAt: string }>> {
  try {
    const ctx = await requireAdmin('settings:write');

    const parsed = siteConfigPatchSchema.safeParse(patch);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map(issue => {
          const path = issue.path.length ? issue.path.join('.') : '(root)';
          return `${path}: ${issue.message}`;
        })
        .join('; ');
      return { ok: false, error: `Invalid settings: ${message}` };
    }

    const sanitized = sanitizeBrand(parsed.data);

    const updatedAt = await withTenant(ctx.storeId, async tx => {
      // Read the existing row (if any) so the merge preserves keys outside
      // the current patch surface (e.g. `inventory`, future feature blocks).
      const [existing] = await tx
        .select({ config: siteConfigTable.config })
        .from(siteConfigTable)
        .where(eq(siteConfigTable.storeId, ctx.storeId))
        .limit(1);

      const current = (existing?.config ?? {}) as Record<string, unknown>;
      const next = deepMerge(current, sanitized as DeepPartial<Record<string, unknown>>);

      const [row] = await tx
        .insert(siteConfigTable)
        .values({
          storeId: ctx.storeId,
          config: next,
          updatedBy: ctx.session.userId,
        })
        .onConflictDoUpdate({
          target: siteConfigTable.storeId,
          set: {
            config: next,
            updatedBy: ctx.session.userId,
            updatedAt: sql`now()`,
          },
        })
        .returning({ updatedAt: siteConfigTable.updatedAt });

      if (!row) throw new Error('site_config upsert returned no row');
      return row.updatedAt.toISOString();
    });

    // Bust the loader's Redis cache so the next page render sees fresh config.
    await invalidateSiteConfigCache(ctx.storeId);

    // Theme injection lives in the root layout; revalidate it so SSR picks up
    // the new CSS variables (and any other config-dependent server reads).
    revalidatePath('/', 'layout');
    revalidatePath('/admin/settings');

    return { ok: true, data: { updatedAt } };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

/**
 * Server-rendered initial values for the Settings tabs. Returns the merged
 * runtime SiteConfig (defaults + persisted overrides + env overrides) so the
 * form mirrors what the storefront/admin actually see today.
 */
export async function getSiteConfigForSettings(): Promise<SiteConfig> {
  const ctx = await requireAdmin('settings:read');
  return loadSiteConfig(ctx.storeId);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Coerce empty strings on optional brand fields to undefined so they don't
 * overwrite stored values with the empty string. (Treating "" as "clear" would
 * collide with the optional() guards; leaving the field out is the correct
 * way to leave it unchanged.)
 */
function sanitizeBrand(patch: SiteConfigPatch): SiteConfigPatch {
  if (!patch.brand) return patch;
  const b = { ...patch.brand };
  for (const k of ['logoAssetId', 'supportEmail', 'supportPhone', 'tagline'] as const) {
    if (b[k] === '') delete b[k];
  }
  return { ...patch, brand: b };
}
