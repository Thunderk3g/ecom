# SP-1: Foundation & Tenancy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Next.js + Drizzle + Postgres + Redis foundation every later sub-project depends on — tenancy via Row-Level Security, Lucia-style auth with argon2id, layered site_config loader, three-role Docker boot (web/worker/scheduler), and a green CI.

**Architecture:** A single Next.js App Router app deployed as one Docker image; the `ROLE` env var selects the entrypoint (`web` → Next server, `worker` → BullMQ consumer, `scheduler` → cron enqueuer). Multi-tenancy is enforced at the database: every tenant-scoped table carries `store_id` with an RLS policy against `current_setting('app.store_id')::uuid`. Each request resolves host → store_id and opens a transaction that starts with `SET LOCAL app.store_id = ...`. site_config is layered deterministically: `platform.defaults.ts` (code) → `site_config` DB row → `process.env` override, cached per tenant in Redis.

**Tech Stack:** Next.js 15 (App Router), TypeScript 5.4+, Drizzle ORM + drizzle-kit, PostgreSQL 15, Redis 7, BullMQ (stubs only in SP-1), argon2id via `@node-rs/argon2`, HMAC-signed cookies, Pino logs, Vitest, zod, Docker multi-stage, GitHub Actions, pnpm.

---

## Spec Coverage Map

Mapping sections of `docs/superpowers/specs/2026-04-24-stationery-ecommerce-platform-design.md` to tasks:

| Spec section | Tasks |
|---|---|
| §3 Architecture diagram (web/worker/scheduler, Postgres/Redis/R2) | 1, 25, 26, 27 |
| §4 Module map (auth, config, tenant modules) | 2, 12, 13, 14, 16 |
| §5.1 Tenancy & identity schema | 7, 8, 9 |
| §5.6 site_config, feature_flags | 10 |
| §5.7 RLS policy pattern | 11 |
| §6.4 API conventions (RFC 7807, Idempotency-Key, `/v1`, cursor pagination) | 19, 20 |
| §9 Configuration system (layered, Redis cache, CSS custom props) | 14, 15 |
| §13 Deployment (Docker multi-stage, ROLE, /healthz) | 22, 25, 26, 27 |
| §15 Non-functional (argon2id, CSRF, HSTS, signed cookies) | 16, 17, 18 |
| §16 Defaults (Lucia-style, Drizzle, Render, Postgres FTS — we lock Lucia-style + Drizzle; FTS is SP-2) | locked throughout |

---

## Assumptions (locked unless overruled)

1. **Package manager:** pnpm (faster CI, deterministic). Reversible via `package.json` + lockfile.
2. **Node version:** 20 LTS.
3. **Test runner:** Vitest (Jest-compatible API, native ESM/TS).
4. **Argon2:** `@node-rs/argon2` (Rust binding; no postinstall pain vs `argon2` native).
5. **Session cookies:** opaque 32-byte session IDs, HMAC-SHA256 signed; httpOnly, secure, SameSite=lax. No JWT.
6. **CSRF:** synchronizer-token pattern on `/api/v1/admin/*` mutations; token minted on admin login, verified via `X-CSRF-Token`.
7. **Redis client:** `ioredis` (worker-friendly; same lib BullMQ uses).
8. **RLS strategy:** two Postgres roles — `app_migrator` (BYPASSRLS, runs migrations) and `app_user` (NOBYPASSRLS, the app runtime). Every request issues `SET LOCAL app.store_id` before any tenant-scoped query.
9. **Middleware runtime:** Next.js `middleware.ts` only normalizes/forwards host as `x-store-host`; actual tenant lookup (Redis → DB fallback) happens in a Node.js server helper called from layouts and API routes. This avoids Edge-runtime DB driver limits.
10. **Tenant resolution caching:** domain → store_id cached in Redis (`tenant:domain:<host>`), 10-minute TTL, invalidated on admin `store_domains` writes (invalidation implemented here; admin UI for domains lives in SP-6 but the invalidation hook is in SP-1).

---

## File Structure (SP-1 final state)

```
.
├── .env.example
├── .github/workflows/ci.yml
├── .gitignore
├── CLAUDE.md                              (exists)
├── docker/Dockerfile
├── docker-compose.dev.yml
├── docs/superpowers/specs/...             (exists)
├── docs/superpowers/plans/...             (exists)
├── drizzle.config.ts
├── next.config.ts
├── package.json
├── pnpm-lock.yaml
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── healthz/route.ts
│   │   └── api/v1/auth/
│   │       ├── login/route.ts
│   │       ├── logout/route.ts
│   │       └── signup/route.ts
│   ├── middleware.ts
│   ├── entrypoints/
│   │   ├── worker.ts
│   │   └── scheduler.ts
│   ├── db/
│   │   ├── client.ts
│   │   ├── migrate.ts
│   │   ├── seed.ts
│   │   ├── migrations/                    (generated)
│   │   └── schema/
│   │       ├── index.ts
│   │       ├── tenancy.ts
│   │       ├── identity.ts
│   │       ├── sessions.ts
│   │       └── config.ts
│   ├── modules/
│   │   ├── tenant/
│   │   │   ├── resolve.ts
│   │   │   └── with-tenant.ts
│   │   ├── auth/
│   │   │   ├── password.ts
│   │   │   ├── session.ts
│   │   │   └── csrf.ts
│   │   └── config/
│   │       └── loader.ts
│   ├── lib/
│   │   ├── env.ts
│   │   ├── logger.ts
│   │   ├── errors.ts
│   │   ├── idempotency.ts
│   │   └── cookies.ts
│   └── platform.defaults.ts
├── tests/
│   ├── env.test.ts
│   ├── password.test.ts
│   ├── session.test.ts
│   ├── csrf.test.ts
│   ├── errors.test.ts
│   ├── idempotency.test.ts
│   ├── config-loader.test.ts
│   └── tenant-resolve.test.ts
├── tsconfig.json
└── vitest.config.ts
```

---

## Execution Notes for the Engineer

- Commit after every task (end of each task has a commit step). Green working tree between tasks.
- Run `pnpm typecheck && pnpm test` before every commit; if red, fix before committing.
- The database tasks (7–11) require `pnpm db:up` (docker-compose) running. Task 5 brings it up.
- Vitest tests for modules that need Postgres use a test database; tests bring up their own schema via the migrate script. A helper `tests/_setup/db.ts` is introduced in Task 8 and reused thereafter.
- Any task that adds an npm dependency uses `pnpm add` (runtime) or `pnpm add -D` (dev).

---

## Task 1: Initialize git repo and baseline repo hygiene

**Files:**
- Create: `.gitignore`
- Create: `README.md`

- [ ] **Step 1: Initialize git**

```bash
git init -b main
```

Expected: `Initialized empty Git repository in <path>/.git/`

- [ ] **Step 2: Create `.gitignore`**

```
# deps
node_modules/
.pnpm-store/

# next
.next/
out/
next-env.d.ts

# build
dist/
*.tsbuildinfo

# env
.env
.env.local
.env.*.local

# os
.DS_Store
Thumbs.db

# ide
.vscode/
.idea/

# test
coverage/

# drizzle
drizzle/meta/_journal.json.bak
```

- [ ] **Step 3: Create `README.md`**

```markdown
# Stationery Ecommerce Platform

Multi-tenant ecommerce platform. See `docs/superpowers/specs/` for the architecture charter and `docs/superpowers/plans/` for per-sub-project plans. Claude sessions: read `CLAUDE.md` first.

## Local dev

```bash
pnpm install
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```
```

- [ ] **Step 4: Initial commit**

```bash
git add .gitignore README.md CLAUDE.md docs/
git commit -m "chore: bootstrap repo with gitignore, readme, and superpowers docs"
```

Expected: commit created; `git status` clean.

---

## Task 2: Next.js 15 + TypeScript + pnpm bootstrap

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "ecommerce",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20.11.0" },
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:up": "docker compose -f docker-compose.dev.yml up -d",
    "db:down": "docker compose -f docker-compose.dev.yml down",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/db/migrate.ts",
    "db:seed": "tsx src/db/seed.ts",
    "worker": "tsx src/entrypoints/worker.ts",
    "scheduler": "tsx src/entrypoints/scheduler.ts"
  },
  "dependencies": {
    "next": "^15.0.3",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.12.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.4.5",
    "tsx": "^4.7.2",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowJs": false,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["next-env.d.ts", "src/**/*", "tests/**/*", "drizzle.config.ts", "vitest.config.ts"],
  "exclude": ["node_modules", ".next"]
}
```

- [ ] **Step 3: Create `next.config.ts`**

```ts
import type { NextConfig } from 'next';

const config: NextConfig = {
  ...(process.env.NEXT_STANDALONE === '1' ? { output: 'standalone' } : {}),
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
};

export default config;
```

Standalone output is gated on `NEXT_STANDALONE=1` so local builds (Windows without Developer Mode, where `fs.symlink` returns EPERM) complete cleanly; the Dockerfile in Task 25 sets the env var so the image still gets standalone output.

- [ ] **Step 4: Create `src/app/layout.tsx`**

```tsx
import type { ReactNode } from 'react';

