import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/_setup/env.ts'],
    testTimeout: 15_000,
    // Tests share one Postgres schema; resetAndMigrate drops/recreates it,
    // so files must not run in parallel or they stomp on each other.
    fileParallelism: false,
  },
});
