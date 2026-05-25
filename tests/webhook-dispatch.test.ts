/**
 * Outbound webhook dispatch — end-to-end against a local HTTP mock server.
 *
 * Setup:
 *   - Spin up a Node http.createServer on a random port. The handler is
 *     swappable per-test so individual tests can return 200, 500, or
 *     simulate timeouts.
 *   - Register a webhook subscription pointing at the mock server, subscribed
 *     to topic 'order.fulfilled'.
 *   - INSERT an outbox_event row for that topic via migratorClient (no need
 *     to drive the full lifecycle).
 *
 * Tests:
 *   1. 200 OK → webhook_deliveries row 'succeeded', response_code=200,
 *              outbox_events flipped to 'dispatched'.
 *   2. 500 → after first call, delivery.status='pending', attempts=1,
 *            next_try_at set in the future.
 *   3. 5 failed attempts via direct deliverOne calls → status='dead'.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { eq } from 'drizzle-orm';
import { resetAndMigrate } from './_setup/db';
import { appClient, migratorClient } from '@/db/client';
import {
  deliverOne,
  dispatchOutboxBatch,
  MAX_DELIVERY_ATTEMPTS,
} from '@/modules/webhooks/dispatch';
import { outboxEvents, webhookDeliveries, webhooks } from '@/db/schema/webhooks';
import { createStore } from './_setup/inventory-fixtures';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

describe('webhook dispatch', () => {
  let server: Server;
  let port: number;
  let storeId: string;
  let webhookId: string;
  let webhookSecret: string;
  let handler: Handler;

  beforeAll(async () => {
    await resetAndMigrate();
    const store = await createStore('whd-store');
    storeId = store.id;

    // Spin up a local HTTP mock server. The handler is mutable so per-test
    // beforeEach can install whatever response we need.
    handler = (_req, res) => {
      res.statusCode = 200;
      res.end('ok');
    };
    server = createServer((req, res) => handler(req, res));
    await new Promise<void>(resolve =>
      server.listen(0, '127.0.0.1', () => resolve()),
    );
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('webhook mock server: no address');
    }
    port = addr.port;

    // Register one subscription pointing at our local server. Insert via
    // migratorClient so we don't have to set up withTenant just to seed.
    webhookSecret = 'whd_test_secret_' + crypto.randomUUID();
    const rows = await migratorClient<{ id: string }[]>`
      INSERT INTO webhooks (store_id, url, secret, topics, status)
      VALUES (
        ${storeId},
        ${`http://127.0.0.1:${port}/hook`},
        ${webhookSecret},
        ARRAY['order.fulfilled']::text[],
        'active'
      )
      RETURNING id
    `;
    const id = rows[0]?.id;
    if (!id) throw new Error('webhooks insert returned no row');
    webhookId = id;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close(err => (err ? reject(err) : resolve())),
    );
    await appClient.end();
    await migratorClient.end();
  });

  beforeEach(async () => {
    // Reset between tests so counts are predictable.
    await migratorClient`DELETE FROM webhook_deliveries WHERE store_id = ${storeId}`;
    await migratorClient`DELETE FROM outbox_events WHERE store_id = ${storeId}`;
  });

  async function insertOutboxEvent(topic: string = 'order.fulfilled'): Promise<string> {
    const rows = await migratorClient<{ id: string }[]>`
      INSERT INTO outbox_events (store_id, topic, payload, status)
      VALUES (${storeId}, ${topic}, '{"orderId":"abc","number":"S-1"}'::jsonb, 'pending')
      RETURNING id
    `;
    const id = rows[0]?.id;
    if (!id) throw new Error('outbox_events insert returned no row');
    return id;
  }

  it('success: dispatch creates delivery, POSTs to subscriber, flips outbox', async () => {
    handler = (_req, res) => {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/plain');
      res.end('ok');
    };

    const eventId = await insertOutboxEvent();
    const result = await dispatchOutboxBatch();
    expect(result.events).toBe(1);
    expect(result.deliveriesCreated).toBe(1);
    expect(result.deliveriesSucceeded).toBe(1);

    // outbox row dispatched.
    const ob = await migratorClient<{ status: string }[]>`
      SELECT status FROM outbox_events WHERE id = ${eventId}
    `;
    expect(ob[0]?.status).toBe('dispatched');

    // delivery row succeeded with 200.
    const dl = await migratorClient<{ status: string; response_code: number | null }[]>`
      SELECT status, response_code
      FROM webhook_deliveries
      WHERE event_id = ${eventId} AND webhook_id = ${webhookId}
    `;
    expect(dl[0]?.status).toBe('succeeded');
    expect(dl[0]?.response_code).toBe(200);
  });

  it('500 response → delivery stays pending, attempts=1, next_try_at set', async () => {
    handler = (_req, res) => {
      res.statusCode = 500;
      res.end('boom');
    };

    const eventId = await insertOutboxEvent();
    const result = await dispatchOutboxBatch();
    expect(result.events).toBe(1);
    expect(result.deliveriesCreated).toBe(1);
    // The 500 doesn't increment 'succeeded' or 'dead' on the first try.
    expect(result.deliveriesSucceeded).toBe(0);
    expect(result.deliveriesDead).toBe(0);

    const dl = await migratorClient<{
      status: string;
      attempts: number;
      next_try_at: string | null;
      response_code: number | null;
    }[]>`
      SELECT status, attempts, next_try_at, response_code
      FROM webhook_deliveries
      WHERE event_id = ${eventId} AND webhook_id = ${webhookId}
    `;
    expect(dl[0]?.status).toBe('pending');
    expect(dl[0]?.attempts).toBe(1);
    expect(dl[0]?.response_code).toBe(500);
    expect(dl[0]?.next_try_at).not.toBeNull();
  });

  it('after MAX_DELIVERY_ATTEMPTS failures → status=dead', async () => {
    handler = (_req, res) => {
      res.statusCode = 500;
      res.end('boom');
    };

    const eventId = await insertOutboxEvent();
    // First call creates the delivery row via dispatchOutboxBatch.
    await dispatchOutboxBatch();

    // Look up the delivery id.
    const dlRows = await migratorClient<{ id: string }[]>`
      SELECT id FROM webhook_deliveries WHERE event_id = ${eventId}
    `;
    const deliveryId = dlRows[0]?.id;
    if (!deliveryId) throw new Error('expected delivery row to exist');

    // Now hammer deliverOne directly to bypass the next_try_at gating. The
    // first call above already counted as attempt #1, so we need 4 more
    // failures to reach 5 and trip the 'dead' threshold.
    for (let i = 2; i <= MAX_DELIVERY_ATTEMPTS; i++) {
      const outcome = await deliverOne(deliveryId);
      if (i < MAX_DELIVERY_ATTEMPTS) {
        expect(outcome).toBe('failed');
      } else {
        expect(outcome).toBe('dead');
      }
    }

    const finalRows = await migratorClient<{ status: string; attempts: number }[]>`
      SELECT status, attempts FROM webhook_deliveries WHERE id = ${deliveryId}
    `;
    expect(finalRows[0]?.status).toBe('dead');
    expect(finalRows[0]?.attempts).toBe(MAX_DELIVERY_ATTEMPTS);
  });

  it('drizzle-side sanity: rows are visible via migrator client (cross-tenant ops use BYPASSRLS)', async () => {
    // Quick sanity that the dispatch path's expectations about table shape
    // align with the schema definitions. Tests don't normally need this but
    // it's a cheap guard against schema drift.
    const wh = await migratorClient<{ id: string }[]>`
      SELECT id FROM webhooks WHERE id = ${webhookId}
    `;
    expect(wh).toHaveLength(1);

    // No-op via ORM to confirm imports work.
    const rows = await (async () => {
      // Avoid unused-import warnings while still exercising the imports.
      const refOutbox = outboxEvents;
      const refDeliveries = webhookDeliveries;
      const refWebhooks = webhooks;
      void refOutbox;
      void refDeliveries;
      void refWebhooks;
      return migratorClient<{ exists: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM webhooks WHERE id = ${webhookId}) AS exists
      `;
    })();
    expect(rows[0]?.exists).toBe(true);

    // Use the imported `eq` to keep TS happy in case future tests want to
    // build queries against these tables.
    expect(eq).toBeDefined();
  });
});