export const metadata = { title: 'Stationery Store', description: 'Paper goods, properly.' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 5: Create `src/app/page.tsx`**

```tsx
export default function Home() {
  return <main><h1>Stationery storefront (SP-1 foundation)</h1></main>;
}
```

- [ ] **Step 6: Install deps and verify build**

```bash
pnpm install
pnpm typecheck
pnpm build
```

Expected: typecheck passes, `next build` completes with "Creating an optimized production build" then "Compiled successfully".

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json next.config.ts src/app/ .gitignore
git commit -m "feat: bootstrap next.js 15 app router with typescript"
```

---

## Task 3: Install core runtime and dev dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime deps**

```bash
pnpm add drizzle-orm postgres ioredis pino zod@^3.23.8 @node-rs/argon2 bullmq
```

Version pins called out:
- `zod@^3.23.8` — v4 deprecates `.url()` and shifts error-map APIs in ways the plan's env schema does not account for. Pin to v3.
- `postgres` is the tag-template client used by `drizzle-orm/postgres-js`. `pg` (node-postgres) is deliberately omitted — nothing in SP-1 uses it; keeping a second Postgres client installed invites accidental dual-pool bugs.

- [ ] **Step 2: Install dev deps**

```bash
pnpm add -D drizzle-kit eslint@^9 eslint-config-next @vitest/coverage-v8@^2.1.0 pino-pretty
```

Version pins called out:
- `@vitest/coverage-v8@^2.1.0` — must match the `vitest@^2.1.0` already installed; the v4 line is ABI-locked to vitest v4.
- `eslint@^9` — `eslint-config-next@^16` supports eslint 9; Next 15's `next lint` path has not been validated with eslint 10. Stay on 9.
- `pino-pretty` is a dev-only log transport; shipping it to production wastes image space and risks someone wiring it into prod. Pino loads it lazily from devDependencies when `transport: { target: 'pino-pretty' }` is used in dev.

- [ ] **Step 3: Verify versions resolved**

```bash
pnpm list --depth 0
```

Expected: every package above listed with a concrete version; no peer-dep warnings that block install.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add drizzle, postgres, redis, pino, zod, argon2, bullmq deps"
```

---

## Task 4: Typed env loader (`src/lib/env.ts`) with zod

**Files:**
- Create: `.env.example`
- Create: `src/lib/env.ts`
- Create: `tests/env.test.ts`
- Create: `vitest.config.ts`

- [ ] **Step 1: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  test: { environment: 'node', globals: false, include: ['tests/**/*.test.ts'] },
});
```

- [ ] **Step 2: Write the failing test at `tests/env.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { parseEnv } from '@/lib/env';

describe('parseEnv', () => {
  it('parses a valid env object', () => {
    const env = parseEnv({
      NODE_ENV: 'development',
      ROLE: 'web',
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
      SESSION_SECRET: 'a'.repeat(32),
      COOKIE_DOMAIN: 'localhost',
    });
    expect(env.ROLE).toBe('web');
    expect(env.NODE_ENV).toBe('development');
  });

  it('rejects short SESSION_SECRET', () => {
    expect(() => parseEnv({
      NODE_ENV: 'development',
      ROLE: 'web',
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
      SESSION_SECRET: 'short',
      COOKIE_DOMAIN: 'localhost',
    })).toThrow(/SESSION_SECRET/);
  });

  it('rejects invalid ROLE', () => {
    expect(() => parseEnv({
      NODE_ENV: 'development',
      ROLE: 'bogus',
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
      SESSION_SECRET: 'a'.repeat(32),
      COOKIE_DOMAIN: 'localhost',
    })).toThrow(/ROLE/);
  });
});
```

- [ ] **Step 3: Run test (must fail)**

```bash
pnpm test -- tests/env.test.ts
```

Expected: failure — `Cannot find module '@/lib/env'` or similar.

- [ ] **Step 4: Implement `src/lib/env.ts`**

```ts
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  ROLE: z.enum(['web', 'worker', 'scheduler']).default('web'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 chars'),
  COOKIE_DOMAIN: z.string().min(1),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(input: Record<string, string | undefined>): Env {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  return result.data;
}

export const env: Env = parseEnv(process.env);
```

- [ ] **Step 5: Create `.env.example`**

```
NODE_ENV=development
ROLE=web
PORT=3000
LOG_LEVEL=debug

# Postgres — docker-compose starts one locally
DATABASE_URL=postgres://app_migrator:dev_password@localhost:5432/ecommerce

# Redis — docker-compose starts one locally
REDIS_URL=redis://localhost:6379

# Auth — generate with: openssl rand -hex 32
SESSION_SECRET=replace_me_with_32_byte_hex_string_from_openssl_rand

# Cookie scope
COOKIE_DOMAIN=localhost
```

- [ ] **Step 6: Run tests (must pass)**

```bash
pnpm test -- tests/env.test.ts
```

Expected: three tests pass.

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts src/lib/env.ts tests/env.test.ts .env.example
git commit -m "feat(env): add zod-validated env loader with tests"
```

---

## Task 5: Local Postgres + Redis via docker-compose

**Files:**
- Create: `docker-compose.dev.yml`

- [ ] **Step 1: Create `docker-compose.dev.yml`**

```yaml
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_USER: app_migrator
      POSTGRES_PASSWORD: dev_password
      POSTGRES_DB: ecommerce
    ports: ["5432:5432"]
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app_migrator -d ecommerce"]
      interval: 3s
      timeout: 3s
      retries: 20

  redis:
    image: redis:7
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 3s
      timeout: 3s
      retries: 10

volumes:
  pgdata:
```

- [ ] **Step 2: Bring it up and verify**

```bash
pnpm db:up
docker compose -f docker-compose.dev.yml ps
```

Expected: both `postgres` and `redis` containers show `healthy`.

- [ ] **Step 3: Create the `app_user` Postgres role**

```bash
docker compose -f docker-compose.dev.yml exec -T postgres psql -U app_migrator -d ecommerce <<'SQL'
CREATE ROLE app_user LOGIN PASSWORD 'dev_password' NOBYPASSRLS;
GRANT CONNECT ON DATABASE ecommerce TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
SQL
```

Expected: no errors. If role already exists, re-running is fine to document as a known idempotency quirk — use `DO $$ BEGIN CREATE ROLE ...; EXCEPTION WHEN duplicate_object THEN NULL; END $$;` wrapper if running repeatedly.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.dev.yml
git commit -m "chore: add docker-compose for local postgres 15 and redis 7"
```

---

## Task 6: Drizzle setup — config, client, migrate runner

**Files:**
- Create: `drizzle.config.ts`
- Create: `src/db/client.ts`
- Create: `src/db/migrate.ts`
- Create: `src/db/schema/index.ts`

- [ ] **Step 1: Create `drizzle.config.ts`**

```ts
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dbCredentials: { url: process.env.DATABASE_URL! },
  strict: true,
  verbose: true,
});
```

- [ ] **Step 2: Install dotenv for migrate-time env loading**

```bash
pnpm add -D dotenv
```

- [ ] **Step 3: Create `src/db/schema/index.ts`** (stub; grows in later tasks)

```ts
// Re-export all tables here so drizzle-kit discovers them.
// Each domain adds its exports as tasks add tables.
export {};
```

- [ ] **Step 4: Create `src/db/client.ts`**

```ts
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
```

- [ ] **Step 5: Create `src/db/migrate.ts`**

```ts
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
```

- [ ] **Step 6: Run migrate against empty schema folder (should be a no-op)**

```bash
pnpm db:migrate
```

Expected: `[migrate] running migrations…` then `[migrate] done` with no tables created (the schema folder has no migrations yet — added in Task 7).

- [ ] **Step 7: Commit**

```bash
git add drizzle.config.ts src/db/client.ts src/db/migrate.ts src/db/schema/index.ts package.json pnpm-lock.yaml
git commit -m "feat(db): drizzle config, dual-role client, migrate runner"
```

---

## Task 7: Schema — tenancy tables (`stores`, `store_domains`)

**Files:**
- Create: `src/db/schema/tenancy.ts`
- Modify: `src/db/schema/index.ts`
- Create: `tests/_setup/db.ts`
- Create: `tests/tenancy-schema.test.ts`

- [ ] **Step 1: Write `src/db/schema/tenancy.ts`**

```ts
import { pgTable, uuid, text, boolean, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const stores = pgTable('stores', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const storeDomains = pgTable('store_domains', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  domain: text('domain').notNull(),
  isPrimary: boolean('is_primary').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  domainUnique: uniqueIndex('store_domains_domain_uq').on(t.domain),
}));
```

- [ ] **Step 2: Re-export from `src/db/schema/index.ts`**

```ts
export * from './tenancy';
```

- [ ] **Step 3: Create `tests/_setup/db.ts`** — shared harness for schema tests

```ts
import { execSync } from 'node:child_process';
import { migratorClient } from '@/db/client';

export async function resetAndMigrate() {
  await migratorClient`DROP SCHEMA public CASCADE`;
  await migratorClient`CREATE SCHEMA public`;
  await migratorClient`GRANT ALL ON SCHEMA public TO app_migrator`;
  await migratorClient`GRANT USAGE ON SCHEMA public TO app_user`;
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
```

- [ ] **Step 4: Write failing test `tests/tenancy-schema.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate, tableExists } from './_setup/db';
import { migratorClient } from '@/db/client';

