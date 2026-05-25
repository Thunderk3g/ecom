'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../_lib/context';
import {
  createProduct,
  updateProduct,
  softDeleteProduct,
  type ProductStatus,
  type ProductType,
} from '@/modules/catalog/products';
import {
  createVariant,
  updateVariant,
  deleteVariant,
} from '@/modules/catalog/variants';

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Unexpected error';
}

export type ProductBasicsInput = {
  slug: string;
  name: string;
  descriptionMd?: string;
  brand?: string;
  categoryId?: string;
  type: ProductType;
  status: ProductStatus;
  seoTitle?: string;
  seoDescription?: string;
};

export async function createProductAction(
  input: ProductBasicsInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireAdmin('catalog:write');
    const row = await createProduct(ctx.storeId, {
      slug: input.slug,
      name: input.name,
      descriptionMd: input.descriptionMd || null,
      brand: input.brand || null,
      categoryId: input.categoryId || null,
      type: input.type,
      status: input.status,
      seo:
        input.seoTitle || input.seoDescription
          ? { title: input.seoTitle, description: input.seoDescription }
          : null,
    });
    revalidatePath('/admin/products');
    return { ok: true, data: { id: row.id } };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

export async function updateProductAction(
  id: string,
  input: ProductBasicsInput,
): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin('catalog:write');
    await updateProduct(ctx.storeId, id, {
      slug: input.slug,
      name: input.name,
      descriptionMd: input.descriptionMd || null,
      brand: input.brand || null,
      categoryId: input.categoryId || null,
      type: input.type,
      status: input.status,
      seo:
        input.seoTitle || input.seoDescription
          ? { title: input.seoTitle, description: input.seoDescription }
          : null,
    });
    revalidatePath('/admin/products');
    revalidatePath(`/admin/products/${id}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

export async function deleteProductAction(id: string): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin('catalog:write');
    await softDeleteProduct(ctx.storeId, id);
    revalidatePath('/admin/products');
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

export type VariantInput = {
  sku: string;
  name?: string;
  priceCents: number;
  compareAtCents?: number | null;
  status: 'draft' | 'active' | 'archived';
};

export async function createVariantAction(
  productId: string,
  input: VariantInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireAdmin('catalog:write');
    const row = await createVariant(ctx.storeId, productId, {
      sku: input.sku,
      name: input.name || null,
      priceCents: input.priceCents,
      compareAtCents: input.compareAtCents ?? null,
      status: input.status,
    });
    revalidatePath(`/admin/products/${productId}`);
    return { ok: true, data: { id: row.id } };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

export async function updateVariantAction(
  productId: string,
  variantId: string,
  input: VariantInput,
): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin('catalog:write');
    await updateVariant(ctx.storeId, variantId, {
      sku: input.sku,
      name: input.name || null,
      priceCents: input.priceCents,
      compareAtCents: input.compareAtCents ?? null,
      status: input.status,
    });
    revalidatePath(`/admin/products/${productId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

export async function deleteVariantAction(
  productId: string,
  variantId: string,
): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin('catalog:write');
    await deleteVariant(ctx.storeId, variantId);
    revalidatePath(`/admin/products/${productId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}
