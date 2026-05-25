import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { migratorDb, migratorClient } from './client';
import { stores, storeDomains } from './schema/tenancy';
import { users, storeUsers } from './schema/identity';
import { siteConfig } from './schema/config';
import {
  categories, attributeDefinitions, products, productVariants, bundleComponents,
} from './schema/catalog';
import {
  locations, stockMovements, stockThresholds, suppliers, supplierSkus,
  purchaseOrders, purchaseOrderItems,
} from './schema/inventory';
import { contentPages, contentVersions, navigationMenus } from './schema/cms';
import { hashPassword } from '@/modules/auth/password';
import { logger } from '@/lib/logger';

async function main() {
  logger.info('seeding example store…');

  const [store] = await migratorDb.insert(stores)
    .values({ slug: 'inkwell', name: 'Inkwell & Co' })
    .returning({ id: stores.id });
  const storeId = store!.id;

  await migratorDb.insert(storeDomains).values([
    { storeId, domain: 'localhost', isPrimary: true },
    { storeId, domain: 'inkwell.localhost', isPrimary: false },
  ]);

  const [admin] = await migratorDb.insert(users)
    .values({ email: 'admin@inkwell.test', passwordHash: await hashPassword('admin1234') })
    .returning({ id: users.id });
  const adminId = admin!.id;

  await migratorDb.insert(storeUsers).values({
    storeId, userId: adminId, role: 'owner', permissions: ['*'],
  });

  await migratorDb.insert(siteConfig).values({
    storeId,
    config: {
      brand: { name: 'Inkwell & Co', tagline: 'Paper goods, properly.' },
      theme: { color: { primary: '#2C3E8C' } },
      inventory: { pooled_availability: false, reservation_ttl_minutes: 15 },
    },
    updatedBy: adminId,
  });

  // ── Catalog: categories ────────────────────────────────────────────
  const categoryRows = await migratorDb.insert(categories).values([
    { storeId, slug: 'notebooks', name: 'Notebooks', sortOrder: 1 },
    { storeId, slug: 'pens-writing', name: 'Pens & Writing', sortOrder: 2 },
    { storeId, slug: 'art-supplies', name: 'Art Supplies', sortOrder: 3 },
    { storeId, slug: 'office-supplies', name: 'Office Supplies', sortOrder: 4 },
    { storeId, slug: 'school-supplies', name: 'School Supplies', sortOrder: 5 },
    { storeId, slug: 'paper-stationery', name: 'Paper & Stationery', sortOrder: 6 },
    { storeId, slug: 'bags-cases', name: 'Bags & Cases', sortOrder: 7 },
    { storeId, slug: 'gifting', name: 'Gifting', sortOrder: 8 },
  ]).returning({ id: categories.id, slug: categories.slug });
  const catBy = (slug: string) => categoryRows.find(c => c.slug === slug)!.id;

  // ── Catalog: attribute definitions ─────────────────────────────────
  await migratorDb.insert(attributeDefinitions).values([
    { storeId, key: 'brand', label: 'Brand', dataType: 'string', filterable: true, required: false },
    { storeId, key: 'ruling', label: 'Ruling', dataType: 'enum', enumValues: ['plain', 'ruled', 'grid', 'dotted'], filterable: true, required: false },
    { storeId, key: 'gsm', label: 'Paper GSM', dataType: 'number', unit: 'gsm', filterable: true, required: false },
    { storeId, key: 'ink_type', label: 'Ink type', dataType: 'enum', enumValues: ['ballpoint', 'gel', 'rollerball', 'fountain'], filterable: true, required: false },
    { storeId, key: 'tip_size', label: 'Tip size', dataType: 'enum', enumValues: ['0.3mm', '0.5mm', '0.7mm', '1.0mm'], filterable: true, required: false },
    { storeId, key: 'color', label: 'Color', dataType: 'string', filterable: true, required: false },
  ]);

  // ── Catalog: products + variants ───────────────────────────────────
  type ProductSeed = {
    slug: string; name: string; categoryId: string; brand: string;
    attributes: Record<string, unknown>;
    variants: { sku: string; axes: Record<string, string | number>; priceCents: number }[];
  };
  const seedProducts: ProductSeed[] = [
    { slug: 'classic-a5-notebook', name: 'Classic A5 Notebook', categoryId: catBy('notebooks'), brand: 'Inkwell', attributes: { ruling: 'ruled', gsm: 80 }, variants: [
      { sku: 'NB-INK-CLA-A5-BLU', axes: { size: 'A5', color: 'blue' }, priceCents: 24900 },
      { sku: 'NB-INK-CLA-A5-BLK', axes: { size: 'A5', color: 'black' }, priceCents: 24900 },
    ]},
    { slug: 'classic-a4-notebook', name: 'Classic A4 Notebook', categoryId: catBy('notebooks'), brand: 'Inkwell', attributes: { ruling: 'ruled', gsm: 80 }, variants: [
      { sku: 'NB-INK-CLA-A4-BLU', axes: { size: 'A4', color: 'blue' }, priceCents: 34900 },
    ]},
    { slug: 'dotted-journal-a5', name: 'Dotted Journal A5', categoryId: catBy('notebooks'), brand: 'Leuchtwerk', attributes: { ruling: 'dotted', gsm: 100 }, variants: [
      { sku: 'NB-LCH-DOT-A5-GRY', axes: { size: 'A5', color: 'grey' }, priceCents: 49900 },
    ]},
    { slug: 'gel-pen-v5', name: 'V5 Gel Pen', categoryId: catBy('pens-writing'), brand: 'Pilot', attributes: { ink_type: 'gel', tip_size: '0.5mm' }, variants: [
      { sku: 'PEN-PLT-V5-05-BLU', axes: { color: 'blue', pack: 1 }, priceCents: 8900 },
      { sku: 'PEN-PLT-V5-05-BLK', axes: { color: 'black', pack: 1 }, priceCents: 8900 },
      { sku: 'PEN-PLT-V5-05-BLU-P5', axes: { color: 'blue', pack: 5 }, priceCents: 39900 },
    ]},
    { slug: 'rollerball-classic', name: 'Classic Rollerball', categoryId: catBy('pens-writing'), brand: 'Uniball', attributes: { ink_type: 'rollerball', tip_size: '0.7mm' }, variants: [
      { sku: 'PEN-UNI-CLA-07-BLK', axes: { color: 'black', pack: 1 }, priceCents: 12900 },
    ]},
    { slug: 'fountain-pen-starter', name: 'Fountain Pen Starter', categoryId: catBy('pens-writing'), brand: 'Lamy', attributes: { ink_type: 'fountain' }, variants: [
      { sku: 'PEN-LMY-FPS-MED', axes: { nib: 'medium' }, priceCents: 199900 },
    ]},
    { slug: 'watercolor-set-12', name: 'Watercolor Set 12', categoryId: catBy('art-supplies'), brand: 'Camlin', attributes: {}, variants: [
      { sku: 'ART-CAM-WAT-12', axes: { piece_count: 12 }, priceCents: 79900 },
    ]},
    { slug: 'sketchbook-a4', name: 'Hardbound Sketchbook A4', categoryId: catBy('art-supplies'), brand: 'Strathmore', attributes: { gsm: 200 }, variants: [
      { sku: 'ART-STR-SKB-A4', axes: { size: 'A4' }, priceCents: 89900 },
    ]},
    { slug: 'sticky-notes-pack', name: 'Sticky Notes Mega Pack', categoryId: catBy('office-supplies'), brand: 'PostIt', attributes: {}, variants: [
      { sku: 'OFF-PIT-STK-MEG', axes: { pack: 12 }, priceCents: 29900 },
    ]},
    { slug: 'paper-clips-jar', name: 'Paper Clips Jar', categoryId: catBy('office-supplies'), brand: 'Inkwell', attributes: {}, variants: [
      { sku: 'OFF-INK-CLP-JAR', axes: { count: 500 }, priceCents: 9900 },
    ]},
  ];

  const variantBySku = new Map<string, string>();
  for (const p of seedProducts) {
    const [prod] = await migratorDb.insert(products).values({
      storeId, slug: p.slug, name: p.name, brand: p.brand, categoryId: p.categoryId,
      status: 'active', attributes: p.attributes, publishedAt: new Date(),
    }).returning({ id: products.id });
    for (const v of p.variants) {
      const [vr] = await migratorDb.insert(productVariants).values({
        productId: prod!.id, storeId, sku: v.sku, axes: v.axes, priceCents: v.priceCents, status: 'active',
      }).returning({ id: productVariants.id });
      variantBySku.set(v.sku, vr!.id);
    }
  }

  // ── Catalog: bundle product ────────────────────────────────────────
  const [bundle] = await migratorDb.insert(products).values({
    storeId, slug: 'back-to-school-starter', name: 'Back-to-School Starter Kit',
    type: 'bundle', status: 'active', brand: 'Inkwell', categoryId: catBy('school-supplies'),
    attributes: {}, publishedAt: new Date(),
  }).returning({ id: products.id });
  const [bundleVar] = await migratorDb.insert(productVariants).values({
    productId: bundle!.id, storeId, sku: 'BUN-INK-B2S-KIT', axes: {}, priceCents: 99900, status: 'active',
  }).returning({ id: productVariants.id });
  await migratorDb.insert(bundleComponents).values([
    { bundleVariantId: bundleVar!.id, componentVariantId: variantBySku.get('NB-INK-CLA-A5-BLU')!, qty: 2 },
    { bundleVariantId: bundleVar!.id, componentVariantId: variantBySku.get('PEN-PLT-V5-05-BLU')!, qty: 3 },
    { bundleVariantId: bundleVar!.id, componentVariantId: variantBySku.get('OFF-INK-CLP-JAR')!, qty: 1 },
  ]);

  // ── Inventory: default location + opening stock ───────────────────
  const [loc] = await migratorDb.insert(locations).values({
    storeId, code: 'default-warehouse', name: 'Default Warehouse', type: 'warehouse',
  }).returning({ id: locations.id });
  const locId = loc!.id;

  for (const variantId of variantBySku.values()) {
    await migratorDb.insert(stockMovements).values({
      storeId, variantId, locationId: locId,
      qty: 20, kind: 'inbound', reason: 'opening_stock', createdBy: adminId,
    });
    await migratorDb.insert(stockThresholds).values({
      storeId, variantId, locationId: locId, reorderPoint: 5, reorderQty: 50,
    });
  }

  // ── Inventory: supplier + a received PO ────────────────────────────
  const [supplier] = await migratorDb.insert(suppliers).values({
    storeId, name: 'Acme Stationery Supplies', contact: { email: 'orders@acme-stationery.test' }, leadTimeDays: 7,
  }).returning({ id: suppliers.id });

  const skuPicks = ['NB-INK-CLA-A5-BLU', 'PEN-PLT-V5-05-BLK', 'OFF-INK-CLP-JAR'];
  for (const sku of skuPicks) {
    await migratorDb.insert(supplierSkus).values({
      supplierId: supplier!.id, variantId: variantBySku.get(sku)!, storeId,
      supplierSku: `ACME-${sku}`, costCents: 5000, moq: 50,
    });
  }
  const [po] = await migratorDb.insert(purchaseOrders).values({
    storeId, supplierId: supplier!.id, status: 'received',
    placedAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
    expectedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  }).returning({ id: purchaseOrders.id });
  for (const sku of skuPicks) {
    await migratorDb.insert(purchaseOrderItems).values({
      poId: po!.id, variantId: variantBySku.get(sku)!,
      qtyOrdered: 50, qtyReceived: 50, costCents: 5000,
    });
  }

  // ── CMS: homepage content page + published version ─────────────────
  // Idempotent: skip if a homepage already exists for this store. The page
  // points at a published version carrying hero + featured-categories +
  // product-grid blocks. Each block is { kind, props } per the block registry.
  const existingHome = await migratorDb
    .select({ id: contentPages.id })
    .from(contentPages)
    .where(and(eq(contentPages.storeId, storeId), eq(contentPages.slug, 'home')))
    .limit(1);

  if (!existingHome[0]) {
    const [homePage] = await migratorDb.insert(contentPages).values({
      storeId, slug: 'home', title: 'Home', status: 'draft',
    }).returning({ id: contentPages.id });
    const homePageId = homePage!.id;

    const homeBlocks = [
      {
        kind: 'hero',
        props: {
          title: 'Paper goods, properly.',
          subtitle: 'Notebooks, pens, and desk essentials for people who care about the details.',
          cta: { label: 'Shop notebooks', href: '/c/notebooks' },
        },
      },
      {
        kind: 'featured-categories',
        props: {
          heading: 'Shop by category',
          categorySlugs: ['notebooks', 'pens-writing', 'art-supplies', 'office-supplies'],
        },
      },
      {
        kind: 'product-grid',
        props: {
          heading: 'Featured products',
          collectionSlug: 'notebooks',
          limit: 8,
          layout: 'grid',
        },
      },
    ];

    const [homeVersion] = await migratorDb.insert(contentVersions).values({
      storeId, pageId: homePageId, blocks: homeBlocks,
      seo: { title: 'Inkwell & Co — Paper goods, properly.', description: 'Stationery for people who care about the details.' },
      createdBy: adminId,
    }).returning({ id: contentVersions.id });

    await migratorDb.update(contentPages)
      .set({
        draftVersionId: homeVersion!.id,
        publishedVersionId: homeVersion!.id,
        status: 'published',
      })
      .where(eq(contentPages.id, homePageId));
  }

  // ── CMS: header + footer navigation menus ──────────────────────────
  await migratorDb.insert(navigationMenus).values([
    {
      storeId, slot: 'header', items: [
        { label: 'Notebooks', href: '/c/notebooks' },
        { label: 'Pens & Writing', href: '/c/pens-writing' },
        { label: 'Art Supplies', href: '/c/art-supplies' },
        { label: 'Office', href: '/c/office-supplies' },
        { label: 'Gifting', href: '/c/gifting' },
      ],
    },
    {
      storeId, slot: 'footer', items: [
        {
          label: 'Shop', children: [
            { label: 'Notebooks', href: '/c/notebooks' },
            { label: 'Pens & Writing', href: '/c/pens-writing' },
          ],
        },
        {
          label: 'Company', children: [
            { label: 'About', href: '/pages/about' },
            { label: 'Contact', href: '/pages/contact' },
          ],
        },
      ],
    },
  ]).onConflictDoNothing({ target: [navigationMenus.storeId, navigationMenus.slot] });

  logger.info({ storeId, adminId, products: seedProducts.length + 1, variants: variantBySku.size + 1 }, 'seed complete');
  await migratorClient.end();
}

main().catch(async err => {
  logger.error({ err }, 'seed failed');
  await migratorClient.end();
  process.exit(1);
});
