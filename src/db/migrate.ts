import 'dotenv/config';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { migratorDb, migratorClient } from './client';

async function main() {
  console.log('[migrate] running migrations…');
  await migrate(migratorDb, { migrationsFolder: './src/db/migrations' });
  console.log('[migrate] done');
  await migratorClient.end();
}

main().catch(err => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
