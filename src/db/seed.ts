import 'dotenv/config';
import { migratorDb, migratorClient } from './client';
import { stores, storeDomains } from './schema/tenancy';
import { users, storeUsers } from './schema/identity';
import { siteConfig } from './schema/config';
import { hashPassword } from '@/modules/auth/password';
import { logger } from '@/lib/logger';

async function main() {
  logger.info('seeding example store…');

  const [store] = await migratorDb.insert(stores)
    .values({ slug: 'inkwell', name: 'Inkwell & Co' })
    .returning({ id: stores.id });

  await migratorDb.insert(storeDomains).values([
    { storeId: store!.id, domain: 'localhost', isPrimary: true },
    { storeId: store!.id, domain: 'inkwell.localhost', isPrimary: false },
  ]);

  const [admin] = await migratorDb.insert(users)
    .values({ email: 'admin@inkwell.test', passwordHash: await hashPassword('admin1234') })
    .returning({ id: users.id });

  await migratorDb.insert(storeUsers).values({
    storeId: store!.id,
    userId: admin!.id,
    role: 'owner',
    permissions: ['*'],
  });

  await migratorDb.insert(siteConfig).values({
    storeId: store!.id,
    config: {
      brand: { name: 'Inkwell & Co', tagline: 'Paper goods, properly.' },
      theme: { color: { primary: '#2C3E8C' } },
    },
    updatedBy: admin!.id,
  });

  logger.info({ storeId: store!.id, adminId: admin!.id }, 'seed complete');
  await migratorClient.end();
}

main().catch(async err => {
  logger.error({ err }, 'seed failed');
  await migratorClient.end();
  process.exit(1);
});