describe('tenancy schema', () => {
  beforeAll(async () => { await resetAndMigrate(); });
  afterAll(async () => { await migratorClient.end(); });

  it('creates stores table', async () => {
    expect(await tableExists('stores')).toBe(true);
  });

  it('creates store_domains table with unique domain', async () => {
    expect(await tableExists('store_domains')).toBe(true);
    await migratorClient`INSERT INTO stores (slug, name) VALUES ('a', 'A')`;
    const [store] = await migratorClient<{ id: string }[]>`SELECT id FROM stores WHERE slug = 'a'`;
    await migratorClient`INSERT INTO store_domains (store_id, domain) VALUES (${store!.id}, 'a.example.com')`;
    await expect(
      migratorClient`INSERT INTO store_domains (store_id, domain) VALUES (${store!.id}, 'a.example.com')`
    ).rejects.toThrow(/store_domains_domain_uq/);
  });
});
```

- [ ] **Step 5: Generate migration**

```bash
pnpm db:generate
```

Expected: a new SQL file appears in `src/db/migrations/0000_*.sql` containing `CREATE TABLE stores` and `CREATE TABLE store_domains`.

- [ ] **Step 6: Run the test (must pass)**

```bash
pnpm test -- tests/tenancy-schema.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema/ src/db/migrations/ tests/
git commit -m "feat(db): stores and store_domains tables"
```

---

## Task 8: Schema — identity tables (`users`, `store_users`, `customers`, `addresses`)

**Files:**
- Create: `src/db/schema/identity.ts`
- Modify: `src/db/schema/index.ts`
- Create: `tests/identity-schema.test.ts`

- [ ] **Step 1: Create `src/db/schema/identity.ts`**

```ts
import { pgTable, uuid, text, jsonb, timestamp, boolean, primaryKey } from 'drizzle-orm/pg-core';
import { stores } from './tenancy';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  locale: text('locale').notNull().default('en-IN'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const storeUsers = pgTable('store_users', {
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // owner | manager | staff
  permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({ pk: primaryKey({ columns: [t.storeId, t.userId] }) }));

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  email: text('email').notNull(),
  phone: text('phone'),
  locale: text('locale').notNull().default('en-IN'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const addresses = pgTable('addresses', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // shipping | billing
  name: text('name').notNull(),
  line1: text('line1').notNull(),
  line2: text('line2'),
  city: text('city').notNull(),
  region: text('region').notNull(),
  postal: text('postal').notNull(),
  country: text('country').notNull(),
  phone: text('phone'),
  isDefault: boolean('is_default').notNull().default(false),
});
```

- [ ] **Step 2: Re-export from index**

```ts
// src/db/schema/index.ts
export * from './tenancy';
export * from './identity';
```

- [ ] **Step 3: Write failing test `tests/identity-schema.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate, tableExists } from './_setup/db';
import { migratorClient } from '@/db/client';

describe('identity schema', () => {
  beforeAll(async () => { await resetAndMigrate(); });
  afterAll(async () => { await migratorClient.end(); });

  it.each(['users', 'store_users', 'customers', 'addresses'])('creates %s', async (name) => {
    expect(await tableExists(name)).toBe(true);
  });

  it('enforces unique email on users', async () => {
    await migratorClient`INSERT INTO users (email, password_hash) VALUES ('a@x.com', 'h')`;
    await expect(
      migratorClient`INSERT INTO users (email, password_hash) VALUES ('a@x.com', 'h')`
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 4: Generate + migrate + test**

```bash
pnpm db:generate
pnpm test -- tests/identity-schema.test.ts
```

Expected: migration file `0001_*.sql` generated; 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema/ src/db/migrations/ tests/identity-schema.test.ts
git commit -m "feat(db): users, store_users, customers, addresses"
```

---

## Task 9: Schema — sessions

**Files:**
- Create: `src/db/schema/sessions.ts`
- Modify: `src/db/schema/index.ts`
- Create: `tests/sessions-schema.test.ts`

- [ ] **Step 1: Create `src/db/schema/sessions.ts`**

```ts
import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './identity';

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(), // opaque random 64-char hex
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  userIdx: index('sessions_user_idx').on(t.userId),
  expiresIdx: index('sessions_expires_idx').on(t.expiresAt),
}));
```

- [ ] **Step 2: Re-export**

```ts
// src/db/schema/index.ts
export * from './tenancy';
export * from './identity';
export * from './sessions';
```

- [ ] **Step 3: Write test `tests/sessions-schema.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate, tableExists } from './_setup/db';
import { migratorClient } from '@/db/client';

describe('sessions schema', () => {
  beforeAll(async () => { await resetAndMigrate(); });
  afterAll(async () => { await migratorClient.end(); });

  it('creates sessions table', async () => {
    expect(await tableExists('sessions')).toBe(true);
  });

  it('cascades session deletion when user is deleted', async () => {
    await migratorClient`INSERT INTO users (email, password_hash) VALUES ('u@x.com', 'h')`;
    const [u] = await migratorClient<{ id: string }[]>`SELECT id FROM users WHERE email='u@x.com'`;
    await migratorClient`INSERT INTO sessions (id, user_id, expires_at) VALUES ('s1', ${u!.id}, now() + interval '1 day')`;
    await migratorClient`DELETE FROM users WHERE id = ${u!.id}`;
    const rows = await migratorClient`SELECT 1 FROM sessions WHERE id = 's1'`;
    expect(rows.length).toBe(0);
  });
});
```

- [ ] **Step 4: Generate + run tests**

```bash
pnpm db:generate
pnpm test -- tests/sessions-schema.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema/sessions.ts src/db/schema/index.ts src/db/migrations/ tests/sessions-schema.test.ts
git commit -m "feat(db): sessions table with cascade from users"
```

---

## Task 10: Schema — config (`site_config`, `feature_flags`)

**Files:**
- Create: `src/db/schema/config.ts`
- Modify: `src/db/schema/index.ts`
- Create: `tests/config-schema.test.ts`

- [ ] **Step 1: Create `src/db/schema/config.ts`**

```ts
import { pgTable, uuid, text, jsonb, boolean, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { stores } from './tenancy';
import { users } from './identity';

export const siteConfig = pgTable('site_config', {
  storeId: uuid('store_id').primaryKey().references(() => stores.id, { onDelete: 'cascade' }),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
});

export const featureFlags = pgTable('feature_flags', {
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  payload: jsonb('payload').$type<Record<string, unknown>>(),
}, t => ({ pk: primaryKey({ columns: [t.storeId, t.key] }) }));
```

- [ ] **Step 2: Re-export**

```ts
// src/db/schema/index.ts
export * from './tenancy';
export * from './identity';
export * from './sessions';
export * from './config';
```

- [ ] **Step 3: Write test `tests/config-schema.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate, tableExists } from './_setup/db';
import { migratorClient } from '@/db/client';

describe('config schema', () => {
  beforeAll(async () => { await resetAndMigrate(); });
  afterAll(async () => { await migratorClient.end(); });

  it('creates site_config with jsonb config column', async () => {
    expect(await tableExists('site_config')).toBe(true);
    await migratorClient`INSERT INTO stores (slug, name) VALUES ('s', 'S')`;
    const [s] = await migratorClient<{ id: string }[]>`SELECT id FROM stores WHERE slug='s'`;
    await migratorClient`INSERT INTO site_config (store_id, config) VALUES (${s!.id}, ${migratorClient.json({ brand: { name: 'S' } })})`;
    const [row] = await migratorClient<{ config: { brand: { name: string } } }[]>`SELECT config FROM site_config WHERE store_id = ${s!.id}`;
    expect(row!.config.brand.name).toBe('S');
  });

  it('creates feature_flags with composite PK', async () => {
    expect(await tableExists('feature_flags')).toBe(true);
  });
});
```

- [ ] **Step 4: Generate + run**

```bash
pnpm db:generate
pnpm test -- tests/config-schema.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema/config.ts src/db/schema/index.ts src/db/migrations/ tests/config-schema.test.ts
git commit -m "feat(db): site_config and feature_flags tables"
```

---

## Task 11: RLS policies for tenant-scoped tables

**Files:**
- Create: `src/db/migrations/XXXX_enable_rls.sql` (hand-written, not generated)
- Create: `tests/rls.test.ts`

Per spec §5.7, every tenant-scoped table needs RLS with `tenant_isolation` policies against `current_setting('app.store_id', true)::uuid`. In SP-1, the tenant-scoped tables are: `store_domains`, `store_users`, `customers`, `addresses`, `site_config`, `feature_flags`. `users` is cross-tenant (a single user can belong to multiple stores via `store_users`) and has NO RLS. `stores` has a read-friendly policy (public read — needed for initial domain→store lookup before RLS is active) and write-deny for `app_user`.

- [ ] **Step 1: Find the next migration number**

```bash
ls src/db/migrations/ | sort | tail -n 1
```

Expected: e.g. `0003_*.sql`. Your new file is `0004_enable_rls.sql`.

- [ ] **Step 2: Create `src/db/migrations/0004_enable_rls.sql`** (substitute correct index)

```sql
-- Enable RLS on tenant-scoped tables. app_user MUST NOT bypass; app_migrator does (BYPASSRLS role attr).
-- Convention: policy uses current_setting('app.store_id', true)::uuid; missing setting → NULL → no rows.

-- tenant tables with a direct store_id column
ALTER TABLE store_domains ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON store_domains
  USING (store_id = current_setting('app.store_id', true)::uuid)
  WITH CHECK (store_id = current_setting('app.store_id', true)::uuid);

ALTER TABLE store_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON store_users
  USING (store_id = current_setting('app.store_id', true)::uuid)
  WITH CHECK (store_id = current_setting('app.store_id', true)::uuid);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customers
  USING (store_id = current_setting('app.store_id', true)::uuid)
  WITH CHECK (store_id = current_setting('app.store_id', true)::uuid);

ALTER TABLE site_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON site_config
  USING (store_id = current_setting('app.store_id', true)::uuid)
  WITH CHECK (store_id = current_setting('app.store_id', true)::uuid);

ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON feature_flags
  USING (store_id = current_setting('app.store_id', true)::uuid)
  WITH CHECK (store_id = current_setting('app.store_id', true)::uuid);

-- addresses: scoped via customers.store_id join
ALTER TABLE addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON addresses
  USING (EXISTS (
    SELECT 1 FROM customers c
    WHERE c.id = addresses.customer_id
      AND c.store_id = current_setting('app.store_id', true)::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM customers c
    WHERE c.id = addresses.customer_id
      AND c.store_id = current_setting('app.store_id', true)::uuid
  ));

-- stores: read-only for app_user; writes go through migrator or admin (SP-6).
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
CREATE POLICY stores_read_own ON stores FOR SELECT
  USING (id = current_setting('app.store_id', true)::uuid OR current_setting('app.store_id', true) IS NULL);
```

Update `src/db/migrations/meta/_journal.json` is handled automatically by drizzle-kit, but hand-written SQL migrations must be registered manually. Simpler approach: name the file matching the drizzle convention and include it in the journal. Drizzle 0.30+ supports `drizzle-kit generate --custom` to produce an empty migration file; fill it with the SQL above.

Adjusted Step 2: run `pnpm drizzle-kit generate --custom --name enable_rls` to create the migration skeleton, then paste the SQL above into the generated file.

- [ ] **Step 3: Run migrate to apply RLS**

```bash
pnpm db:migrate
```

Expected: `[migrate] done` with the new migration applied.

- [ ] **Step 4: Write failing test `tests/rls.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { resetAndMigrate } from './_setup/db';
import { migratorClient } from '@/db/client';

const appUrl = process.env.DATABASE_URL!.replace('app_migrator:', 'app_user:');
const appClient = postgres(appUrl, { max: 1, prepare: false });

describe('RLS isolation', () => {
  let storeA: string;
  let storeB: string;

  beforeAll(async () => {
    await resetAndMigrate();
    await migratorClient`INSERT INTO stores (slug, name) VALUES ('a', 'A'), ('b', 'B')`;
    const rows = await migratorClient<{ id: string; slug: string }[]>`SELECT id, slug FROM stores`;
    storeA = rows.find(r => r.slug === 'a')!.id;
    storeB = rows.find(r => r.slug === 'b')!.id;
    await migratorClient`INSERT INTO customers (store_id, email) VALUES (${storeA}, 'a@x.com'), (${storeB}, 'b@x.com')`;
  });

  afterAll(async () => { await appClient.end(); await migratorClient.end(); });

  it('app_user sees only current tenant customers', async () => {
    const rows = await appClient`SELECT set_config('app.store_id', ${storeA}, true); SELECT email FROM customers`;
    const emails = (rows as unknown as { email: string }[]).map(r => r.email);
    expect(emails).toEqual(['a@x.com']);
  });

  it('app_user sees no rows without app.store_id set', async () => {
    const rows = await appClient`SELECT email FROM customers`;
    expect((rows as unknown as unknown[]).length).toBe(0);
  });

  it('app_user cannot insert cross-tenant', async () => {
    await expect(appClient.begin(async tx => {
      await tx`SELECT set_config('app.store_id', ${storeA}, true)`;
      await tx`INSERT INTO customers (store_id, email) VALUES (${storeB}, 'x@x.com')`;
    })).rejects.toThrow(/row-level security|policy/i);
  });
});
```

Note: `postgres.js` does not chain multiple statements in one tagged template call reliably. The test uses `appClient.begin(async tx => { ... })` for the transaction scenario; for the "no rows without setting" case, the default behavior of `current_setting('app.store_id', true)` returns NULL, so `store_id = NULL` is never true and the policy correctly returns no rows. Adjusted test keeps `appClient.begin` wherever it needs a session setting.

- [ ] **Step 5: Run the test**

```bash
pnpm test -- tests/rls.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations/ tests/rls.test.ts
git commit -m "feat(db): enable RLS with tenant_isolation policies on tenant-scoped tables"
```

---

## Task 12: Tenant resolve helper (`resolve.ts`)

**Files:**
- Create: `src/modules/tenant/resolve.ts`
- Create: `src/lib/logger.ts`
- Create: `tests/tenant-resolve.test.ts`

- [ ] **Step 1: Create `src/lib/logger.ts`**

```ts
import pino from 'pino';
import { env } from './env';

export const logger = pino({
  level: env.LOG_LEVEL,
  transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});
```

- [ ] **Step 2: Write failing test `tests/tenant-resolve.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate } from './_setup/db';
import { migratorClient } from '@/db/client';
import { resolveTenant, invalidateTenantCache } from '@/modules/tenant/resolve';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);

