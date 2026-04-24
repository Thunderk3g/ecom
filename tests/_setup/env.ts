// Seeds `process.env` with safe defaults so modules that evaluate
// `parseEnv(process.env)` at import time don't blow up under vitest.
// We use bracket access + `??=` so these only fill in when unset,
// and so TS doesn't complain about NODE_ENV being narrowed read-only.
const env = process.env as Record<string, string | undefined>;
env['NODE_ENV'] ??= 'test';
env['ROLE'] ??= 'web';
env['DATABASE_URL'] ??= 'postgres://app_migrator:dev_password@localhost:5432/ecommerce';
env['REDIS_URL'] ??= 'redis://localhost:6379';
env['SESSION_SECRET'] ??= 'test_session_secret_32_chars_min_ok_testing_only';
env['COOKIE_DOMAIN'] ??= 'localhost';
