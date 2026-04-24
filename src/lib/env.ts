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
// first property access, so merely importing this module does not throw.
export const env: Env = new Proxy({} as Env, {
  get(_t, prop: string) {
    return getEnv()[prop as keyof Env];
  },
});
