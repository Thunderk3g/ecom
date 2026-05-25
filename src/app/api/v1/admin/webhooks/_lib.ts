/**
 * Shared helpers for SP-5 admin webhook subscription routes (Stream G).
 *
 * - `runAdminPipeline` is re-exported from the catalog `_lib` so all admin
 *   surfaces share the same resolveTenant → session → RBAC → CSRF +
 *   Idempotency-Key gate.
 * - `mapWebhookError` translates the typed webhook domain errors (see
 *   `src/modules/webhooks/errors.ts`) into RFC 7807 problem responses.
 */

import { NextResponse } from 'next/server';
import { problem } from '@/lib/errors';
import {
  DeliveryNotFoundError,
  WebhookDisabledError,
  WebhookNotFoundError,
} from '@/modules/webhooks/errors';

export { runAdminPipeline, readJsonBody } from '../catalog/_lib';

/**
 * Map a thrown error from the webhooks module to an RFC 7807 response.
 * Unknown errors fall through to an opaque 500 — never leak the message.
 */
export function mapWebhookError(err: unknown): NextResponse {
  if (err instanceof WebhookNotFoundError) {
    return problem(404, 'webhook-not-found', err.message, []);
  }
  if (err instanceof DeliveryNotFoundError) {
    return problem(404, 'webhook-delivery-not-found', err.message, []);
  }
  if (err instanceof WebhookDisabledError) {
    return problem(409, 'webhook-disabled', err.message, [
      { path: ['status'], message: 'webhook is paused' },
    ]);
  }
  return problem(500, 'internal-error', 'Internal server error', []);
}
