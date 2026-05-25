import { randomUUID } from 'node:crypto';
import { logger } from './logger';
import type { Logger } from 'pino';

/**
 * Canonical header used to propagate a request id across the edge middleware,
 * the route handlers, and downstream logs. A client/load-balancer may set it;
 * otherwise the middleware mints one and echoes it on the response.
 */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Reads an inbound `x-request-id` and returns it verbatim when present and
 * non-empty; otherwise mints a fresh UUID. Accepts either a `Headers` object
 * (Fetch/Next request headers) or a plain record (e.g. node:http style).
 *
 * This is intentionally Edge-safe — `node:crypto`'s `randomUUID` is available
 * on the Edge runtime too — but the heavier `bindRequestId` logger helper is
 * meant for Node route handlers / workers.
 */
export function getOrCreateRequestId(
  headers: Headers | Record<string, string | string[] | undefined>,
): string {
  const raw =
    headers instanceof Headers
      ? headers.get(REQUEST_ID_HEADER)
      : pickHeader(headers[REQUEST_ID_HEADER]);
  const trimmed = raw?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : randomUUID();
}

function pickHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Returns a child Pino logger that stamps `req_id` on every line. Pass the
 * value from {@link getOrCreateRequestId}. Use in route handlers/workers so all
 * logs for one request are correlatable.
 */
export function bindRequestId(requestId: string, base: Logger = logger): Logger {
  return base.child({ req_id: requestId });
}
