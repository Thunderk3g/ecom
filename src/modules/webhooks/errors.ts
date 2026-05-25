/**
 * Named error classes for the webhooks (outbound) module.
 *
 * These are domain errors thrown by the subscription / dispatch services
 * (subscriptions.ts, dispatch.ts). HTTP route handlers (Stream G) translate
 * them to RFC 7807 problem responses.
 */

export class WebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Webhook subscription id was not found in the current tenant. */
export class WebhookNotFoundError extends WebhookError {
  public readonly webhookId: string;

  constructor(webhookId: string) {
    super(`Webhook ${webhookId} not found`);
    this.webhookId = webhookId;
  }
}

/**
 * Webhook subscription is paused (status='paused'); pause/resume APIs use
 * this to signal "already in target state" or "cannot dispatch — paused".
 */
export class WebhookDisabledError extends WebhookError {
  public readonly webhookId: string;

  constructor(webhookId: string) {
    super(`Webhook ${webhookId} is paused`);
    this.webhookId = webhookId;
  }
}

/** Webhook delivery id was not found in the current tenant. */
export class DeliveryNotFoundError extends WebhookError {
  public readonly deliveryId: string;

  constructor(deliveryId: string) {
    super(`Webhook delivery ${deliveryId} not found`);
    this.deliveryId = deliveryId;
  }
}
