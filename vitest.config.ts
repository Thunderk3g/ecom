import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // `import 'server-only'` is a build-time guard supplied by Next.js; it
      // has no meaning under vitest's node environment and cannot be resolved
      // outside the Next compiler, so point it at a no-op.
      'server-only': resolve(__dirname, 'tests/_setup/server-only-shim.ts'),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/_setup/env.ts'],
    testTimeout: 15_000,
    // resetAndMigrate drops the schema and replays 18+ migrations per test
    // file; the default 10s hook timeout isn't enough on cold runs.
    hookTimeout: 60_000,
    // Tests share one Postgres schema; resetAndMigrate drops/recreates it,
    // so files must not run in parallel or they stomp on each other.
    fileParallelism: false,
  },
});
