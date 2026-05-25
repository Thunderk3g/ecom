/**
 * GET  /api/v1/admin/webhooks            — list subscriptions (optional ?status=)
 * POST /api/v1/admin/webhooks            — create a subscription
 *
 * Filtering on GET is intentionally cheap — `listWebhooks` returns the full
 * set (typically a handful per tenant) and we filter in-process when a
 * `status` query string is present. Mutations require CSRF + Idempotency-Key
 * (see `runAdminPipeline({ requireMutation: true, ... })`).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createWebhook, listWebhooks, type WebhookStatus } from '@/modules/webhooks/subscriptions';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapWebhookError, readJsonBody, runAdminPipeline } from './_lib';

const WEBHOOK_STATUSES: readonly WebhookStatus[] = ['active', 'paused'];

const createBody = z.object({
  url: z.string().url(),
  secret: z.string().min(1).optional(),
  topics: z.array(z.string().min(1)).min(1),
  status: z.enum(['active', 'paused']).optional(),
});

export async function GET(req: Request): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: false,
    permission: 'webhooks:read',
  });
  if (!pipeline.ok) return pipeline.response;

  const url = new URL(req.url);
  const statusRaw = url.searchParams.get('status');
  const status =
    statusRaw && (WEBHOOK_STATUSES as readonly string[]).includes(statusRaw)
      ? (statusRaw as WebhookStatus)
      : undefined;

  try {
    const result = await listWebhooks(pipeline.storeId);
    const items = status ? result.items.filter(w => w.status === status) : result.items;
    return NextResponse.json({ data: items });
  } catch (err) {
    return mapWebhookError(err);
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'webhooks:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const validated = createBody.safeParse(parsed.data);
  if (!validated.success) {
    return problem(
      422,
      'invalid-body',
      'Invalid webhook body',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  try {
    const webhook = await withIdempotency(
      `admin:webhooks:create:${pipeline.storeId}`,
      pipeline.idempotencyKey!,
      async () =>
        createWebhook(pipeline.storeId, {
          url: validated.data.url,
          ...(validated.data.secret !== undefined ? { secret: validated.data.secret } : {}),
          topics: validated.data.topics,
          ...(validated.data.status !== undefined ? { status: validated.data.status } : {}),
        }),
    );
    return NextResponse.json({ data: webhook }, { status: 201 });
  } catch (err) {
    return mapWebhookError(err);
  }
}
