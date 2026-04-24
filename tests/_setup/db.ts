import { execSync } from 'node:child_process';
import { migratorClient } from '@/db/client';

export async function resetAndMigrate() {
  await migratorClient`DROP SCHEMA public CASCADE`;
  await migratorClient`CREATE SCHEMA public`;
  await migratorClient`GRANT ALL ON SCHEMA public TO app_migrator`;
  await migratorClient`GRANT USAGE ON SCHEMA public TO app_user`;
  // drizzle tracks applied migrations in its own schema; must drop it too
  // or `migrate` will no-op on a subsequent reset and leave public empty.
  await migratorClient`DROP SCHEMA IF EXISTS drizzle CASCADE`;
  execSync('pnpm db:migrate', { stdio: 'inherit' });
}

export async function tableExists(name: string): Promise<boolean> {
  const rows = await migratorClient<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${name}
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}