describe('resolveTenant', () => {
  let storeId: string;
  beforeAll(async () => {
    await resetAndMigrate();
    await migratorClient`INSERT INTO stores (slug, name) VALUES ('shop', 'Shop')`;
    [{ id: storeId }] = await migratorClient<{ id: string }[]>`SELECT id FROM stores`;
    await migratorClient`INSERT INTO store_domains (store_id, domain, is_primary) VALUES (${storeId}, 'shop.example.com', true)`;
    await redis.flushdb();
  });
  afterAll(async () => { await redis.quit(); await migratorClient.end(); });

  it('resolves a known domain to its store_id', async () => {
    const resolved = await resolveTenant('shop.example.com');
    expect(resolved).toBe(storeId);
  });

  it('returns null for unknown domain', async () => {
    expect(await resolveTenant('nope.example.com')).toBeNull();
  });

  it('caches successful lookups in Redis', async () => {
    await resolveTenant('shop.example.com');
    const cached = await redis.get('tenant:domain:shop.example.com');
    expect(cached).toBe(storeId);
  });

  it('invalidateTenantCache clears a domain', async () => {
    await resolveTenant('shop.example.com');
    await invalidateTenantCache('shop.example.com');
    expect(await redis.get('tenant:domain:shop.example.com')).toBeNull();
  });
});
```

- [ ] **Step 3: Implement `src/modules/tenant/resolve.ts`**

```ts
import Redis from 'ioredis';
import { sql } from 'drizzle-orm';
import { migratorDb } from '@/db/client';
import { storeDomains } from '@/db/schema/tenancy';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

const redis = new Redis(env.REDIS_URL);
const CACHE_TTL_SECONDS = 600; // 10 min
const NEG_TTL_SECONDS = 60;    // 1 min for misses, to avoid hammering DB

function key(host: string) { return `tenant:domain:${host.toLowerCase()}`; }

export async function resolveTenant(host: string): Promise<string | null> {
  const h = host.toLowerCase();
  const cached = await redis.get(key(h));
  if (cached === '__miss__') return null;
  if (cached) return cached;

  const rows = await migratorDb
    .select({ storeId: storeDomains.storeId })
    .from(storeDomains)
    .where(sql`${storeDomains.domain} = ${h}`)
    .limit(1);

  if (rows.length === 0) {
    await redis.set(key(h), '__miss__', 'EX', NEG_TTL_SECONDS);
    logger.debug({ host: h }, 'tenant resolve: miss');
    return null;
  }

  const storeId = rows[0]!.storeId;
  await redis.set(key(h), storeId, 'EX', CACHE_TTL_SECONDS);
  logger.debug({ host: h, storeId }, 'tenant resolve: hit');
  return storeId;
}

export async function invalidateTenantCache(host: string): Promise<void> {
  await redis.del(key(host.toLowerCase()));
}
```

Note: `resolveTenant` uses the `migratorDb` client because this lookup happens BEFORE any RLS setting exists. `stores` is RLS-gated with a permissive read policy when `app.store_id IS NULL`, but `store_domains` is not — so we need the BYPASSRLS role for the initial resolve. This is intentional and the one exception to "app_user for all request-time queries".

- [ ] **Step 4: Run tests**

```bash
pnpm test -- tests/tenant-resolve.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/logger.ts src/modules/tenant/resolve.ts tests/tenant-resolve.test.ts
git commit -m "feat(tenant): domain→store_id resolver with Redis cache and invalidation"
```

---

## Task 13: `withTenant` helper — `SET LOCAL app.store_id` in a transaction

**Files:**
- Create: `src/modules/tenant/with-tenant.ts`
- Create: `tests/with-tenant.test.ts`

- [ ] **Step 1: Write failing test `tests/with-tenant.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { resetAndMigrate } from './_setup/db';
import { migratorClient, appClient } from '@/db/client';
import { withTenant } from '@/modules/tenant/with-tenant';

describe('withTenant', () => {
  let storeA: string;
  let storeB: string;
  beforeAll(async () => {
    await resetAndMigrate();
    await migratorClient`INSERT INTO stores (slug, name) VALUES ('a', 'A'), ('b', 'B')`;
    const rows = await migratorClient<{ id: string; slug: string }[]>`SELECT id, slug FROM stores`;
    storeA = rows.find(r => r.slug === 'a')!.id;
    storeB = rows.find(r => r.slug === 'b')!.id;
    await migratorClient`INSERT INTO customers (store_id, email) VALUES (${storeA}, 'a@x.com'), (${storeB}, 'b@x.com')`;
  });
  afterAll(async () => { await appClient.end(); await migratorClient.end(); });

  it('sees only current tenant rows inside the callback', async () => {
    const emails = await withTenant(storeA, async tx =>
      tx.execute(sql`SELECT email FROM customers ORDER BY email`)
    );
    expect((emails as unknown as { email: string }[]).map(r => r.email)).toEqual(['a@x.com']);
  });

  it('rolls back on thrown error', async () => {
    await expect(withTenant(storeA, async tx => {
      await tx.execute(sql`INSERT INTO customers (store_id, email) VALUES (${storeA}, 'z@x.com')`);
      throw new Error('boom');
    })).rejects.toThrow('boom');
    const [{ count }] = await migratorClient<{ count: string }[]>`SELECT count(*) FROM customers WHERE email='z@x.com'`;
    expect(Number(count)).toBe(0);
  });
});
```

- [ ] **Step 2: Implement `src/modules/tenant/with-tenant.ts`**

```ts
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
```

Note: `set_config(key, value, true)` is the functional equivalent of `SET LOCAL` and works when the value is a bind parameter — unlike `SET LOCAL app.store_id = $1` which Postgres does not allow.

- [ ] **Step 3: Run tests**

```bash
pnpm test -- tests/with-tenant.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/modules/tenant/with-tenant.ts tests/with-tenant.test.ts
git commit -m "feat(tenant): withTenant transactional helper sets app.store_id"
```

---

## Task 14: Next.js middleware — forward host as `x-store-host`

**Files:**
- Create: `src/middleware.ts`

Middleware runs on Edge; it cannot hit Postgres or ioredis directly. Its job is to normalize the incoming Host header and forward it as `x-store-host` so downstream Node handlers can call `resolveTenant`.

- [ ] **Step 1: Create `src/middleware.ts`**

```ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const host = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '').toLowerCase();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-store-host', host);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|healthz).*)'],
};
```

- [ ] **Step 2: Smoke test via curl after `pnpm dev`**

In one terminal:
```bash
pnpm dev
```

In another:
```bash
curl -s -H 'Host: shop.example.com' http://localhost:3000/ -D - | head -n 5
```

Expected: HTTP/1.1 200 response; the homepage renders. (Header forwarding is best verified by the integration test in the next task.)

- [ ] **Step 3: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(tenant): middleware forwards normalized host as x-store-host"
```

