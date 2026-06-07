import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '@/lib/env';

// Two clients: `migrator` has BYPASSRLS (runs DDL and data ops in migrations/seed);
// `app` is the NOBYPASSRLS runtime role — all request-time queries use this.
// `prepare: false` keeps the clients compatible with pgbouncer transaction-pool mode
// used by the Render deployment target.

function deriveAppUrl(migratorUrl: string): string {
  const u = new URL(migratorUrl);
  if (u.username !== 'app_migrator') {
    throw new Error(
      `DATABASE_URL username must be 'app_migrator' so the app runtime can switch to NOBYPASSRLS 'app_user'; got '${u.username}'. Either set APP_DATABASE_URL to an explicit NOBYPASSRLS runtime connection string (Supabase / managed Postgres), or use the 'app_migrator' migrator role (local Docker). This assertion prevents silently falling back to BYPASSRLS which would defeat the RLS tenancy model.`,
    );
  }
  u.username = 'app_user';
  return u.toString();
}

/**
 * Runtime (request-time) connection string for the NOBYPASSRLS role.
 *
 * - Supabase / managed Postgres: set APP_DATABASE_URL explicitly. There the
 *   migrator connects as `postgres`, so the rename-the-username trick can't
 *   produce the runtime role — the two roles are provisioned independently.
 * - Local Docker: leave APP_DATABASE_URL unset and we derive `app_user` from
 *   the `app_migrator` DATABASE_URL (the docker/postgres-init bootstrap creates
 *   that role). The assertion in deriveAppUrl guards against an accidental
 *   BYPASSRLS runtime.
 */
function resolveAppUrl(): string {
  return env.APP_DATABASE_URL ?? deriveAppUrl(env.DATABASE_URL);
}

export const migratorClient = postgres(env.DATABASE_URL, { max: 1, prepare: false });
export const migratorDb = drizzle(migratorClient);

export const appClient = postgres(resolveAppUrl(), { max: 10, prepare: false });
export const appDb = drizzle(appClient);
