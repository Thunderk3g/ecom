// Seeds `process.env` with safe defaults so modules that evaluate
// `parseEnv(process.env)` at import time don't blow up under vitest.
// We use bracket access + `??=` so these only fill in when unset,
// and so TS doesn't complain about NODE_ENV being narrowed read-only.
const env = process.env as Record<string, string | undefined>;
env['NODE_ENV'] ??= 'test';
env['ROLE'] ??= 'web';
env['DATABASE_URL'] ??= 'postgres://app_migrator:dev_password@127.0.0.1:5433/ecommerce';
env['REDIS_URL'] ??= 'redis://127.0.0.1:6380';
env['SESSION_SECRET'] ??= 'test_session_secret_32_chars_min_ok_testing_only';
env['COOKIE_DOMAIN'] ??= 'localhost';
