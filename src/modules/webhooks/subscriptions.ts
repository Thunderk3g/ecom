/**
 * Outbound webhook subscription management.
 *
 * CRUD for `webhooks` rows plus a cursor-paginated read of `webhook_deliveries`.
 * Subscriptions are store-scoped — every query runs inside `withTenant`, so RLS
 * enforces that one store cannot enumerate or mutate another's webhooks.
 *
 * Secret material: when no `secret` is provided on create, we generate
 * 32 random bytes (256 bits) of entropy and hex-encode. That value is the
 * shared secret subscribers use to verify `X-Inkwell-Signature` (see
 * `signature.ts`). Stored in plaintext — partners need the original value to
 * verify HMACs; rotation is via PATCH.
 */

import { randomBytes } from 'node:crypto';
import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { webhooks, webhookDeliveries } from '@/db/schema/webhooks';
import { decodeCursor, encodeCursor, parseLimit } from '@/lib/cursor';
import {
  DeliveryNotFoundError,
  WebhookNotFoundError,
} from './errors';

export type WebhookStatus = 'active' | 'paused';

export type WebhookDeliveryStatus = 'pending' | 'succeeded' | 'failed' | 'dead';

export interface WebhookRow {
  id: string;
  storeId: string;
  url: string;
  secret: string;
  topics: string[];
  status: WebhookStatus;
  createdAt: Date;
}

export interface CreateWebhookInput {
  url: string;
  /** Optional — when omitted, a fresh 32-byte hex secret is generated. */
  secret?: string;
  topics: string[];
  status?: WebhookStatus;
}

export interface UpdateWebhookInput {
  url?: string;
  secret?: string;
  topics?: string[];
  status?: WebhookStatus;
}

export interface WebhookDeliveryRow {
  id: string;
  storeId: string;
  webhookId: string;
  eventId: string;
  responseCode: number | null;
  body: string | null;
  attempts: number;
  lastAttemptAt: Date | null;
  nextTryAt: Date | null;
  status: WebhookDeliveryStatus;
  createdAt: Date;
}

export interface ListWebhooksResult {
  items: WebhookRow[];
}

export interface ListDeliveriesOptions {
  cursor?: string;
  limit?: number;
  status?: WebhookDeliveryStatus;
}

export interface ListDeliveriesResult {
  items: WebhookDeliveryRow[];
  nextCursor: string | null;
}

function toWebhookRow(r: {
  id: string;
  storeId: string;
  url: string;
  secret: string;
  topics: string[];
  status: WebhookStatus;
  createdAt: Date;
}): WebhookRow {
  return {
    id: r.id,
    storeId: r.storeId,
    url: r.url,
    secret: r.secret,
    topics: r.topics,
    status: r.status,
    createdAt: r.createdAt,
  };
}

function toDeliveryRow(r: {
  id: string;
  storeId: string;
  webhookId: string;
  eventId: string;
  responseCode: number | null;
  body: string | null;
  attempts: number;
  lastAttemptAt: Date | null;
  nextTryAt: Date | null;
  status: WebhookDeliveryStatus;
  createdAt: Date;
}): WebhookDeliveryRow {
  return {
    id: r.id,
    storeId: r.storeId,
    webhookId: r.webhookId,
    eventId: r.eventId,
    responseCode: r.responseCode,
    body: r.body,
    attempts: r.attempts,
    lastAttemptAt: r.lastAttemptAt,
    nextTryAt: r.nextTryAt,
    status: r.status,
    createdAt: r.createdAt,
  };
}

/** Generate a fresh shared secret (32 random bytes, hex-encoded → 64 chars). */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * List all webhook subscriptions for a store. Webhooks are not heavy and admin
 * UIs typically need them all — no cursor pagination here. Ordered newest-first
 * for deterministic display.
 */
export async function listWebhooks(storeId: string): Promise<ListWebhooksResult> {
  return withTenant(storeId, async tx => {
    const rows = await tx
      .select()
      .from(webhooks)
      .orderBy(desc(webhooks.createdAt), desc(webhooks.id));
    return { items: rows.map(toWebhookRow) };
  });
}

export async function getWebhook(
  storeId: string,
  webhookId: string,
): Promise<WebhookRow> {
  return withTenant(storeId, async tx => {
    const [row] = await tx
      .select()
      .from(webhooks)
      .where(eq(webhooks.id, webhookId));
    if (!row) throw new WebhookNotFoundError(webhookId);
    return toWebhookRow(row);
  });
}

