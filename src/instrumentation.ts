/**
 * Next.js 15 instrumentation hook.
 *
 * `register()` runs once per server process on boot (before any request is
 * handled) and is the convention-over-configuration replacement for the old
 * `next.config.ts` `instrumentationHook` setting. Next 15 picks this file up
 * automatically when located at `src/instrumentation.ts` (or project root).
 *
 * We only initialise the *server* Sentry SDK here — `@sentry/node`. Browser
 * Sentry would require `@sentry/browser` or `@sentry/react` which are NOT in
 * package.json (intentionally, to keep the bundle slim) and the brief says to
 * skip rather than install. Adding browser error reporting later means
 * dropping in `instrumentation-client.ts` and the appropriate SDK.
 */

import { initSentry } from '@/lib/sentry';

export async function register(): Promise<void> {
  // initSentry is a no-op when SENTRY_DSN is unset (dev/test, or deploys
  // that opt out). It only imports @sentry/node lazily inside the DSN branch,
  // so this stays cheap on the Edge bundling pass.
  await initSentry();
}