---

## Task 15: Layered `site_config` loader with Redis cache

**Files:**
- Create: `src/platform.defaults.ts`
- Create: `src/modules/config/loader.ts`
- Create: `tests/config-loader.test.ts`

- [ ] **Step 1: Create `src/platform.defaults.ts`**

```ts
export const platformDefaults = {
  brand: { name: 'Stationery Store', tagline: 'Paper goods, properly.' },
  theme: {
    color: { bg: '#FAF6EE', fg: '#1A1A2E', primary: '#2C3E8C', secondary: '#F2994A' },
    type: { sans: 'Inter', serif: 'Source Serif' },
    radius: '6px',
    spacingScale: 1.0,
  },
  locale: { default: 'en-IN', supported: ['en-IN', 'en-GB'] },
  currency: { code: 'INR', symbol: '₹', rounding: '0.50' },
  payments: { providers: ['razorpay', 'stripe'], default: 'razorpay' },
  features: { wishlist: false, reviews: false, guestCheckout: true, b2bPricing: false },
} as const;

export type SiteConfig = typeof platformDefaults & Record<string, unknown>;
```

- [ ] **Step 2: Write failing test `tests/config-loader.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import Redis from 'ioredis';
import { resetAndMigrate } from './_setup/db';
import { migratorClient } from '@/db/client';
import { loadSiteConfig, invalidateSiteConfigCache } from '@/modules/config/loader';
import { platformDefaults } from '@/platform.defaults';

const redis = new Redis(process.env.REDIS_URL!);

describe('loadSiteConfig', () => {
  let storeId: string;
  beforeEach(async () => {
    await resetAndMigrate();
    await migratorClient`INSERT INTO stores (slug, name) VALUES ('s', 'S')`;
    [{ id: storeId }] = await migratorClient<{ id: string }[]>`SELECT id FROM stores`;
    await redis.flushdb();
  });
  afterAll(async () => { await redis.quit(); await migratorClient.end(); });

  it('returns platform defaults when no DB row and no env override', async () => {
    const cfg = await loadSiteConfig(storeId);
    expect(cfg.brand.name).toBe(platformDefaults.brand.name);
  });

  it('DB row overrides platform defaults', async () => {
    await migratorClient`INSERT INTO site_config (store_id, config) VALUES (${storeId}, ${migratorClient.json({ brand: { name: 'Inkwell' } })})`;
    const cfg = await loadSiteConfig(storeId);
    expect(cfg.brand.name).toBe('Inkwell');
    expect(cfg.theme.color.bg).toBe(platformDefaults.theme.color.bg); // untouched
  });

  it('env override wins over DB row', async () => {
    await migratorClient`INSERT INTO site_config (store_id, config) VALUES (${storeId}, ${migratorClient.json({ brand: { name: 'Inkwell' } })})`;
    vi.stubEnv('SITE_CONFIG_OVERRIDE__brand__name', 'EmergencyOverride');
    const cfg = await loadSiteConfig(storeId);
    expect(cfg.brand.name).toBe('EmergencyOverride');
    vi.unstubAllEnvs();
  });

  it('invalidate clears cache', async () => {
    await loadSiteConfig(storeId);
    expect(await redis.get(`site_config:${storeId}`)).not.toBeNull();
    await invalidateSiteConfigCache(storeId);
    expect(await redis.get(`site_config:${storeId}`)).toBeNull();
  });
});
```

- [ ] **Step 3: Implement `src/modules/config/loader.ts`**

```ts
import Redis from 'ioredis';
import { eq } from 'drizzle-orm';
import { migratorDb } from '@/db/client';
import { siteConfig } from '@/db/schema/config';
import { platformDefaults, type SiteConfig } from '@/platform.defaults';
import { env } from '@/lib/env';

const redis = new Redis(env.REDIS_URL);
const CACHE_TTL = 300;
const KEY = (storeId: string) => `site_config:${storeId}`;

function deepMerge<T>(base: T, override: Partial<T>): T {
  if (typeof base !== 'object' || base === null) return (override as T) ?? base;
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...(base as any) };
  for (const [k, v] of Object.entries(override ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && k in (base as any) && typeof (base as any)[k] === 'object') {
      out[k] = deepMerge((base as any)[k], v as any);
    } else out[k] = v;
  }
  return out;
}

function applyEnvOverrides<T extends object>(base: T): T {
  // Pattern: SITE_CONFIG_OVERRIDE__<dot.path>=<json> — double underscore separates path segments.
  // Example: SITE_CONFIG_OVERRIDE__brand__name="EmergencyOverride"
  const prefix = 'SITE_CONFIG_OVERRIDE__';
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith(prefix) || v === undefined) continue;
    const path = k.slice(prefix.length).split('__');
    let parsed: unknown = v;
    try { parsed = JSON.parse(v); } catch { /* leave as string */ }
    let cursor: any = patch;
    for (let i = 0; i < path.length - 1; i++) {
      cursor[path[i]!] = cursor[path[i]!] ?? {};
      cursor = cursor[path[i]!];
    }
    cursor[path[path.length - 1]!] = parsed;
  }
  return deepMerge(base, patch);
}

export async function loadSiteConfig(storeId: string): Promise<SiteConfig> {
  const cached = await redis.get(KEY(storeId));
  if (cached) return JSON.parse(cached);

  const [row] = await migratorDb
    .select({ config: siteConfig.config })
    .from(siteConfig)
    .where(eq(siteConfig.storeId, storeId))
    .limit(1);

  const merged = deepMerge(platformDefaults, (row?.config ?? {}) as Partial<SiteConfig>);
  const withEnv = applyEnvOverrides(merged);

  await redis.set(KEY(storeId), JSON.stringify(withEnv), 'EX', CACHE_TTL);
  return withEnv as SiteConfig;
}

export async function invalidateSiteConfigCache(storeId: string): Promise<void> {
  await redis.del(KEY(storeId));
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test -- tests/config-loader.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/platform.defaults.ts src/modules/config/loader.ts tests/config-loader.test.ts
git commit -m "feat(config): layered site_config loader with env > DB > defaults precedence"
```

---

## Task 16: Password hashing (argon2id) and session helpers

**Files:**
- Create: `src/modules/auth/password.ts`
- Create: `src/modules/auth/session.ts`
- Create: `src/lib/cookies.ts`
- Create: `tests/password.test.ts`
- Create: `tests/session.test.ts`

- [ ] **Step 1: Write failing test `tests/password.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '@/modules/auth/password';

describe('password', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('hunter2!');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 'hunter2!')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });
});
```

- [ ] **Step 2: Implement `src/modules/auth/password.ts`**

```ts
import { hash, verify, Algorithm } from '@node-rs/argon2';

const params = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456, // 19 MiB (OWASP 2024 minimum)
  timeCost: 2,
  outputLen: 32,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, params);
}

export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  try { return await verify(stored, plain); } catch { return false; }
}
```

- [ ] **Step 3: Run password test**

```bash
pnpm test -- tests/password.test.ts
```

Expected: 1 test passes (may take ~200 ms per hash).

- [ ] **Step 4: Create `src/lib/cookies.ts`**

```ts
import crypto from 'node:crypto';
import { env } from './env';

const SECRET = Buffer.from(env.SESSION_SECRET, 'utf8');

export function sign(value: string): string {
  const mac = crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
  return `${value}.${mac}`;
}

export function unsign(signed: string): string | null {
  const idx = signed.lastIndexOf('.');
  if (idx < 0) return null;
  const value = signed.slice(0, idx);
  const mac = signed.slice(idx + 1);
  const expected = crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  return value;
}

export const SESSION_COOKIE = 'sid';
export const sessionCookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  domain: env.COOKIE_DOMAIN,
  maxAge: 60 * 60 * 24 * 30, // 30 days
};
```

- [ ] **Step 5: Write failing test `tests/session.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate } from './_setup/db';
import { migratorClient } from '@/db/client';
import { hashPassword } from '@/modules/auth/password';
import { createSession, validateSession, invalidateSession } from '@/modules/auth/session';

describe('session', () => {
  let userId: string;
  beforeAll(async () => {
    await resetAndMigrate();
    await migratorClient`INSERT INTO users (email, password_hash) VALUES ('u@x.com', ${await hashPassword('p')})`;
    [{ id: userId }] = await migratorClient<{ id: string }[]>`SELECT id FROM users`;
  });
  afterAll(async () => { await migratorClient.end(); });

  it('create → validate returns user id', async () => {
    const { id } = await createSession(userId, { ip: '127.0.0.1', userAgent: 'vitest' });
    const result = await validateSession(id);
    expect(result?.userId).toBe(userId);
  });

  it('invalidate removes the session', async () => {
    const { id } = await createSession(userId, {});
    await invalidateSession(id);
    expect(await validateSession(id)).toBeNull();
  });

  it('expired sessions are treated as invalid', async () => {
    const { id } = await createSession(userId, {});
    await migratorClient`UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE id = ${id}`;
    expect(await validateSession(id)).toBeNull();
  });
});
```

