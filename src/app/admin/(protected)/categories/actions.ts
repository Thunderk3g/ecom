'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../_lib/context';
import {
  createCategory,
  updateCategory,
  deleteCategory,
} from '@/modules/catalog/categories';

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unexpected error';
}

export type CategoryInput = {
  slug: string;
  name: string;
  parentId?: string;
  description?: string;
  sortOrder: number;
  published: boolean;
};

export async function createCategoryAction(
  input: CategoryInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireAdmin('catalog:write');
    const row = await createCategory(ctx.storeId, {
      slug: input.slug,
      name: input.name,
      parentId: input.parentId || null,
      description: input.description || null,
      sortOrder: input.sortOrder,
      published: input.published,
    });
    revalidatePath('/admin/categories');
    return { ok: true, data: { id: row.id } };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

export async function updateCategoryAction(
  id: string,
  input: CategoryInput,
): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin('catalog:write');
    await updateCategory(ctx.storeId, id, {
      slug: input.slug,
      name: input.name,
      parentId: input.parentId || null,
      description: input.description || null,
      sortOrder: input.sortOrder,
      published: input.published,
    });
    revalidatePath('/admin/categories');
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

export async function deleteCategoryAction(id: string): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin('catalog:write');
    await deleteCategory(ctx.storeId, id, { blockIfProductsExist: true });
    revalidatePath('/admin/categories');
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}
