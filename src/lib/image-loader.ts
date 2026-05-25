/**
 * Next.js custom image loader (SP-8).
 *
 * Wired via `images.loader = 'custom'` + `images.loaderFile` in next.config.ts.
 * Receives `{ src, width, quality }` from <Image> and returns a URL.
 *
 * Strategy (pragmatic v1):
 *   - Server (SSR / RSC, `typeof window === 'undefined'`): if `IMGPROXY_BASE_URL`
 *     and `IMGPROXY_KEY`/`IMGPROXY_SALT` are configured, build a signed imgproxy
 *     URL that resizes-fit to `width` and re-encodes to webp at `quality`.
 *   - Otherwise (browser, or imgproxy unconfigured): pass `src` through unchanged.
 *     Browser-side signing would require exposing the signing key, which is
 *     unsafe; the URLs that are server-rendered remain signed correctly. A
 *     follow-up can issue short-lived signed URLs server-side and hydrate.
 *
 * IMPORTANT: this file is bundled into the BROWSER as well as the server. It
 * must NOT statically import server-only modules (e.g. `@/modules/media/*`).
 * `node:crypto` is loaded conditionally via a runtime-only require so the
 * browser bundle does not try to resolve it.
 */

export interface ImageLoaderProps {
  src: string;
  width: number;
  quality?: number;
}

/**
 * Build the imgproxy processing path. Caller layers `{base}/{signature}{path}`.
 * Path matches the R2Provider derivative pattern: rs:fit:<w>:0/q:<q>/<b64url>.webp
 */
function buildImgproxyPath(src: string, width: number, quality: number): string {
  const encoded = base64UrlEncode(src);
  return `/rs:fit:${width}:0/q:${quality}/${encoded}.webp`;
}

/**
 * Base64url encode a UTF-8 string. Uses Buffer on Node and a portable fallback
 * elsewhere. (The browser branch never reaches this — it's behind the
 * server-only `typeof window === 'undefined'` guard — but the implementation
 * still works in any JS runtime.)
 */
function base64UrlEncode(input: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input, 'utf8').toString('base64url');
  }
  // Portable fallback (used only if someone reuses this helper client-side).
  const bytes = new TextEncoder().encode(input);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]!);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * imgproxy URL signing — HMAC-SHA256 over (salt_bytes || path_bytes) using a
 * hex-decoded key, then base64url-encoded. Matches signImgproxyPath in
 * src/modules/media/r2-provider.ts. Duplicated here to keep this loader free of
 * server-only imports (the loader is bundled into the browser too).
 */
function signImgproxyPath(keyHex: string, saltHex: string, path: string): string {
  // Indirect require avoids static analysis pulling node:crypto into the
  // browser bundle. This branch is only reached on the server.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeRequire: NodeRequire = (0, eval)('require');
  const crypto = nodeRequire('node:crypto') as typeof import('node:crypto');
  const key = Buffer.from(keyHex, 'hex');
  const salt = Buffer.from(saltHex, 'hex');
  const hmac = crypto.createHmac('sha256', key);
  hmac.update(salt);
  hmac.update(path);
  return hmac.digest('base64url');
}

export default function imageLoader({ src, width, quality }: ImageLoaderProps): string {
  // Browser pass-through: no key exposure, no client-side signing. The same
  // <Image> on the server returns a signed imgproxy URL; rehydration keeps it.
  if (typeof window !== 'undefined') return src;

  const base = process.env.IMGPROXY_BASE_URL ?? process.env.NEXT_PUBLIC_IMGPROXY_URL;
  const key = process.env.IMGPROXY_KEY;
  const salt = process.env.IMGPROXY_SALT;
  if (!base || !key || !salt) return src;

  const q = typeof quality === 'number' && quality > 0 ? Math.min(100, Math.floor(quality)) : 80;
  const path = buildImgproxyPath(src, width, q);
  const signature = signImgproxyPath(key, salt, path);
  return `${base.replace(/\/$/, '')}/${signature}${path}`;
}
