import { env } from './env';
import { logger } from './logger';

/**
 * Thin Sentry wrapper. No-ops entirely when SENTRY_DSN is unset (dev/test and
 * any deployment that doesn't want error reporting). When set, @sentry/node is
 * imported lazily so it never lands on a hot path that doesn't need it and so a
 * missing/broken SDK can't crash boot.
 *
 * Sentry is intentionally NOT a hard dependency of any request path: capture
 * failures are swallowed and logged, never rethrown.
 */

type SentryModule = typeof import('@sentry/node');

let sentry: SentryModule | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Lazily initialises Sentry. Idempotent — safe to call from every entrypoint
 * (web instrumentation, worker, scheduler). Resolves immediately to a no-op
 * when no DSN is configured.
 */
export async function initSentry(): Promise<void> {
  if (!env.SENTRY_DSN) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const mod = await import('@sentry/node');
      mod.init({
        dsn: env.SENTRY_DSN,
        environment: env.NODE_ENV,
        // Conservative defaults; tune per-deploy. Tracing off by default to
        // avoid surprise overhead — metrics endpoint covers latency.
        tracesSampleRate: 0,
      });
      sentry = mod;
    } catch (err) {
      logger.warn({ err }, 'sentry init failed; continuing without error reporting');
    }
  })();

  return initPromise;
}

/**
 * Reports an exception to Sentry if initialised, otherwise logs it. Never
 * throws — safe to call from catch blocks anywhere.
 */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (sentry) {
    try {
      sentry.captureException(error, context ? { extra: context } : undefined);
      return;
    } catch (err) {
      logger.warn({ err }, 'sentry captureException failed');
    }
  }
  logger.error({ err: error, ...context }, 'captured exception (sentry disabled)');
}
