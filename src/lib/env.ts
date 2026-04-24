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