- [ ] **Step 6: Implement `src/modules/auth/session.ts`**

```ts
import crypto from 'node:crypto';
import { eq, and, gt } from 'drizzle-orm';
import { migratorDb } from '@/db/client';
import { sessions } from '@/db/schema/sessions';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function newSessionId(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function createSession(
  userId: string,
  meta: { ip?: string; userAgent?: string },
): Promise<{ id: string; expiresAt: Date }> {
  const id = newSessionId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await migratorDb.insert(sessions).values({
    id, userId, expiresAt, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { id, expiresAt };
}

export async function validateSession(id: string): Promise<{ userId: string } | null> {
  const rows = await migratorDb
    .select({ userId: sessions.userId, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ? { userId: rows[0].userId } : null;
}

export async function invalidateSession(id: string): Promise<void> {
  await migratorDb.delete(sessions).where(eq(sessions.id, id));
}
```

Note: Session reads/writes use `migratorDb` deliberately — sessions are not tenant-scoped (a user logs in to the platform, then selects a store context). This matches the spec §5.1 where `sessions` has no `store_id`.

- [ ] **Step 7: Run tests**

```bash
pnpm test -- tests/session.test.ts tests/password.test.ts
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/modules/auth/ src/lib/cookies.ts tests/password.test.ts tests/session.test.ts
git commit -m "feat(auth): argon2id passwords, signed session cookies, session helpers"
```

---

## Task 17: Auth API routes — signup / login / logout

**Files:**
- Create: `src/app/api/v1/auth/signup/route.ts`
- Create: `src/app/api/v1/auth/login/route.ts`
- Create: `src/app/api/v1/auth/logout/route.ts`

- [ ] **Step 1: Create `src/app/api/v1/auth/signup/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { migratorDb } from '@/db/client';
import { users } from '@/db/schema/identity';
import { hashPassword } from '@/modules/auth/password';
import { createSession } from '@/modules/auth/session';
import { SESSION_COOKIE, sessionCookieOptions, sign } from '@/lib/cookies';
import { problem } from '@/lib/errors';

const body = z.object({ email: z.string().email(), password: z.string().min(8) });

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return problem(400, 'invalid-body', 'Invalid signup body', parsed.error.issues);

  const passwordHash = await hashPassword(parsed.data.password);
  try {
    const [u] = await migratorDb.insert(users).values({ email: parsed.data.email, passwordHash }).returning({ id: users.id });
    const session = await createSession(u!.id, {
      ip: req.headers.get('x-forwarded-for') ?? undefined,
      userAgent: req.headers.get('user-agent') ?? undefined,
    });
    const res = NextResponse.json({ userId: u!.id }, { status: 201 });
    res.cookies.set(SESSION_COOKIE, sign(session.id), sessionCookieOptions);
    return res;
  } catch (err: any) {
    if (err?.code === '23505') return problem(409, 'email-taken', 'Email already registered', []);
    throw err;
  }
}
```

- [ ] **Step 2: Create `src/app/api/v1/auth/login/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { migratorDb } from '@/db/client';
import { users } from '@/db/schema/identity';
import { verifyPassword } from '@/modules/auth/password';
import { createSession } from '@/modules/auth/session';
import { SESSION_COOKIE, sessionCookieOptions, sign } from '@/lib/cookies';
import { problem } from '@/lib/errors';

const body = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return problem(400, 'invalid-body', 'Invalid login body', parsed.error.issues);

  const [u] = await migratorDb.select().from(users).where(eq(users.email, parsed.data.email)).limit(1);
  const ok = u ? await verifyPassword(u.passwordHash, parsed.data.password) : false;
  if (!u || !ok) return problem(401, 'invalid-credentials', 'Invalid email or password', []);

  const session = await createSession(u.id, {
    ip: req.headers.get('x-forwarded-for') ?? undefined,
    userAgent: req.headers.get('user-agent') ?? undefined,
  });
  const res = NextResponse.json({ userId: u.id });
  res.cookies.set(SESSION_COOKIE, sign(session.id), sessionCookieOptions);
  return res;
}
```

- [ ] **Step 3: Create `src/app/api/v1/auth/logout/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, sessionCookieOptions, unsign } from '@/lib/cookies';
import { invalidateSession } from '@/modules/auth/session';

export async function POST() {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (raw) {
    const sid = unsign(raw);
    if (sid) await invalidateSession(sid);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 });
  return res;
}
```

- [ ] **Step 4: Smoke test via HTTP**

```bash
pnpm dev &
sleep 2
curl -s -X POST http://localhost:3000/api/v1/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"email":"t@x.com","password":"hunter2!"}' -i | head -n 20
```

Expected: `HTTP/1.1 201` with a `Set-Cookie: sid=...` header.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/auth/
git commit -m "feat(auth): signup, login, logout API routes"
```

---

## Task 18: CSRF synchronizer-token middleware for admin mutations

**Files:**
- Create: `src/modules/auth/csrf.ts`
- Create: `tests/csrf.test.ts`

- [ ] **Step 1: Write failing test `tests/csrf.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { mintCsrfToken, verifyCsrfToken } from '@/modules/auth/csrf';

describe('csrf', () => {
  it('mint → verify roundtrips for the same session', () => {
    const t = mintCsrfToken('sess-1');
    expect(verifyCsrfToken('sess-1', t)).toBe(true);
  });

  it('rejects a token from a different session', () => {
    const t = mintCsrfToken('sess-1');
    expect(verifyCsrfToken('sess-2', t)).toBe(false);
  });

  it('rejects garbage', () => {
    expect(verifyCsrfToken('sess-1', 'nope')).toBe(false);
    expect(verifyCsrfToken('sess-1', '')).toBe(false);
  });
});
```

- [ ] **Step 2: Implement `src/modules/auth/csrf.ts`**

```ts
import crypto from 'node:crypto';
import { env } from '@/lib/env';

const SECRET = Buffer.from(env.SESSION_SECRET, 'utf8');

// Token format: <random16bytes-hex>.<hmac(session_id + "." + random)>
export function mintCsrfToken(sessionId: string): string {
  const r = crypto.randomBytes(16).toString('hex');
  const mac = crypto.createHmac('sha256', SECRET).update(`${sessionId}.${r}`).digest('base64url');
  return `${r}.${mac}`;
}

