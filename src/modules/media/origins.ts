import { env } from '@/lib/env';

/**
 * Browser-reachable origins the active MediaProvider needs.
 *
 * Direct-upload means the browser talks to object storage itself: it PUTs the
 * bytes to a signed URL (`connect-src`) and later renders the stored object
 * (`img-src`). Both are cross-origin, so a `default-src 'self'` CSP silently
 * kills them — the PUT surfaces only as a generic fetch "Network error" and the
 * image just never paints. That is a *browser*-only failure, invisible to
 * server-side tests, so the origins have to be derived from the same env the
 * provider uses rather than hardcoded in the middleware.
 *
 * Deliberately env-only (no provider import): this is called from
 * `src/middleware.ts`, and pulling in provider.ts would drag the AWS SDK and
 * the Supabase client into the middleware bundle.
 *
 * Returns [] for the stub provider, which uploads to a same-origin route.
 */
export function mediaOrigins(): string[] {
  const urls: (string | undefined)[] = [];

  switch (env.MEDIA_PROVIDER) {
    case 'supabase-storage':
      urls.push(env.SUPABASE_URL);
      break;
    case 'r2-imgproxy':
      // Uploads go to the S3 endpoint, reads to the public bucket domain, and
      // derivatives to imgproxy — three potentially distinct origins.
      urls.push(env.R2_PUBLIC_BASE_URL, env.IMGPROXY_BASE_URL);
      if (env.R2_ACCOUNT_ID) urls.push(`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);
      break;
    case 'stub':
      break;
  }

  const origins = new Set<string>();
  for (const u of urls) {
    if (!u) continue;
    try {
      origins.add(new URL(u).origin);
    } catch {
      // A malformed URL must not take down every request with a broken CSP.
    }
  }
  return [...origins];
}
