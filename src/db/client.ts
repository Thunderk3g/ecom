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
      `DATABASE_URL username must be 'app_migrator' so the app runtime can switch to NOBYPASSRLS 'app_user'; got '${u.username}'. This assertion prevents silently falling back to BYPASSRLS which would defeat the RLS tenancy model.`,
    );
  }
  u.username = 'app_user';
  return u.toString();
}

export const migratorClient = postgres(env.DATABASE_URL, { max: 1, prepare: false });
export const migratorDb = drizzle(migratorClient);

export const appClient = postgres(deriveAppUrl(env.DATABASE_URL), { max: 10, prepare: false });
export const appDb = drizzle(appClient);
