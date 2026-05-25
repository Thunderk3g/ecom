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

/** Prometheus exposition (text/plain; version=0.0.4) for the scrape endpoint. */
export async function renderMetrics(): Promise<string> {
  return metrics.metrics();
}

export const METRICS_CONTENT_TYPE = metrics.contentType;
