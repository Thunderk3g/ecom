'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../_lib/context';
import {
  defineAttribute,
  updateAttribute,
  deleteAttribute,
  type AttributeDataType,
} from '@/modules/catalog/attributes';

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unexpected error';
}

export type AttributeInput = {
  key: string;
  label: string;
  dataType: AttributeDataType;
  unit?: string;
  enumValues?: string[];
  filterable: boolean;
  required: boolean;
};

export async function createAttributeAction(
  input: AttributeInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireAdmin('catalog:write');
    const row = await defineAttribute(ctx.storeId, {
      key: input.key,
      label: input.label,
      dataType: input.dataType,
      unit: input.unit || null,
      enumValues: input.dataType === 'enum' ? (input.enumValues ?? []) : null,
      filterable: input.filterable,
      required: input.required,
    });
    revalidatePath('/admin/attributes');
    return { ok: true, data: { id: row.id } };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

export async function updateAttributeAction(
  id: string,
  input: AttributeInput,
): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin('catalog:write');
    await updateAttribute(ctx.storeId, id, {
      label: input.label,
      dataType: input.dataType,
      unit: input.unit || null,
      enumValues: input.dataType === 'enum' ? (input.enumValues ?? []) : null,
      filterable: input.filterable,
      required: input.required,
    });
    revalidatePath('/admin/attributes');
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

export async function deleteAttributeAction(id: string): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin('catalog:write');
    await deleteAttribute(ctx.storeId, id, { blockIfProductsUseIt: true });
    revalidatePath('/admin/attributes');
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}
