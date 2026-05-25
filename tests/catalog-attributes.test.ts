import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate } from './_setup/db';
import { migratorClient } from '@/db/client';
import {
  defineAttribute,
  buildProductAttributeSchema,
  listAttributes,
} from '@/modules/catalog/attributes';
import { AttributeKeyConflictError } from '@/modules/catalog/errors';

describe('catalog attribute definitions', () => {
  let storeId: string;

  beforeAll(async () => {
    await resetAndMigrate();
    await migratorClient`INSERT INTO stores (slug, name) VALUES ('attrs', 'Attrs Store')`;
    const rows = await migratorClient<{ id: string }[]>`
      SELECT id FROM stores WHERE slug = 'attrs'
    `;
    storeId = rows[0]!.id;
  });

  afterAll(async () => {
    await migratorClient.end();
  });

  it('defines attributes of each supported data type', async () => {
    const ruling = await defineAttribute(storeId, {
      key: 'ruling',
      label: 'Ruling style',
      dataType: 'enum',
      enumValues: ['ruled', 'dotted', 'plain'],
      filterable: true,
    });
    expect(ruling.dataType).toBe('enum');
    expect(ruling.enumValues).toEqual(['ruled', 'dotted', 'plain']);

    const gsm = await defineAttribute(storeId, {
      key: 'gsm',
      label: 'GSM',
      dataType: 'number',
      unit: 'g',
      filterable: true,
    });
    expect(gsm.dataType).toBe('number');

    const brand = await defineAttribute(storeId, {
      key: 'brand_label',
      label: 'Brand label',
      dataType: 'string',
    });
    expect(brand.dataType).toBe('string');

    const refillable = await defineAttribute(storeId, {
      key: 'refillable',
      label: 'Refillable',
      dataType: 'bool',
    });
    expect(refillable.dataType).toBe('bool');

    const all = await listAttributes(storeId);
    expect(all.length).toBe(4);
  });

  it('AttributeKeyConflictError on duplicate key', async () => {
    await expect(
      defineAttribute(storeId, {
        key: 'ruling',
        label: 'Duplicate ruling',
        dataType: 'string',
      }),
    ).rejects.toBeInstanceOf(AttributeKeyConflictError);
  });

  it('buildProductAttributeSchema validates string/number/bool/enum values', async () => {
    const schema = await buildProductAttributeSchema(storeId);

    // Happy path: all valid.
    const ok = schema.safeParse({
      ruling: 'ruled',
      gsm: 80,
      brand_label: 'Inkwell',
      refillable: true,
    });
    expect(ok.success).toBe(true);

    // Wrong type for number.
    const badNumber = schema.safeParse({
      gsm: 'heavy',
    });
    expect(badNumber.success).toBe(false);

    // Invalid enum value.
    const badEnum = schema.safeParse({
      ruling: 'squiggly',
    });
    expect(badEnum.success).toBe(false);

    // Wrong type for bool.
    const badBool = schema.safeParse({
      refillable: 'yes',
    });
    expect(badBool.success).toBe(false);

    // Unknown key rejected (strict schema).
    const unknown = schema.safeParse({
      ruling: 'ruled',
      unknown_key: 'whatever',
    });
    expect(unknown.success).toBe(false);

    // Empty object also ok because all attrs are optional (none required).
    const empty = schema.safeParse({});
    expect(empty.success).toBe(true);
  });
});