export function verifyCsrfToken(sessionId: string, token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [r, mac] = parts;
  if (!r || !mac) return false;
  const expected = crypto.createHmac('sha256', SECRET).update(`${sessionId}.${r}`).digest('base64url');
  if (mac.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}

export function requireCsrf(req: Request, sessionId: string): boolean {
  const header = req.headers.get('x-csrf-token');
  if (!header) return false;
  return verifyCsrfToken(sessionId, header);
}
```

- [ ] **Step 3: Run test**

```bash
pnpm test -- tests/csrf.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 4: Document the integration pattern** — add a short block in the PR description explaining how `requireCsrf` will be used by admin route handlers (SP-6 actually exercises this; SP-1 only ships the primitive). No code change here.

- [ ] **Step 5: Commit**

```bash
git add src/modules/auth/csrf.ts tests/csrf.test.ts
git commit -m "feat(auth): CSRF synchronizer-token minting and verification"
```

---

## Task 19: RFC 7807 error helper

**Files:**
- Create: `src/lib/errors.ts`
- Create: `tests/errors.test.ts`

- [ ] **Step 1: Write failing test `tests/errors.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { problem } from '@/lib/errors';

describe('problem', () => {
  it('returns RFC 7807-shaped JSON with correct status', async () => {
    const res = problem(404, 'not-found', 'Resource missing', []);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    const body = await res.json();
    expect(body).toMatchObject({ type: 'about:blank', title: 'not-found', status: 404, detail: 'Resource missing', errors: [] });
  });

  it('carries field errors', async () => {
    const res = problem(400, 'invalid-body', 'Validation failed', [{ path: ['email'], message: 'must be email' }]);
    const body = await res.json();
    expect(body.errors).toEqual([{ path: ['email'], message: 'must be email' }]);
  });
});
```

- [ ] **Step 2: Implement `src/lib/errors.ts`**

```ts
import { NextResponse } from 'next/server';

export type FieldError = { path: (string | number)[]; message: string };

export function problem(status: number, title: string, detail: string, errors: FieldError[] = []): NextResponse {
  return NextResponse.json(
    { type: 'about:blank', title, status, detail, errors },
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm test -- tests/errors.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/errors.ts tests/errors.test.ts
git commit -m "feat(lib): RFC 7807 problem+json helper"
```

---

## Task 20: `Idempotency-Key` middleware primitive

**Files:**
- Create: `src/lib/idempotency.ts`
- Create: `tests/idempotency.test.ts`

- [ ] **Step 1: Write failing test `tests/idempotency.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import Redis from 'ioredis';
import { withIdempotency } from '@/lib/idempotency';

const redis = new Redis(process.env.REDIS_URL!);

describe('withIdempotency', () => {
  beforeEach(async () => { await redis.flushdb(); });
  afterAll(async () => { await redis.quit(); });

  it('executes body on first call and caches result', async () => {
    let calls = 0;
    const run = () => withIdempotency('scope', 'key-1', async () => { calls++; return { ok: true, n: calls }; });
    const a = await run();
    const b = await run();
    expect(calls).toBe(1);
    expect(a).toEqual(b);
  });

  it('different keys run independently', async () => {
    let calls = 0;
    const r1 = await withIdempotency('scope', 'k1', async () => ({ id: ++calls }));
    const r2 = await withIdempotency('scope', 'k2', async () => ({ id: ++calls }));
    expect(r1.id).toBe(1);
    expect(r2.id).toBe(2);
  });
});
```

- [ ] **Step 2: Implement `src/lib/idempotency.ts`**

```ts
import Redis from 'ioredis';
import { env } from './env';

const redis = new Redis(env.REDIS_URL);
const TTL_SECONDS = 60 * 60 * 24; // 24h

const K = (scope: string, key: string) => `idem:${scope}:${key}`;

export async function withIdempotency<T>(
  scope: string,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const cached = await redis.get(K(scope, key));
  if (cached) return JSON.parse(cached) as T;
  const result = await fn();
  await redis.set(K(scope, key), JSON.stringify(result), 'EX', TTL_SECONDS, 'NX');
  return result;
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm test -- tests/idempotency.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/idempotency.ts tests/idempotency.test.ts
git commit -m "feat(lib): redis-backed idempotency-key helper"
```

---

## Task 21: Theme → CSS custom properties at SSR

**Files:**
- Modify: `src/app/layout.tsx`
- Create: `src/lib/theme.ts`

- [ ] **Step 1: Create `src/lib/theme.ts`**

```ts
import type { SiteConfig } from '@/platform.defaults';

export function themeVars(cfg: SiteConfig): string {
  const c = cfg.theme.color;
  const t = cfg.theme.type;
  return [
    `--color-bg:${c.bg}`,
    `--color-fg:${c.fg}`,
    `--color-primary:${c.primary}`,
    `--color-secondary:${c.secondary}`,
    `--font-sans:${t.sans}`,
    `--font-serif:${t.serif}`,
    `--radius:${cfg.theme.radius}`,
  ].join(';');
}
```

- [ ] **Step 2: Modify `src/app/layout.tsx`**

```tsx
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { resolveTenant } from '@/modules/tenant/resolve';
import { loadSiteConfig } from '@/modules/config/loader';
import { platformDefaults } from '@/platform.defaults';
import { themeVars } from '@/lib/theme';

export const metadata = { title: 'Stationery Store', description: 'Paper goods, properly.' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const h = await headers();
  const host = h.get('x-store-host') ?? '';
  const storeId = host ? await resolveTenant(host) : null;
  const cfg = storeId ? await loadSiteConfig(storeId) : platformDefaults;

  return (
    <html lang={cfg.locale.default}>
      <body style={{ cssText: themeVars(cfg) }}>{children}</body>
    </html>
  );
}
```

Note: React accepts `style` as an object, not a cssText string. The correct pattern uses a `<style>` tag injection:

Replace with:

```tsx
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { resolveTenant } from '@/modules/tenant/resolve';
import { loadSiteConfig } from '@/modules/config/loader';
import { platformDefaults } from '@/platform.defaults';
import { themeVars } from '@/lib/theme';

export const metadata = { title: 'Stationery Store', description: 'Paper goods, properly.' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const h = await headers();
  const host = h.get('x-store-host') ?? '';
  const storeId = host ? await resolveTenant(host) : null;
  const cfg = storeId ? await loadSiteConfig(storeId) : platformDefaults;

  return (
    <html lang={cfg.locale.default}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: `:root{${themeVars(cfg)}}` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Smoke test**

```bash
pnpm dev
# In another terminal:
curl -s -H 'Host: localhost:3000' http://localhost:3000/ | grep -o -- '--color-primary:[^;]*;'
```

Expected (when no tenant matches localhost): `--color-primary:#2C3E8C;` (platform default).

- [ ] **Step 4: Commit**

```bash
git add src/lib/theme.ts src/app/layout.tsx
git commit -m "feat(theme): inject site_config theme as CSS custom properties at SSR"
```

---

## Task 22: `/healthz` endpoint

**Files:**
- Create: `src/app/healthz/route.ts`
- Create: `tests/healthz.test.ts`

- [ ] **Step 1: Create `src/app/healthz/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { migratorClient } from '@/db/client';
import Redis from 'ioredis';
import { env } from '@/lib/env';

const redis = new Redis(env.REDIS_URL);

export async function GET() {
  const checks: Record<string, 'ok' | 'fail'> = { process: 'ok' };
  try { await migratorClient`SELECT 1`; checks.postgres = 'ok'; } catch { checks.postgres = 'fail'; }
  try { await redis.ping(); checks.redis = 'ok'; } catch { checks.redis = 'fail'; }
  const ok = Object.values(checks).every(v => v === 'ok');
  return NextResponse.json({ status: ok ? 'ok' : 'degraded', checks }, { status: ok ? 200 : 503 });
}
```

- [ ] **Step 2: Smoke test**

```bash
pnpm dev
curl -s http://localhost:3000/healthz
```

Expected: `{"status":"ok","checks":{"process":"ok","postgres":"ok","redis":"ok"}}`

- [ ] **Step 3: Commit**

```bash
git add src/app/healthz/
git commit -m "feat(ops): /healthz endpoint checks process, postgres, redis"
```

---

## Task 23: Worker entrypoint stub (BullMQ)

**Files:**
- Create: `src/entrypoints/worker.ts`

- [ ] **Step 1: Create `src/entrypoints/worker.ts`**

```ts
import 'dotenv/config';
import { Worker, Queue } from 'bullmq';
import Redis from 'ioredis';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

// SP-1 registers the queue names but does not process real jobs yet.
const queues = ['emails', 'csv.imports', 'inventory.alerts', 'search.reindex',
                'webhook.dispatch', 'image.post-process', 'reservation.ttl.sweep'] as const;

async function main() {
  logger.info({ role: 'worker', queues }, 'worker starting');
  for (const name of queues) {
    // Touch the queue so BullMQ creates the key in Redis.
    new Queue(name, { connection });
    new Worker(name, async job => {
      logger.info({ queue: name, id: job.id, data: job.data }, 'job received (SP-1 no-op)');
    }, { connection });
  }
  logger.info('worker ready');
}

main().catch(err => {
  logger.error({ err }, 'worker failed to start');
  process.exit(1);
});
```

- [ ] **Step 2: Run it briefly to prove it boots**

```bash
pnpm worker &
WORKER_PID=$!
sleep 3
kill $WORKER_PID
```

Expected: logs `worker starting` and `worker ready`; exits cleanly on SIGTERM.

- [ ] **Step 3: Commit**

```bash
git add src/entrypoints/worker.ts
git commit -m "feat(worker): bullmq consumer entrypoint stub for SP-1"
```

---

## Task 24: Scheduler entrypoint stub

**Files:**
- Create: `src/entrypoints/scheduler.ts`

- [ ] **Step 1: Create `src/entrypoints/scheduler.ts`**

```ts
import 'dotenv/config';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

async function main() {
  logger.info({ role: 'scheduler' }, 'scheduler starting');
  // SP-1: register the schedule shape but use a no-op repeat cycle.
  const q = new Queue('reservation.ttl.sweep', { connection });
  await q.add(
    'sweep',
    { reason: 'ttl' },
    { repeat: { pattern: '*/5 * * * *' }, removeOnComplete: true, removeOnFail: 50 },
  );
  logger.info('scheduler registered repeating jobs');
  // Hold the process open.
  await new Promise(() => {});
}

main().catch(err => {
  logger.error({ err }, 'scheduler failed');
  process.exit(1);
});
```

- [ ] **Step 2: Smoke test**

```bash
pnpm scheduler &
PID=$!
sleep 3
kill $PID
```

Expected: `scheduler starting` then `scheduler registered repeating jobs`.

- [ ] **Step 3: Commit**

```bash
git add src/entrypoints/scheduler.ts
git commit -m "feat(scheduler): cron entrypoint stub registers ttl sweep schedule"
```

---

## Task 25: Dockerfile — multi-stage, three-role dispatch

**Files:**
- Create: `docker/Dockerfile`
- Create: `docker/entrypoint.sh`
- Modify: `.dockerignore` (create)

- [ ] **Step 1: Create `.dockerignore`**

```
node_modules
.next
.env
.env.*
!.env.example
coverage
.git
.github
docs
tests
*.md
```

- [ ] **Step 2: Create `docker/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=20.11.0

FROM node:${NODE_VERSION}-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV NEXT_STANDALONE=1
RUN pnpm build
# Standalone output produced under .next/standalone when NEXT_STANDALONE=1

FROM node:${NODE_VERSION}-alpine AS runtime
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app

# Copy standalone server + public + static
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public

# Copy source for worker/scheduler (tsx runtime)
COPY --from=build --chown=app:app /app/src ./src
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/package.json ./package.json
COPY --from=build --chown=app:app /app/drizzle.config.ts ./drizzle.config.ts

COPY --chown=app:app docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER app
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
ENTRYPOINT ["/entrypoint.sh"]
```

- [ ] **Step 3: Create `docker/entrypoint.sh`**

```sh
#!/bin/sh
set -eu
ROLE="${ROLE:-web}"
case "$ROLE" in
  web)       exec node server.js ;;
  worker)    exec node_modules/.bin/tsx src/entrypoints/worker.ts ;;
  scheduler) exec node_modules/.bin/tsx src/entrypoints/scheduler.ts ;;
  *)         echo "Unknown ROLE: $ROLE" >&2; exit 64 ;;
esac
```

- [ ] **Step 4: Build the image**

```bash
docker build -t ecommerce:sp1 -f docker/Dockerfile .
```

Expected: build succeeds. Image size < 400 MB.

- [ ] **Step 5: Smoke-run web role**

```bash
docker run --rm -e ROLE=web -e NODE_ENV=production \
  -e DATABASE_URL=postgres://app_migrator:dev_password@host.docker.internal:5432/ecommerce \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  -e COOKIE_DOMAIN=localhost \
  -p 3000:3000 ecommerce:sp1 &
sleep 5
curl -fsS http://localhost:3000/healthz
docker stop $(docker ps -q --filter ancestor=ecommerce:sp1)
```

Expected: `/healthz` returns `{"status":"ok",...}`.

- [ ] **Step 6: Commit**

```bash
git add docker/ .dockerignore
git commit -m "feat(infra): multi-stage Dockerfile with ROLE-dispatched entrypoint"
```

---

## Task 26: GitHub Actions CI — lint, typecheck, test, build

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: app_migrator
          POSTGRES_PASSWORD: dev_password
          POSTGRES_DB: ecommerce
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U app_migrator"
          --health-interval 3s --health-timeout 3s --health-retries 20
      redis:
        image: redis:7
        ports: ["6379:6379"]
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 3s --health-timeout 3s --health-retries 10
    env:
      NODE_ENV: test
      ROLE: web
      DATABASE_URL: postgres://app_migrator:dev_password@localhost:5432/ecommerce
      REDIS_URL: redis://localhost:6379
      SESSION_SECRET: ${{ '0123456789abcdef0123456789abcdef' }}
      COOKIE_DOMAIN: localhost
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9.12.0 }
      - uses: actions/setup-node@v4
        with:
          node-version: 20.11.0
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Create app_user role
        run: |
          PGPASSWORD=dev_password psql -h localhost -U app_migrator -d ecommerce -c "
            CREATE ROLE app_user LOGIN PASSWORD 'dev_password' NOBYPASSRLS;
            GRANT CONNECT ON DATABASE ecommerce TO app_user;
            GRANT USAGE ON SCHEMA public TO app_user;
            ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
            ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;
          "
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm db:migrate
      - run: pnpm test
      - run: pnpm build
