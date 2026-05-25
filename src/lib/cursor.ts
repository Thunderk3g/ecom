import { z } from 'zod';

/**
 * Opaque cursor payload used for keyset pagination. `k` is the sort key
 * (e.g. an ISO timestamp string for created_at desc), `id` is the row id
 * used as the deterministic tiebreaker.
 */
export type CursorPayload = { k: string; id: string };

const CursorSchema = z.object({
  k: z.string(),
  id: z.string().uuid(),
});

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

/** Encode a cursor payload to a base64url string. */
export function encodeCursor(p: CursorPayload): string {
  return Buffer.from(JSON.stringify(p), 'utf8').toString('base64url');
}

/**
 * Decode a base64url-encoded cursor. Returns null when the input is missing,
 * not base64url, not JSON, or doesn't match the {k, id} shape (id must be uuid).
 */
export function decodeCursor(s: string | undefined | null): CursorPayload | null {
  if (!s) return null;
  try {
    const json = Buffer.from(s, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    const result = CursorSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Parse a `limit` query string with safe defaults. Invalid or non-positive
 * input falls back to `def`; values above `max` are clamped to `max`.
 */
export function parseLimit(
  s: string | undefined | null,
  def: number = DEFAULT_LIMIT,
  max: number = MAX_LIMIT,
): number {
  if (s === undefined || s === null || s === '') return def;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n) || Number.isNaN(n) || n < 1) return def;
  return Math.min(n, max);
}
