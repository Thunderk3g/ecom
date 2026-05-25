'use server';

import { revalidatePath } from 'next/cache';
import {
  createPage,
  updateDraft,
  publishPage,
  unpublishPage,
  deletePage,
} from '@/modules/cms/pages';
import { upsertMenu, type NavSlot } from '@/modules/cms/navigation';
import {
  BlockValidationError,
  PageNotFoundError,
  SlugConflictError,
  VersionNotFoundError,
} from '@/modules/cms/errors';
import { getCmsAdminContext, assertPermission, AdminContextError } from './admin-context';

export interface ActionResult {
  ok: boolean;
  error?: string;
  /** Set on createPage so the client can navigate to the editor. */
  pageId?: string;
}

function toError(err: unknown): ActionResult {
  if (err instanceof AdminContextError) return { ok: false, error: err.message };
  if (err instanceof SlugConflictError) return { ok: false, error: `Slug "${err.slug}" is already in use.` };
  if (err instanceof PageNotFoundError) return { ok: false, error: 'Page not found.' };
  if (err instanceof VersionNotFoundError) return { ok: false, error: 'There is nothing to publish yet.' };
  if (err instanceof BlockValidationError) {
    return { ok: false, error: `Block validation failed: ${err.issues.join('; ')}` };
  }
  return { ok: false, error: 'Something went wrong. Please try again.' };
}

export async function createPageAction(input: { slug: string; title: string }): Promise<ActionResult> {
  const slug = input.slug.trim().toLowerCase();
  const title = input.title.trim();
  if (!slug) return { ok: false, error: 'Slug is required.' };
  if (!title) return { ok: false, error: 'Title is required.' };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return { ok: false, error: 'Slug must be lowercase letters, numbers, and hyphens.' };
  }
  try {
    const ctx = await getCmsAdminContext();
    assertPermission(ctx, 'cms:write');
    const created = await createPage(ctx.storeId, { slug, title, createdBy: ctx.userId });
    revalidatePath('/admin/cms/pages');
    return { ok: true, pageId: created.page.id };
  } catch (err) {
    return toError(err);
  }
}

export async function saveDraftAction(input: {
  pageId: string;
  title?: string;
  blocks: unknown[];
  seo?: { title?: string; description?: string; keywords?: string[] } | null;
}): Promise<ActionResult> {
  try {
    const ctx = await getCmsAdminContext();
    assertPermission(ctx, 'cms:write');
    await updateDraft(ctx.storeId, input.pageId, {
      blocks: input.blocks,
      title: input.title,
      seo: input.seo ?? null,
      createdBy: ctx.userId,
    });
    revalidatePath(`/admin/cms/pages/${input.pageId}`);
    revalidatePath('/admin/cms/pages');
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function publishPageAction(pageId: string): Promise<ActionResult> {
  try {
    const ctx = await getCmsAdminContext();
    assertPermission(ctx, 'cms:write');
    const page = await publishPage(ctx.storeId, pageId);
    revalidatePath(`/admin/cms/pages/${pageId}`);
    revalidatePath('/admin/cms/pages');
    revalidatePath(`/pages/${page.slug}`);
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function unpublishPageAction(pageId: string): Promise<ActionResult> {
  try {
    const ctx = await getCmsAdminContext();
    assertPermission(ctx, 'cms:write');
    const page = await unpublishPage(ctx.storeId, pageId);
    revalidatePath(`/admin/cms/pages/${pageId}`);
    revalidatePath('/admin/cms/pages');
    revalidatePath(`/pages/${page.slug}`);
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function deletePageAction(pageId: string): Promise<ActionResult> {
  try {
    const ctx = await getCmsAdminContext();
    assertPermission(ctx, 'cms:write');
    await deletePage(ctx.storeId, pageId);
    revalidatePath('/admin/cms/pages');
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function saveMenuAction(slot: NavSlot, items: unknown): Promise<ActionResult> {
  try {
    const ctx = await getCmsAdminContext();
    assertPermission(ctx, 'cms:write');
    await upsertMenu(ctx.storeId, slot, items);
    revalidatePath('/admin/cms/navigation');
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}
