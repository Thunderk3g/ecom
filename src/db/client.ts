import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '@/lib/env';

// Two clients: `migrator` has BYPASSRLS (runs DDL and data ops in migrations/seed);
// `app` is the NOBYPASSRLS runtime role — all request-time queries use this.
export const migratorClient = postgres(env.DATABASE_URL, { max: 1, prepare: false });
export const migratorDb = drizzle(migratorClient);

const appUrl = env.DATABASE_URL.replace('app_migrator:', 'app_user:');
export const appClient = postgres(appUrl, { max: 10, prepare: false });
export const appDb = drizzle(appClient);