export async function createWebhook(
  storeId: string,
  input: CreateWebhookInput,
): Promise<WebhookRow> {
  const secret = input.secret ?? generateWebhookSecret();

  return withTenant(storeId, async tx => {
    const [row] = await tx
      .insert(webhooks)
      .values({
        storeId,
        url: input.url,
        secret,
        topics: input.topics,
        status: input.status ?? 'active',
      })
      .returning();
    if (!row) throw new Error('webhooks insert returned no row');
    return toWebhookRow(row);
  });
}

export async function updateWebhook(
  storeId: string,
  webhookId: string,
  patch: UpdateWebhookInput,
): Promise<WebhookRow> {
  return withTenant(storeId, async tx => {
    const update: {
      url?: string;
      secret?: string;
      topics?: string[];
      status?: WebhookStatus;
    } = {};
    if (patch.url !== undefined) update.url = patch.url;
    if (patch.secret !== undefined) update.secret = patch.secret;
    if (patch.topics !== undefined) update.topics = patch.topics;
    if (patch.status !== undefined) update.status = patch.status;

    if (Object.keys(update).length > 0) {
      const updated = await tx
        .update(webhooks)
        .set(update)
        .where(eq(webhooks.id, webhookId))
        .returning({ id: webhooks.id });
      if (updated.length === 0) throw new WebhookNotFoundError(webhookId);
    }

    const [row] = await tx
      .select()
      .from(webhooks)
      .where(eq(webhooks.id, webhookId));
    if (!row) throw new WebhookNotFoundError(webhookId);
    return toWebhookRow(row);
  });
}

export async function deleteWebhook(
  storeId: string,
  webhookId: string,
): Promise<void> {
  return withTenant(storeId, async tx => {
    const deleted = await tx
      .delete(webhooks)
      .where(eq(webhooks.id, webhookId))
      .returning({ id: webhooks.id });
    if (deleted.length === 0) throw new WebhookNotFoundError(webhookId);
  });
}

/** Flip status='paused'. Idempotent — paused webhooks pause again as no-op. */
export async function pauseWebhook(
  storeId: string,
  webhookId: string,
): Promise<WebhookRow> {
  return updateWebhook(storeId, webhookId, { status: 'paused' });
}

/** Flip status='active'. Idempotent — active webhooks resume as no-op. */
export async function resumeWebhook(
  storeId: string,
  webhookId: string,
): Promise<WebhookRow> {
  return updateWebhook(storeId, webhookId, { status: 'active' });
}

/**
 * Cursor-paginated delivery listing for a single webhook subscription.
 * Newest-first by `created_at` with `id` tiebreaker. Throws
 * `WebhookNotFoundError` if the parent webhook doesn't exist in this tenant
 * (validates the path).
 */
export async function listDeliveries(
  storeId: string,
  webhookId: string,
  opts: ListDeliveriesOptions = {},
): Promise<ListDeliveriesResult> {
  const limit = parseLimit(opts.limit?.toString());

  return withTenant(storeId, async tx => {
    const [parent] = await tx
      .select({ id: webhooks.id })
      .from(webhooks)
      .where(eq(webhooks.id, webhookId));
    if (!parent) throw new WebhookNotFoundError(webhookId);

    const filters: SQL[] = [eq(webhookDeliveries.webhookId, webhookId)];
    if (opts.status) filters.push(eq(webhookDeliveries.status, opts.status));

    if (opts.cursor) {
      const decoded = decodeCursor(opts.cursor);
      if (decoded) {
        const cutoff = new Date(decoded.k);
        filters.push(
          or(
            lt(webhookDeliveries.createdAt, cutoff),
            and(
              eq(webhookDeliveries.createdAt, cutoff),
              lt(webhookDeliveries.id, decoded.id),
            ),
          ) as SQL,
        );
      }
    }

    const rows = await tx
      .select()
      .from(webhookDeliveries)
      .where(and(...filters))
      .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    const items = sliced.map(toDeliveryRow);

    const last = sliced[sliced.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ k: last.createdAt.toISOString(), id: last.id })
        : null;

    return { items, nextCursor };
  });
}

/**
 * Look up a single delivery by id. Useful for the admin "retry" UI which
 * needs to display response code / body next to the row.
 */
export async function getDelivery(
  storeId: string,
  deliveryId: string,
): Promise<WebhookDeliveryRow> {
  return withTenant(storeId, async tx => {
    const [row] = await tx
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, deliveryId));
    if (!row) throw new DeliveryNotFoundError(deliveryId);
    return toDeliveryRow(row);
  });
}
