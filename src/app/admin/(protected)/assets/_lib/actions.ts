'use server';

import { revalidatePath } from 'next/cache';
import { deleteAsset, attachTag, removeTag } from '@/modules/media/assets';
import { AssetInUseError, AssetNotFoundError } from '@/modules/media/errors';
import { getAssetsAdminContext, assertPermission, AdminContextError } from './admin-context';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function toError(err: unknown): ActionResult {
  if (err instanceof AdminContextError) return { ok: false, error: err.message };
  if (err instanceof AssetNotFoundError) return { ok: false, error: 'Asset not found.' };
  if (err instanceof AssetInUseError) {
    return { ok: false, error: 'This asset is referenced by a product image and cannot be deleted.' };
  }
  return { ok: false, error: 'Something went wrong. Please try again.' };
}

export async function deleteAssetAction(assetId: string): Promise<ActionResult> {
  try {
    const ctx = await getAssetsAdminContext();
    assertPermission(ctx, 'media:write');
    await deleteAsset(ctx.storeId, assetId);
    revalidatePath('/admin/assets');
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function addTagAction(assetId: string, tag: string): Promise<ActionResult> {
  const trimmed = tag.trim();
  if (!trimmed) return { ok: false, error: 'Tag cannot be empty.' };
  if (trimmed.length > 64) return { ok: false, error: 'Tag is too long.' };
  try {
    const ctx = await getAssetsAdminContext();
    assertPermission(ctx, 'media:write');
    await attachTag(ctx.storeId, assetId, trimmed);
    revalidatePath('/admin/assets');
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function removeTagAction(assetId: string, tag: string): Promise<ActionResult> {
  try {
    const ctx = await getAssetsAdminContext();
    assertPermission(ctx, 'media:write');
    await removeTag(ctx.storeId, assetId, tag);
    revalidatePath('/admin/assets');
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}
