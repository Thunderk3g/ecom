import pino from 'pino';
import { env } from './env';

// pino's worker-thread transport (pino-pretty) does not survive Next.js's
// server bundling: the worker can't resolve pino-pretty inside the webpack
// bundle and exits with "the worker has exited". Skip the transport whenever
// NEXT_RUNTIME is set; tsx-run scripts (worker, scheduler, seed) keep pretty.
const useTransport =
  env.NODE_ENV === 'development' && !process.env.NEXT_RUNTIME;

export const logger = pino({
  level: env.LOG_LEVEL,
  transport: useTransport ? { target: 'pino-pretty' } : undefined,
});
