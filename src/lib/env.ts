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
  // Payment provider credentials. All optional in dev/test — the matching
  // PaymentProvider constructor throws with a clear message if it can't find
  // its keys at use-time. Production deployments must set the keys for the
  // providers they actually enable in site_config.
  RAZORPAY_KEY_ID: z.string().min(1).optional(),
  RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  // Observability / hardening (SP-9). All optional: the platform runs without
  // them and degrades gracefully (metrics route falls back to localhost-only,
  // Sentry no-ops, rate limit uses its default).
  METRICS_TOKEN: z.string().min(1).optional(),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(120),
  SENTRY_DSN: z.string().url().optional(),
  // SP-8 media pipeline. All optional in dev/test — the selected MediaProvider
  // throws with a clear message at first use if a real provider is chosen
  // without its keys. `MEDIA_PROVIDER` defaults to 'stub' so tests + local dev
  // need no R2/imgproxy credentials and never touch the network.
  MEDIA_PROVIDER: z.enum(['r2-imgproxy', 'stub']).default('stub'),
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_BUCKET: z.string().min(1).optional(),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),
  IMGPROXY_BASE_URL: z.string().url().optional(),
  IMGPROXY_KEY: z.string().min(1).optional(),
  IMGPROXY_SALT: z.string().min(1).optional(),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(input: Record<string, string | undefined>): Env {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  return result.data;
}

let _env: Env | undefined;

export function getEnv(): Env {
  if (!_env) _env = parseEnv(process.env);
  return _env;
}

// Back-compat shim for `import { env } from '@/lib/env'` call-sites that appear
// later in the plan. Evaluation is lazy: parseEnv(process.env) only runs on
// first property access. Implements enough traps to survive `in`, Object.keys,
// spread, and util.inspect on the proxy.
export const env: Env = new Proxy({} as Env, {
  get(_t, prop, receiver) {
    if (typeof prop === 'symbol') return Reflect.get(getEnv(), prop, receiver);
    return getEnv()[prop as keyof Env];
  },
  has(_t, prop) {
    return typeof prop === 'string' && prop in getEnv();
  },
  ownKeys() {
    return Reflect.ownKeys(getEnv());
  },
  getOwnPropertyDescriptor(_t, prop) {
    const e = getEnv();
    if (typeof prop === 'symbol' || !(prop in e)) return undefined;
    return { configurable: true, enumerable: true, writable: false, value: e[prop as keyof Env] };
  },
});
