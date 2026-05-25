import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withTenant } from '@/modules/tenant/with-tenant';
import { attributeDefinitions, products } from '@/db/schema/catalog';
import {
  AttributeNotFoundError,
  AttributeKeyConflictError,
  AttributeValidationError,
  AttributeInUseError,
  type AttributeValidationIssue,
} from './errors';

export type AttributeDefinitionRow = typeof attributeDefinitions.$inferSelect;

export type AttributeDataType = AttributeDefinitionRow['dataType'];

export type DefineAttributeInput = {
  key: string;
  label: string;
  dataType: AttributeDataType;
  unit?: string | null;
  enumValues?: string[] | null;
  filterable?: boolean;
  required?: boolean;
};

export type UpdateAttributeInput = Partial<Omit<DefineAttributeInput, 'key'>>;

export type ListAttributesOptions = {
  filterableOnly?: boolean;
};

export async function listAttributes(
  storeId: string,
  opts: ListAttributesOptions = {},
): Promise<AttributeDefinitionRow[]> {
  return withTenant(storeId, async tx => {
    const where = opts.filterableOnly ? eq(attributeDefinitions.filterable, true) : undefined;
    const query = tx.select().from(attributeDefinitions);
    const rows = where ? await query.where(where) : await query;
    rows.sort((a, b) => a.label.localeCompare(b.label));
    return rows;
  });
}

export async function getAttributeById(
  storeId: string,
  id: string,
): Promise<AttributeDefinitionRow | null> {
  return withTenant(storeId, async tx => {
    const rows = await tx
      .select()
      .from(attributeDefinitions)
      .where(eq(attributeDefinitions.id, id))
      .limit(1);
    return rows[0] ?? null;
  });
}

export async function defineAttribute(
  storeId: string,
  input: DefineAttributeInput,
): Promise<AttributeDefinitionRow> {
  return withTenant(storeId, async tx => {
    const existing = await tx
      .select({ id: attributeDefinitions.id })
      .from(attributeDefinitions)
      .where(eq(attributeDefinitions.key, input.key))
      .limit(1);
    if (existing[0]) throw new AttributeKeyConflictError(input.key);

    if (input.dataType === 'enum' && (!input.enumValues || input.enumValues.length === 0)) {
      throw new AttributeValidationError([
        { path: ['enumValues'], message: "enumValues required when dataType is 'enum'" },
      ]);
    }

    const inserted = await tx
      .insert(attributeDefinitions)
      .values({
        storeId,
        key: input.key,
        label: input.label,
        dataType: input.dataType,
        unit: input.unit ?? null,
        enumValues: input.enumValues ?? null,
        filterable: input.filterable ?? false,
        required: input.required ?? false,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('defineAttribute: insert returned no row');
    return row;
  });
}

export async function updateAttribute(
  storeId: string,
  id: string,
  patch: UpdateAttributeInput,
): Promise<AttributeDefinitionRow> {
  return withTenant(storeId, async tx => {
    const current = await tx
      .select()
      .from(attributeDefinitions)
      .where(eq(attributeDefinitions.id, id))
      .limit(1);
    if (!current[0]) throw new AttributeNotFoundError(id);

    if (
      patch.dataType === 'enum' &&
      patch.enumValues !== undefined &&
      patch.enumValues !== null &&
      patch.enumValues.length === 0
    ) {
      throw new AttributeValidationError([
        { path: ['enumValues'], message: "enumValues must be non-empty for dataType 'enum'" },
      ]);
    }

    const updated = await tx
      .update(attributeDefinitions)
      .set({
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.dataType !== undefined ? { dataType: patch.dataType } : {}),
        ...(patch.unit !== undefined ? { unit: patch.unit } : {}),
        ...(patch.enumValues !== undefined ? { enumValues: patch.enumValues } : {}),
        ...(patch.filterable !== undefined ? { filterable: patch.filterable } : {}),
        ...(patch.required !== undefined ? { required: patch.required } : {}),
      })
      .where(eq(attributeDefinitions.id, id))
      .returning();
    const row = updated[0];
    if (!row) throw new AttributeNotFoundError(id);
    return row;
  });
}

export async function deleteAttribute(
  storeId: string,
  id: string,
  opts: { blockIfProductsUseIt?: boolean } = {},
): Promise<void> {
  await withTenant(storeId, async tx => {
    const current = await tx
      .select()
      .from(attributeDefinitions)
      .where(eq(attributeDefinitions.id, id))
      .limit(1);
    if (!current[0]) throw new AttributeNotFoundError(id);

    if (opts.blockIfProductsUseIt) {
      // Count products whose `attributes` jsonb contains this key.
      const key = current[0].key;
      const countRows = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(products)
        .where(
          and(
            sql`${products.attributes} ? ${key}`,
            sql`${products.deletedAt} IS NULL`,
          ),
        );
      const count = countRows[0]?.count ?? 0;
      if (count > 0) throw new AttributeInUseError(key, count);
    }

    await tx.delete(attributeDefinitions).where(eq(attributeDefinitions.id, id));
  });
}

/**
 * Build a zod schema for the `attributes` jsonb field of a product. Returns
 * `z.object({ ... })` with one entry per registered attribute. Required
 * attributes are required keys; others are optional. Validation maps directly
 * onto `AttributeValidationError` issues at the call site.
 *
 * Unknown keys (i.e. attributes posted that aren't registered) are stripped
 * via .strict() — they raise an error.
 */
export async function buildProductAttributeSchema(
  storeId: string,
): Promise<z.ZodType<Record<string, unknown>>> {
  const defs = await listAttributes(storeId);
  return buildSchemaFromDefinitions(defs);
}

export function buildSchemaFromDefinitions(
  defs: AttributeDefinitionRow[],
): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const def of defs) {
    let leaf: z.ZodTypeAny;
    switch (def.dataType) {
      case 'string':
        leaf = z.string();
        break;
      case 'number':
        leaf = z.number();
        break;
      case 'bool':
        leaf = z.boolean();
        break;
      case 'enum': {
        const values = def.enumValues ?? [];
        if (values.length === 0) {
          // Invalid definition; surface a permissive schema rather than crashing
          // and let the validation step report a domain error.
          leaf = z.never();
        } else {
          const [head, ...rest] = values;
          // z.enum requires a tuple of literals.
          leaf = z.enum([head!, ...rest] as [string, ...string[]]);
        }
        break;
      }
    }
    shape[def.key] = def.required ? leaf : leaf.optional();
  }
  return z.object(shape).strict() as unknown as z.ZodType<Record<string, unknown>>;
}

/**
 * Validate a product `attributes` object against the registry. Throws
 * AttributeValidationError when invalid. Returns the parsed (and possibly
 * coerced) value when valid.
 */
export async function validateProductAttributes(
  storeId: string,
  attributes: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const schema = await buildProductAttributeSchema(storeId);
  const parsed = schema.safeParse(attributes);
  if (parsed.success) return parsed.data;
  const issues: AttributeValidationIssue[] = parsed.error.issues.map(i => ({
    path: i.path.map(p => (typeof p === 'symbol' ? String(p) : p)),
    message: i.message,
  }));
  throw new AttributeValidationError(issues);
}
