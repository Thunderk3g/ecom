import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from 'prom-client';

/**
 * Tiny in-process Prometheus registry. One registry per process; the
 * `/admin/metrics` route scrapes it. This is Node-only (prom-client pulls in
 * perf_hooks) — never import it into Edge middleware.
 *
 * Module-level singleton state survives across requests within a single Node
 * worker, which is exactly what an in-process collector wants. Under HMR in dev
 * `prom-client` would throw "metric already registered" on the second eval, so
 * every metric is created defensively (see `register*` helpers).
 */
export const metrics = new Registry();

// Default process metrics (CPU, heap, event-loop lag, etc).
collectDefaultMetrics({ register: metrics });

export const requestsTotal = new Counter({
  name: 'requests_total',
  help: 'Total HTTP requests handled, labelled by method, route and status.',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [metrics],
});

export const requestDurationSeconds = new Histogram({
  name: 'request_duration_seconds',
  help: 'HTTP request duration in seconds.',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metrics],
});

export const buildInfo = new Gauge({
  name: 'build_info',
  help: 'Build/version info; value is constant 1, the version lives in a label.',
  labelNames: ['version', 'node'] as const,
  registers: [metrics],
});

// Stamp build info once at module init. Value is always 1 — the labels carry
// the information (standard Prometheus "info metric" idiom).
buildInfo.set(
  {
    version: process.env.npm_package_version ?? '0.0.0',
    node: process.versions.node,
  },
  1,
);

/**
 * Per-queue depth gauge. Refreshed lazily from `refreshObservabilityGauges()`
 * before /admin/metrics serializes the registry — BullMQ exposes counts via
 * `Queue.getJobCounts()` and we only want to pay that round-trip on scrape,
 * not on every request.
 */
export const queueDepth = new Gauge({
  name: 'queue_depth',
  help: 'BullMQ queue depth (waiting + delayed) per queue.',
  labelNames: ['queue', 'state'] as const,
  registers: [metrics],
});

/**
 * Postgres connection-pool sizing. postgres-js does not expose an "active"
 * counter on the public API, so this currently records the configured max
 * only. TODO(SP-9): expose true in-use count once we wrap the client or fork
 * a counter — until then this is a ceiling, not a utilisation gauge.
 */
export const dbPoolSize = new Gauge({
  name: 'db_pool_size',
  help: 'Postgres connection pool size by client and metric (max|active).',
  labelNames: ['client', 'state'] as const,
  registers: [metrics],
});

/**
 * Records one finished HTTP request: bumps the counter and observes the
 * duration histogram under the same {method, route, status} label set.
 *
 * `route` should be the *templated* path (e.g. `/api/v1/cart/[id]`) not the
 * concrete URL, to keep label cardinality bounded.
 */
export function recordRequest(args: {
  method: string;
  route: string;
  status: number;
  durationSeconds: number;
}): void {
  const labels = {
    method: args.method.toUpperCase(),
    route: args.route,
    status: String(args.status),
  };
  requestsTotal.inc(labels);
  requestDurationSeconds.observe(labels, args.durationSeconds);
}

/**
 * Refresh point-in-time gauges before serialization. Pulled out of
 * renderMetrics so unit tests can opt-in (the BullMQ + postgres-js round-trips
 * involve I/O). The /admin/metrics route awaits this before responding.
 *
 * Failures are isolated per gauge: a flaky Redis must not blank out the entire
 * scrape, and a missing pool detail must not blank out queue depth. Errors are
 * swallowed silently — the rest of the request handler will log them via pino
 * if they are caller-visible.
 */
export async function refreshObservabilityGauges(): Promise<void> {
  try {
    // Re-import in the typed shape to enumerate handles. Done inside try so a
    // missing module never breaks scrape.
    const mod = await import('@/queue/queues');
    const handles: Array<{ name: string; queue: import('bullmq').Queue }> = [
      { name: mod.QUEUE_NAMES.emails, queue: mod.emailsQueue },
      { name: mod.QUEUE_NAMES.csvImports, queue: mod.csvImportsQueue },
      { name: mod.QUEUE_NAMES.inventoryAlerts, queue: mod.inventoryAlertsQueue },
      { name: mod.QUEUE_NAMES.reservationTtlSweep, queue: mod.reservationTtlSweepQueue },
      { name: mod.QUEUE_NAMES.cartTtlSweep, queue: mod.cartTtlSweepQueue },
      { name: mod.QUEUE_NAMES.ordersStalePaymentSweep, queue: mod.ordersStalePaymentSweepQueue },
      { name: mod.QUEUE_NAMES.webhookDispatch, queue: mod.webhookDispatchQueue },
      { name: mod.QUEUE_NAMES.imagePostProcess, queue: mod.imagePostProcessQueue },
    ];
    for (const { name, queue } of handles) {
      try {
        const counts = await queue.getJobCounts(
          'waiting',
          'active',
          'delayed',
          'failed',
        );
        queueDepth.set({ queue: name, state: 'waiting' }, counts.waiting ?? 0);
        queueDepth.set({ queue: name, state: 'active' }, counts.active ?? 0);
        queueDepth.set({ queue: name, state: 'delayed' }, counts.delayed ?? 0);
        queueDepth.set({ queue: name, state: 'failed' }, counts.failed ?? 0);
      } catch {
        // Per-queue failure: leave the previous sample in place.
      }
    }
  } catch {
    // queues module unavailable in this runtime; skip.
  }

  // Postgres-js pool size. The library does not expose an in-flight counter on
  // the typed surface, but the `.options.max` field is readable. Until we wrap
  // the client, we publish max only and TODO the active count.
  try {
    const dbMod = await import('@/db/client');
    const appMax =
      (dbMod.appClient as unknown as { options?: { max?: number } }).options?.max ?? 0;
    const migMax =
      (dbMod.migratorClient as unknown as { options?: { max?: number } }).options?.max ?? 0;
    dbPoolSize.set({ client: 'app', state: 'max' }, appMax);
    dbPoolSize.set({ client: 'migrator', state: 'max' }, migMax);
    // TODO(SP-9): emit { state: 'active' } once we wire a counter — see comment
    // on dbPoolSize. Setting 0 here would lie; omit until we have real data.
  } catch {
    // db client may not be loadable in some bundling contexts; skip.
  }
}

/** Prometheus exposition (text/plain; version=0.0.4) for the scrape endpoint. */
export async function renderMetrics(): Promise<string> {
  return metrics.metrics();
}

export const METRICS_CONTENT_TYPE = metrics.contentType;
