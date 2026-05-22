import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase, PostgresJsTransaction } from 'drizzle-orm/postgres-js';
import { appDb } from '@/db/client';

type Tx = PostgresJsTransaction<Record<string, never>, Record<string, never>>;

export async function withTenant<T>(
  storeId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return appDb.transaction(async tx => {
    await tx.execute(sql`SELECT set_config('app.store_id', ${storeId}, true)`);
    return fn(tx as Tx);
  });
}

export { appDb as db };
