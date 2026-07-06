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
    .values({ slug: 'mahaveer', name: 'Mahaveer Stationery and Sports' })
    .returning({ id: stores.id });
  const storeId = store!.id;

  await migratorDb.insert(storeDomains).values([
    { storeId, domain: 'localhost', isPrimary: true },
    { storeId, domain: 'mahaveer.localhost', isPrimary: false },
  ]);

  const [admin] = await migratorDb.insert(users)
    .values({ email: 'admin@mahaveer.test', passwordHash: await hashPassword('x') })
    .returning({ id: users.id });
  const adminId = admin!.id;

  await migratorDb.insert(storeUsers).values({
    storeId, userId: adminId, role: 'owner', permissions: ['*'],
  });

  await migratorDb.insert(siteConfig).values({
    storeId,
    config: {
      brand: { name: 'Mahaveer Stationery and Sports', tagline: 'Everything for school, sport & craft — under one roof.' },
      theme: { color: { primary: '#1B4D3E' } },
      inventory: { pooled_availability: false, reservation_ttl_minutes: 15 },
    },
    updatedBy: adminId,
  });

  // ── Catalog: categories (two-level tree: departments → shelves) ────
  const parentRows = await migratorDb.insert(categories).values([
    { storeId, slug: 'stationery', name: 'Stationery', sortOrder: 1 },
    { storeId, slug: 'sports', name: 'Sports', sortOrder: 2 },
    { storeId, slug: 'art-craft', name: 'Art & Craft', sortOrder: 3 },
    { storeId, slug: 'gifting', name: 'Gifting', sortOrder: 4 },
    { storeId, slug: 'general', name: 'General', sortOrder: 5 },
  ]).returning({ id: categories.id, slug: categories.slug });
  const parentBy = (slug: string) => parentRows.find(c => c.slug === slug)!.id;

  const childRows = await migratorDb.insert(categories).values([
    { storeId, parentId: parentBy('stationery'), slug: 'notebooks', name: 'Notebooks', sortOrder: 1 },
    { storeId, parentId: parentBy('stationery'), slug: 'pens-writing', name: 'Pens & Writing', sortOrder: 2 },
    { storeId, parentId: parentBy('stationery'), slug: 'office-supplies', name: 'Office Supplies', sortOrder: 3 },
    { storeId, parentId: parentBy('stationery'), slug: 'school-supplies', name: 'School Supplies', sortOrder: 4 },
    { storeId, parentId: parentBy('stationery'), slug: 'paper-stationery', name: 'Paper & Stationery', sortOrder: 5 },
    { storeId, parentId: parentBy('sports'), slug: 'cricket', name: 'Cricket', sortOrder: 1 },
    { storeId, parentId: parentBy('sports'), slug: 'badminton', name: 'Badminton', sortOrder: 2 },
    { storeId, parentId: parentBy('sports'), slug: 'fitness-outdoor', name: 'Fitness & Outdoor', sortOrder: 3 },
    { storeId, parentId: parentBy('sports'), slug: 'indoor-games', name: 'Indoor Games', sortOrder: 4 },
    { storeId, parentId: parentBy('art-craft'), slug: 'art-supplies', name: 'Art Supplies', sortOrder: 1 },
    { storeId, parentId: parentBy('art-craft'), slug: 'craft-materials', name: 'Craft Materials', sortOrder: 2 },
    { storeId, parentId: parentBy('gifting'), slug: 'gift-sets', name: 'Gift Sets', sortOrder: 1 },
    { storeId, parentId: parentBy('gifting'), slug: 'greeting-cards', name: 'Greeting Cards & Wrap', sortOrder: 2 },
    { storeId, parentId: parentBy('general'), slug: 'bags-cases', name: 'Bags & Cases', sortOrder: 1 },
    { storeId, parentId: parentBy('general'), slug: 'daily-essentials', name: 'Daily Essentials', sortOrder: 2 },
  ]).returning({ id: categories.id, slug: categories.slug });
  const catBy = (slug: string) => childRows.find(c => c.slug === slug)!.id;

  // ── Catalog: attribute definitions ─────────────────────────────────
  await migratorDb.insert(attributeDefinitions).values([
    { storeId, key: 'brand', label: 'Brand', dataType: 'string', filterable: true, required: false },
    { storeId, key: 'ruling', label: 'Ruling', dataType: 'enum', enumValues: ['plain', 'ruled', 'grid', 'dotted'], filterable: true, required: false },
    { storeId, key: 'gsm', label: 'Paper GSM', dataType: 'number', unit: 'gsm', filterable: true, required: false },
    { storeId, key: 'ink_type', label: 'Ink type', dataType: 'enum', enumValues: ['ballpoint', 'gel', 'rollerball', 'fountain'], filterable: true, required: false },
    { storeId, key: 'tip_size', label: 'Tip size', dataType: 'enum', enumValues: ['0.3mm', '0.5mm', '0.7mm', '1.0mm'], filterable: true, required: false },
    { storeId, key: 'color', label: 'Color', dataType: 'string', filterable: true, required: false },
    { storeId, key: 'material', label: 'Material', dataType: 'string', filterable: true, required: false },
    { storeId, key: 'age_group', label: 'Age group', dataType: 'enum', enumValues: ['kids', 'youth', 'adult'], filterable: true, required: false },
  ]);

  // ── Catalog: products + variants ───────────────────────────────────
  type ProductSeed = {
    slug: string; name: string; categoryId: string; brand: string;
    attributes: Record<string, unknown>;
    variants: { sku: string; axes: Record<string, string | number>; priceCents: number }[];
  };
  const seedProducts: ProductSeed[] = [
    { slug: 'classic-a5-notebook', name: 'Classic A5 Notebook', categoryId: catBy('notebooks'), brand: 'Mahaveer', attributes: { ruling: 'ruled', gsm: 80 }, variants: [
      { sku: 'NB-INK-CLA-A5-BLU', axes: { size: 'A5', color: 'blue' }, priceCents: 24900 },
      { sku: 'NB-INK-CLA-A5-BLK', axes: { size: 'A5', color: 'black' }, priceCents: 24900 },
    ]},
    { slug: 'classic-a4-notebook', name: 'Classic A4 Notebook', categoryId: catBy('notebooks'), brand: 'Mahaveer', attributes: { ruling: 'ruled', gsm: 80 }, variants: [
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
    { slug: 'paper-clips-jar', name: 'Paper Clips Jar', categoryId: catBy('office-supplies'), brand: 'Mahaveer', attributes: {}, variants: [
      { sku: 'OFF-INK-CLP-JAR', axes: { count: 500 }, priceCents: 9900 },
    ]},
    // ── Sports: cricket ──
    { slug: 'tennis-cricket-bat', name: 'County Tennis Cricket Bat', categoryId: catBy('cricket'), brand: 'SG', attributes: { material: 'kashmir-willow', age_group: 'adult' }, variants: [
      { sku: 'SPT-SG-BAT-SH', axes: { size: 'short-handle' }, priceCents: 149900 },
      { sku: 'SPT-SG-BAT-SZ6', axes: { size: 'size-6' }, priceCents: 109900 },
    ]},
    { slug: 'cricket-tennis-balls-3pk', name: 'Cricket Tennis Balls (Pack of 3)', categoryId: catBy('cricket'), brand: 'Cosco', attributes: {}, variants: [
      { sku: 'SPT-CSC-TBL-3PK-LGT', axes: { weight: 'light', pack: 3 }, priceCents: 19900 },
      { sku: 'SPT-CSC-TBL-3PK-HVY', axes: { weight: 'heavy', pack: 3 }, priceCents: 21900 },
    ]},
    { slug: 'club-batting-gloves', name: 'Club Batting Gloves', categoryId: catBy('cricket'), brand: 'SG', attributes: { material: 'leather' }, variants: [
      { sku: 'SPT-SG-GLV-YTH', axes: { size: 'youth' }, priceCents: 49900 },
      { sku: 'SPT-SG-GLV-ADT', axes: { size: 'adult' }, priceCents: 69900 },
    ]},
    // ── Sports: badminton ──
    { slug: 'badminton-racquet-zr100', name: 'ZR 100 Badminton Racquet', categoryId: catBy('badminton'), brand: 'Yonex', attributes: { material: 'aluminium' }, variants: [
      { sku: 'SPT-YNX-ZR100', axes: { grip: 'G4' }, priceCents: 129900 },
    ]},
    { slug: 'nylon-shuttlecocks-6pk', name: 'Nylon Shuttlecocks (Pack of 6)', categoryId: catBy('badminton'), brand: 'Cosco', attributes: {}, variants: [
      { sku: 'SPT-CSC-SHT-6PK', axes: { pack: 6 }, priceCents: 24900 },
    ]},
    { slug: 'badminton-grip-tape', name: 'Towel Grip Tape', categoryId: catBy('badminton'), brand: 'Yonex', attributes: {}, variants: [
      { sku: 'SPT-YNX-GRP-BLU', axes: { color: 'blue' }, priceCents: 14900 },
      { sku: 'SPT-YNX-GRP-YLW', axes: { color: 'yellow' }, priceCents: 14900 },
    ]},
    // ── Sports: fitness & outdoor ──
    { slug: 'speed-skipping-rope', name: 'Speed Skipping Rope', categoryId: catBy('fitness-outdoor'), brand: 'Cosco', attributes: {}, variants: [
      { sku: 'SPT-CSC-SKP-ROP', axes: { length: '275cm' }, priceCents: 19900 },
    ]},
    { slug: 'football-size-5', name: 'Storm Football (Size 5)', categoryId: catBy('fitness-outdoor'), brand: 'Nivia', attributes: { material: 'rubberised' }, variants: [
      { sku: 'SPT-NIV-FTB-SZ5', axes: { size: 5 }, priceCents: 59900 },
    ]},
    { slug: 'sports-bottle-1l', name: 'Sports Water Bottle 1L', categoryId: catBy('fitness-outdoor'), brand: 'Milton', attributes: {}, variants: [
      { sku: 'SPT-MLT-BTL-1L-BLU', axes: { color: 'blue' }, priceCents: 29900 },
      { sku: 'SPT-MLT-BTL-1L-GRN', axes: { color: 'green' }, priceCents: 29900 },
    ]},
    // ── Sports: indoor games ──
    { slug: 'club-carrom-board', name: 'Club Carrom Board', categoryId: catBy('indoor-games'), brand: 'Surco', attributes: { material: 'plywood' }, variants: [
      { sku: 'SPT-SRC-CRM-BRD', axes: { size: '29in' }, priceCents: 149900 },
    ]},
    { slug: 'carrom-coins-set', name: 'Carrom Coins & Striker Set', categoryId: catBy('indoor-games'), brand: 'Surco', attributes: {}, variants: [
      { sku: 'SPT-SRC-CRM-CNS', axes: { piece_count: 25 }, priceCents: 34900 },
    ]},
    { slug: 'classic-chess-set', name: 'Classic Chess Set', categoryId: catBy('indoor-games'), brand: 'Mahaveer', attributes: { age_group: 'kids' }, variants: [
      { sku: 'SPT-MHV-CHS-SET', axes: { size: 'standard' }, priceCents: 49900 },
    ]},
    { slug: 'playing-cards-2pk', name: 'Playing Cards (Pack of 2)', categoryId: catBy('indoor-games'), brand: 'Parksons', attributes: {}, variants: [
      { sku: 'SPT-PRK-CRD-2PK', axes: { pack: 2 }, priceCents: 14900 },
    ]},
    // ── Art & craft ──
    { slug: 'origami-paper-pack', name: 'Origami Paper Pack (100 Sheets)', categoryId: catBy('craft-materials'), brand: 'Itsy Bitsy', attributes: { gsm: 80 }, variants: [
      { sku: 'CRF-ITB-ORG-100', axes: { sheet_count: 100 }, priceCents: 19900 },
    ]},
    { slug: 'glue-gun-kit', name: 'Hot Glue Gun Kit (with 10 Sticks)', categoryId: catBy('craft-materials'), brand: 'Pidilite', attributes: {}, variants: [
      { sku: 'CRF-PDL-GLG-KIT', axes: { wattage: '40W' }, priceCents: 39900 },
    ]},
    { slug: 'craft-scissors-set', name: 'Craft Scissors Set (3 Patterns)', categoryId: catBy('craft-materials'), brand: 'Faber-Castell', attributes: { age_group: 'kids' }, variants: [
      { sku: 'CRF-FBC-SCS-3PC', axes: { piece_count: 3 }, priceCents: 24900 },
    ]},
    { slug: 'clay-modelling-set', name: 'Clay Modelling Set', categoryId: catBy('craft-materials'), brand: 'Camlin', attributes: { age_group: 'kids' }, variants: [
      { sku: 'CRF-CAM-CLY-12', axes: { shades: 12 }, priceCents: 14900 },
      { sku: 'CRF-CAM-CLY-24', axes: { shades: 24 }, priceCents: 24900 },
    ]},
    { slug: 'acrylic-paint-set-12', name: 'Acrylic Paint Set (12 Shades)', categoryId: catBy('art-supplies'), brand: 'Camlin', attributes: {}, variants: [
      { sku: 'ART-CAM-ACR-12', axes: { shades: 12 }, priceCents: 49900 },
    ]},
    { slug: 'paint-brush-set-7', name: 'Paint Brush Set (7 Brushes)', categoryId: catBy('art-supplies'), brand: 'Faber-Castell', attributes: {}, variants: [
      { sku: 'ART-FBC-BRS-7PC', axes: { piece_count: 7 }, priceCents: 29900 },
    ]},
    // ── Gifting ──
    { slug: 'pen-gift-set', name: 'Premium Pen Gift Set', categoryId: catBy('gift-sets'), brand: 'Parker', attributes: { ink_type: 'ballpoint' }, variants: [
      { sku: 'GFT-PRK-PEN-SET', axes: { piece_count: 2 }, priceCents: 99900 },
    ]},
    { slug: 'stationery-hamper', name: 'Stationery Hamper', categoryId: catBy('gift-sets'), brand: 'Mahaveer', attributes: {}, variants: [
      { sku: 'GFT-MHV-HMP-LRG', axes: { size: 'large' }, priceCents: 149900 },
    ]},
    { slug: 'greeting-cards-10pk', name: 'Greeting Cards Assorted (Pack of 10)', categoryId: catBy('greeting-cards'), brand: 'Archies', attributes: {}, variants: [
      { sku: 'GFT-ARC-GRC-10PK', axes: { pack: 10 }, priceCents: 29900 },
    ]},
    { slug: 'gift-wrap-rolls-5pk', name: 'Gift Wrap Rolls (Pack of 5)', categoryId: catBy('greeting-cards'), brand: 'Mahaveer', attributes: {}, variants: [
      { sku: 'GFT-MHV-WRP-5PK', axes: { pack: 5 }, priceCents: 19900 },
    ]},
    // ── General ──
    { slug: 'geometry-box', name: 'Instruments Geometry Box', categoryId: catBy('daily-essentials'), brand: 'Camlin', attributes: { age_group: 'kids' }, variants: [
      { sku: 'GEN-CAM-GEO-BOX', axes: { piece_count: 9 }, priceCents: 14900 },
    ]},
    { slug: 'scientific-calculator-fx82', name: 'FX-82 Scientific Calculator', categoryId: catBy('daily-essentials'), brand: 'Casio', attributes: {}, variants: [
      { sku: 'GEN-CAS-FX82', axes: { functions: 240 }, priceCents: 89900 },
    ]},
    { slug: 'tape-dispenser-set', name: 'Sticky Tape Dispenser (with 2 Rolls)', categoryId: catBy('daily-essentials'), brand: 'Deli', attributes: {}, variants: [
      { sku: 'GEN-DEL-TPD-SET', axes: { pack: 2 }, priceCents: 17900 },
    ]},
    { slug: 'school-backpack-30l', name: 'School Backpack 30L', categoryId: catBy('bags-cases'), brand: 'Skybags', attributes: { material: 'polyester', age_group: 'youth' }, variants: [
      { sku: 'GEN-SKB-BPK-BLU', axes: { color: 'blue' }, priceCents: 129900 },
      { sku: 'GEN-SKB-BPK-BLK', axes: { color: 'black' }, priceCents: 129900 },
    ]},
    { slug: 'pencil-pouch', name: 'Pencil Pouch', categoryId: catBy('bags-cases'), brand: 'Classmate', attributes: { material: 'canvas' }, variants: [
      { sku: 'GEN-CLM-PCH-BLU', axes: { color: 'blue' }, priceCents: 19900 },
      { sku: 'GEN-CLM-PCH-PNK', axes: { color: 'pink' }, priceCents: 19900 },
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

  // ── Catalog: bundle products ───────────────────────────────────────
  const [bundle] = await migratorDb.insert(products).values({
    storeId, slug: 'back-to-school-starter', name: 'Back-to-School Starter Kit',
    type: 'bundle', status: 'active', brand: 'Mahaveer', categoryId: catBy('school-supplies'),
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
  variantBySku.set('BUN-INK-B2S-KIT', bundleVar!.id);

  const [cricketKit] = await migratorDb.insert(products).values({
    storeId, slug: 'cricket-starter-kit', name: 'Cricket Starter Kit',
    type: 'bundle', status: 'active', brand: 'Mahaveer', categoryId: catBy('cricket'),
    attributes: {}, publishedAt: new Date(),
  }).returning({ id: products.id });
  const [cricketKitVar] = await migratorDb.insert(productVariants).values({
    productId: cricketKit!.id, storeId, sku: 'BUN-MHV-CRK-KIT', axes: {}, priceCents: 179900, status: 'active',
  }).returning({ id: productVariants.id });
  await migratorDb.insert(bundleComponents).values([
    { bundleVariantId: cricketKitVar!.id, componentVariantId: variantBySku.get('SPT-SG-BAT-SH')!, qty: 1 },
    { bundleVariantId: cricketKitVar!.id, componentVariantId: variantBySku.get('SPT-CSC-TBL-3PK-LGT')!, qty: 1 },
    { bundleVariantId: cricketKitVar!.id, componentVariantId: variantBySku.get('SPT-MLT-BTL-1L-BLU')!, qty: 1 },
  ]);
  variantBySku.set('BUN-MHV-CRK-KIT', cricketKitVar!.id);

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
    storeId, name: 'Mahaveer Trading Co.', contact: { email: 'orders@mahaveer-trading.test' }, leadTimeDays: 7,
  }).returning({ id: suppliers.id });

  const skuPicks = ['NB-INK-CLA-A5-BLU', 'PEN-PLT-V5-05-BLK', 'OFF-INK-CLP-JAR'];
  for (const sku of skuPicks) {
    await migratorDb.insert(supplierSkus).values({
      supplierId: supplier!.id, variantId: variantBySku.get(sku)!, storeId,
      supplierSku: `MTC-${sku}`, costCents: 5000, moq: 50,
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
  // points at a published version carrying the full homepage lineup (hero →
  // newsletter). Each block is { kind, props } per the block registry.
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
          title: 'Play hard. Write it down.',
          subtitle: 'School books, cricket bats, paint boxes and everything in between — your neighbourhood shop for school, sport and craft, under one roof.',
          cta: { label: 'Shop stationery', href: '/c/stationery' },
        },
      },
      {
        kind: 'featured-categories',
        props: {
          heading: 'Shop by department',
          categorySlugs: ['stationery', 'sports', 'art-craft', 'gifting', 'general'],
        },
      },
      {
        kind: 'product-grid',
        props: {
          heading: 'Fresh off the shelves',
          collectionSlug: 'notebooks',
          limit: 8,
          layout: 'grid',
        },
      },
      {
        kind: 'banner',
        props: {
          image: { url: '/images/hero.png', alt: 'Back-to-school season at Mahaveer' },
          text: 'Back-to-school season is on — kits, bags and bottles, sorted in one trip.',
          cta: { label: 'Shop school supplies', href: '/c/school-supplies' },
        },
      },
      {
        kind: 'two-column',
        props: {
          ratio: '1-1',
          left: [
            {
              kind: 'rich-text',
              props: {
                markdown: '## The stationery counter\n\nMahaveer started as the lane’s stationery shop — exam boards, brown-paper covers and ink refills stacked to the ceiling. Decades on, the counter still runs the same way: you tell us the school list, we fill the bag.\n\n- Notebooks, pens and paper by the dozen\n- School kits made up to your class list\n- Office supplies for the shops around us',
              },
            },
          ],
          right: [
            {
              kind: 'rich-text',
              props: {
                markdown: '## The sports counter\n\nThe other half of the shop smells of willow and rubber grips. Bats knocked in, racquets restrung, carrom boards powdered — gear for gully cricket and club season alike.\n\n- Cricket, badminton and football gear\n- Indoor games for the whole family\n- Grips, guards and spares fitted while you wait',
              },
            },
          ],
        },
      },
      {
        kind: 'product-grid',
        props: {
          heading: 'Gear up for the season',
          collectionSlug: 'cricket',
          limit: 4,
          layout: 'grid',
        },
      },
      {
        kind: 'testimonials',
        props: {
          heading: 'From our regulars',
          items: [
            { quote: 'One trip before school reopens and we are done — books covered, labels stuck, even a new bottle. They know the class lists better than I do.', name: 'Sunita Deshmukh', role: 'Parent, Class 6 & 8' },
            { quote: 'Bought my kashmir-willow here and they knocked it in for free. Weekend after weekend, the grip counter keeps our whole gully team going.', name: 'Rohan Kulkarni', role: 'Club cricketer' },
            { quote: 'Their craft shelf saved my science-exhibition week. Staff who actually know where every last sheet of origami paper sits.', name: 'Farhan Sheikh', role: 'Art teacher' },
          ],
        },
      },
      {
        kind: 'newsletter',
        props: {
          heading: 'Get the season’s list first',
          placeholder: 'you@example.com',
          buttonLabel: 'Sign up',
        },
      },
    ];

    const [homeVersion] = await migratorDb.insert(contentVersions).values({
      storeId, pageId: homePageId, blocks: homeBlocks,
      seo: { title: 'Mahaveer Stationery and Sports — school, sport & craft under one roof', description: 'Your neighbourhood shop for notebooks, pens, cricket gear, badminton, art supplies and gifts. Everything for school, sport and craft in one trip.' },
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

  // ── CMS: static pages (about / contact / shipping / returns) ───────
  // Same flow as the homepage: page → published rich-text version, guarded
  // per-page so re-running the seed never duplicates. These back the footer
  // links (/pages/about, /pages/contact, /pages/shipping, /pages/returns).
  type StaticPageSeed = {
    slug: string; title: string;
    seo: { title: string; description: string };
    markdown: string;
  };
  const staticPages: StaticPageSeed[] = [
    {
      slug: 'about', title: 'About Us',
      seo: { title: 'About us — Mahaveer Stationery and Sports', description: 'The story of a family-run neighbourhood shop: a stationery counter and a sports counter under one roof.' },
      markdown: '## One shop, two counters\n\nMahaveer Stationery and Sports began as a single stationery counter in the main market — exam boards, ink refills and brown-paper covers stacked to the ceiling. When the kids who bought pencils started asking for cricket balls, we simply added a second counter. Decades later, both counters are still run by the same family.\n\n## The stationery counter\n\nNotebooks by the dozen, pens you can try before you buy, and school kits made up to the class list you hand us. Schools, offices and tuition centres around the market have run on this counter for years.\n\n## The sports counter\n\nThe other half of the shop smells of willow and rubber grips. Bats knocked in, racquets restrung, carrom boards powdered — gear for gully games, school tournaments and club season alike.\n\n## Why people keep coming back\n\n- We stock what the schools nearby actually prescribe\n- Prices marked plainly, a bill with every sale\n- If we don’t have it, we get it in a couple of days',
    },
    {
      slug: 'contact', title: 'Contact',
      seo: { title: 'Contact — Mahaveer Stationery and Sports', description: 'Visit the shop, call, WhatsApp or email us. Opening hours and directions.' },
      markdown: '## Visit the shop\n\nShop No. 12, Main Market Road, Near City High School, Your City — 400001.\n\n## Call or write\n\n- Phone: +91 98765 43210\n- WhatsApp: +91 98765 43210\n- Email: hello@mahaveer.test\n\n## Opening hours\n\n- Monday to Saturday: 9:30am – 8:30pm\n- Sunday: 10:00am – 2:00pm\n\nSchool-reopening weeks get busy — come early, or send the class list on WhatsApp and we’ll keep the bag ready.',
    },
    {
      slug: 'shipping', title: 'Shipping',
      seo: { title: 'Shipping — Mahaveer Stationery and Sports', description: 'Dispatch in 24–48 hours, free shipping over ₹999, delivery estimates and cash on delivery.' },
      markdown: '## Dispatch\n\nOrders are packed and dispatched within 24–48 hours, Monday to Saturday. Orders placed on Sunday go out first thing Monday.\n\n## Delivery estimates\n\n- Metro cities: 2–4 working days\n- Rest of India: 4–7 working days\n\n## Charges\n\nFree shipping on orders above ₹999. Below that, a flat rate is shown at checkout before you pay.\n\n## Cash on delivery\n\nCOD is available on most pincodes for orders up to ₹5,000; a small COD fee may apply at checkout. Bulky items like carrom boards can take an extra working day.',
    },
    {
      slug: 'returns', title: 'Returns',
      seo: { title: 'Returns — Mahaveer Stationery and Sports', description: '7-day easy returns, what’s excluded, and how to start a return or exchange.' },
      markdown: '## 7-day easy returns\n\nChanged your mind? Return most items within 7 days of delivery — unused and in original packaging — for a full refund or exchange.\n\n## What we can’t take back\n\n- Opened art materials — paints, clay and glue once unsealed\n- Personalised gifts and name-printed stationery\n- Balls and shuttlecocks once used\n\n## How to start a return\n\n- Write to returns@mahaveer.test or WhatsApp us with your order number\n- Pack the item as it arrived, bill inside\n- We arrange pickup where couriers allow; otherwise drop it at the counter\n\nRefunds reach your original payment method within 5–7 working days of the item reaching us.',
    },
  ];

  for (const page of staticPages) {
    const existing = await migratorDb
      .select({ id: contentPages.id })
      .from(contentPages)
      .where(and(eq(contentPages.storeId, storeId), eq(contentPages.slug, page.slug)))
      .limit(1);
    if (existing[0]) continue;

    const [pageRow] = await migratorDb.insert(contentPages).values({
      storeId, slug: page.slug, title: page.title, status: 'draft',
    }).returning({ id: contentPages.id });
    const pageId = pageRow!.id;

    const [version] = await migratorDb.insert(contentVersions).values({
      storeId, pageId, blocks: [{ kind: 'rich-text', props: { markdown: page.markdown } }],
      seo: page.seo,
      createdBy: adminId,
    }).returning({ id: contentVersions.id });

    await migratorDb.update(contentPages)
      .set({
        draftVersionId: version!.id,
        publishedVersionId: version!.id,
        status: 'published',
      })
      .where(eq(contentPages.id, pageId));
  }

  // ── CMS: header + footer navigation menus ──────────────────────────
  await migratorDb.insert(navigationMenus).values([
    {
      storeId, slot: 'header', items: [
        {
          label: 'Stationery', href: '/c/stationery', children: [
            { label: 'Notebooks', href: '/c/notebooks' },
            { label: 'Pens & Writing', href: '/c/pens-writing' },
            { label: 'Office Supplies', href: '/c/office-supplies' },
            { label: 'School Supplies', href: '/c/school-supplies' },
            { label: 'Paper & Stationery', href: '/c/paper-stationery' },
          ],
        },
        {
          label: 'Sports', href: '/c/sports', children: [
            { label: 'Cricket', href: '/c/cricket' },
            { label: 'Badminton', href: '/c/badminton' },
            { label: 'Fitness & Outdoor', href: '/c/fitness-outdoor' },
            { label: 'Indoor Games', href: '/c/indoor-games' },
          ],
        },
        {
          label: 'Art & Craft', href: '/c/art-craft', children: [
            { label: 'Art Supplies', href: '/c/art-supplies' },
            { label: 'Craft Materials', href: '/c/craft-materials' },
          ],
        },
        {
          label: 'Gifting', href: '/c/gifting', children: [
            { label: 'Gift Sets', href: '/c/gift-sets' },
            { label: 'Greeting Cards & Wrap', href: '/c/greeting-cards' },
          ],
        },
        {
          label: 'General', href: '/c/general', children: [
            { label: 'Bags & Cases', href: '/c/bags-cases' },
            { label: 'Daily Essentials', href: '/c/daily-essentials' },
          ],
        },
      ],
    },
    {
      storeId, slot: 'footer', items: [
        {
          label: 'Shop', children: [
            { label: 'Stationery', href: '/c/stationery' },
            { label: 'Sports', href: '/c/sports' },
            { label: 'Art & Craft', href: '/c/art-craft' },
            { label: 'Gifting', href: '/c/gifting' },
            { label: 'General', href: '/c/general' },
          ],
        },
        {
          label: 'Company', children: [
            { label: 'About', href: '/pages/about' },
            { label: 'Contact', href: '/pages/contact' },
          ],
        },
        {
          label: 'Help', children: [
            { label: 'Contact', href: '/pages/contact' },
            { label: 'Shipping', href: '/pages/shipping' },
            { label: 'Returns', href: '/pages/returns' },
          ],
        },
      ],
    },
  ]).onConflictDoNothing({ target: [navigationMenus.storeId, navigationMenus.slot] });

  logger.info({ storeId, adminId, products: seedProducts.length + 2, variants: variantBySku.size }, 'seed complete');
  await migratorClient.end();
}

main().catch(async err => {
  logger.error({ err }, 'seed failed');
  await migratorClient.end();
  process.exit(1);
});