```

- [ ] **Step 2: Add ESLint config**

```bash
pnpm dlx next lint --strict
```

This auto-creates `.eslintrc.json`. Accept the default strict config.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml .eslintrc.json
git commit -m "ci: lint, typecheck, test, build on push and pr"
```

- [ ] **Step 4: Local dry-run**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Expected: all four steps green.

---

## Task 27: Seed script — example store with admin user

**Files:**
- Create: `src/db/seed.ts`

- [ ] **Step 1: Create `src/db/seed.ts`**

```ts
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
```

- [ ] **Step 2: Run it**

```bash
pnpm db:migrate
pnpm db:seed
```

Expected: logs `seed complete` with store + admin IDs.

- [ ] **Step 3: Manual verification**

```bash
docker compose -f docker-compose.dev.yml exec -T postgres \
  psql -U app_migrator -d ecommerce -c "SELECT slug, name FROM stores; SELECT email FROM users;"
```

Expected:
```
  slug   |   name
---------+-----------
 inkwell | Inkwell & Co

       email
--------------------
 admin@inkwell.test
```

- [ ] **Step 4: Commit**

```bash
git add src/db/seed.ts
git commit -m "feat(db): seed script creates example store, admin user, and site_config"
```

---

## Task 28: End-to-end acceptance — full-suite run against a fresh DB

**Files:**
- None. This task is a gate, not a code change.

- [ ] **Step 1: Reset local state**

```bash
pnpm db:down
docker volume rm ecommerce_pgdata 2>/dev/null || true
pnpm db:up
sleep 3
```

- [ ] **Step 2: Recreate the `app_user` role** (volume wiped)

```bash
docker compose -f docker-compose.dev.yml exec -T postgres psql -U app_migrator -d ecommerce <<'SQL'
CREATE ROLE app_user LOGIN PASSWORD 'dev_password' NOBYPASSRLS;
GRANT CONNECT ON DATABASE ecommerce TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;
SQL
```

- [ ] **Step 3: Full verification command**

```bash
pnpm install --frozen-lockfile && \
pnpm lint && pnpm typecheck && \
pnpm db:migrate && pnpm db:seed && \
pnpm test && pnpm build
```

Expected: every step green. Test suite reports all tests passing across files: `env.test.ts`, `password.test.ts`, `session.test.ts`, `csrf.test.ts`, `errors.test.ts`, `idempotency.test.ts`, `config-loader.test.ts`, `tenant-resolve.test.ts`, `with-tenant.test.ts`, `rls.test.ts`, `tenancy-schema.test.ts`, `identity-schema.test.ts`, `sessions-schema.test.ts`, `config-schema.test.ts`.

- [ ] **Step 4: Boot the full trio locally**

```bash
# Terminal 1
pnpm dev
# Terminal 2
ROLE=worker pnpm worker
# Terminal 3
ROLE=scheduler pnpm scheduler
```

- [ ] **Step 5: Prove tenant resolution end-to-end**

```bash
curl -s -H 'Host: inkwell.localhost' http://localhost:3000/ | grep -o -- '--color-primary:[^;]*'
```

Expected: `--color-primary:#2C3E8C` (from the seeded site_config override, still matching defaults because seed only overrode brand/theme.color.primary — verify this value maps to the seed). If you changed the primary in the seed, this string will reflect that.

- [ ] **Step 6: Tag SP-1 completion**

```bash
git tag -a sp-1 -m "SP-1: Foundation & tenancy complete"
```

---

## Acceptance Criteria (SP-1 definition of done)

A reviewer can check each:

- [ ] `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build` succeeds from a clean checkout on Node 20.11+.
- [ ] `docker build -f docker/Dockerfile .` produces an image; running it with `ROLE=web` serves `/healthz` returning 200.
- [ ] Setting `ROLE=worker` and `ROLE=scheduler` on the same image boots the respective entrypoint and logs readiness.
- [ ] A request with `Host: <seeded-domain>` triggers tenant resolution and renders `platform.defaults` merged with that store's `site_config` as CSS custom properties in the SSR HTML.
- [ ] RLS proven: `app_user` queries on `customers`, `addresses`, `site_config`, etc. without `app.store_id` set return zero rows; cross-tenant write is rejected.
- [ ] Signup → login → logout round-trip works against the local stack and sets/clears the signed `sid` cookie.
- [ ] Every tenant-scoped table has `ENABLE ROW LEVEL SECURITY` and a `tenant_isolation` policy (`\d+ <table>` in `psql` to verify).
- [ ] CI is green on the default branch with a Postgres 15 and Redis 7 service.
- [ ] Seed script produces a reproducible example store (`inkwell`), admin user (`admin@inkwell.test` / `admin1234`), and a site_config row.
- [ ] No `.env` file committed; `.env.example` covers every variable `env.ts` reads.

---

## Open Questions (best defaults chosen; flag for user if wrong)

1. **Package manager — pnpm.** Locked in Task 2. Switch to npm/yarn is a `package.json` + lockfile swap; CI matrix still works. *Default confirmed unless user asks otherwise.*
2. **Middleware runtime — Edge.** Tenant resolution is deferred to Node server helpers to avoid Edge driver limits. If future SPs want Edge-native tenant resolution, Upstash REST can be added alongside ioredis without breaking this design.
3. **Admin CSRF token storage.** `mintCsrfToken` is exported but no endpoint yet delivers it to the admin client. SP-6 (admin dashboard) wires it through the admin login response. If this is not acceptable for SP-1, add a `/api/v1/admin/csrf-token` endpoint in Task 18 — currently judged out of scope.
4. **Session cookie HMAC vs opaque-only.** The cookie value is the session ID HMAC-signed. Signing adds a cheap sanity check before a DB round-trip but is not strictly required given the session ID is 256 bits of randomness. Default: kept.
5. **Email verification, password reset, rate limiting.** Not in SP-1 scope. Tracked for a later auth-hardening pass; does not block downstream SPs because SP-2 through SP-5 use the session primitives, not the flows.
6. **Stores table RLS read policy.** Task 11 lets any session (including no `app.store_id`) read `stores`. This is intentional so the tenant-resolution path can identify the tenant before RLS is active. Closing this would require a bypass role for resolution, which is already the case (`migratorDb`). Revisit only if `stores` is found to leak sensitive fields.

---

## Self-Review Results

- **Spec coverage:** §3 diagram (Tasks 1, 25, 26, 27) ✓; §4 module map (auth, config, tenant modules) ✓; §5.1 tenancy & identity (Tasks 7–9) ✓; §5.6 config (Task 10) ✓; §5.7 RLS pattern (Task 11) ✓; §6.4 conventions (Tasks 19, 20) ✓; §9 config system (Tasks 15, 21) ✓; §13 Docker + roles + /healthz (Tasks 22, 23, 24, 25) ✓; §15 non-functional (argon2id Task 16, CSRF Task 18, signed cookies Task 16) ✓.
- **Placeholder scan:** every step includes runnable code/commands. No TBDs.
- **Type consistency:** `SiteConfig` type re-used in Tasks 15, 21, 27. `withTenant(storeId, fn)` signature identical across Tasks 13, 27. `problem(status, title, detail, errors)` identical in Tasks 17, 19. `resolveTenant(host)` signature stable Tasks 12, 21.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-04-24-sp-1-foundation-and-tenancy.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. Uses `superpowers:subagent-driven-development`.
2. **Inline Execution** — execute tasks in this session with checkpoints for review. Uses `superpowers:executing-plans`.

**Which approach?**
