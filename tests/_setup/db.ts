import { execSync } from 'node:child_process';
import { env } from '@/lib/env';
import { migratorClient } from '@/db/client';

export async function resetAndMigrate() {
  // Destructive: drops the public + drizzle schemas of whatever DATABASE_URL
  // resolves to. Refuse anything that isn't the disposable local Postgres —
  // .env carries the shared Supabase dev instance, and inheriting it here
  // (exported shell env, misconfigured runner) must fail loudly, not wipe it.
  const host = new URL(env.DATABASE_URL).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(
      `resetAndMigrate refused: DATABASE_URL points at non-local host '${host}'. ` +
      'The test harness drops the public schema; run it only against the local ' +
      'docker Postgres (127.0.0.1:5433, `pnpm db:up`).',
    );
  }
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
