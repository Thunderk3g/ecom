/**
 * Prometheus scrape endpoint: GET /admin/metrics
 *
 * Returns the in-process registry in exposition format
 * (text/plain; version=0.0.4). Deliberately NOT under /api/v1 — it is process
 * scoped, not tenant scoped, so it bypasses RLS/host resolution entirely.
 *
 * Gating:
 *   - If METRICS_TOKEN is set, require `Authorization: Bearer <token>`.
 *   - If unset, allow only loopback callers (so a misconfigured public deploy
 *     doesn't leak metrics). In production set METRICS_TOKEN and scrape over
 *     the private network or with the bearer token.
 */

import { renderMetrics, METRICS_CONTENT_TYPE, refreshObservabilityGauges } from '@/lib/metrics';
import { env } from '@/lib/env';
import { problem } from '@/lib/errors';

// Always run on Node (prom-client needs perf_hooks) and never cache the scrape.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isLoopback(req: Request): boolean {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const candidate =
    forwarded ?? req.headers.get('x-real-ip')?.trim() ?? '';
  if (candidate === '') {
    // No proxy header at all (direct loopback call in dev/test): allow.
    return true;
  }
  return candidate === '127.0.0.1' || candidate === '::1' || candidate === '::ffff:127.0.0.1';
}

export async function GET(req: Request): Promise<Response> {
  const token = env.METRICS_TOKEN;

  if (token) {
    const auth = req.headers.get('authorization') ?? '';
    const provided = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
    if (provided !== token) {
      return problem(401, 'unauthorized', 'Valid metrics bearer token required.');
    }
  } else if (!isLoopback(req)) {
    return problem(403, 'forbidden', 'Metrics endpoint is restricted to loopback unless METRICS_TOKEN is set.');
  }

  // Refresh the point-in-time gauges (queue depth, db pool) before serializing
  // so the scrape contains current data. Failures inside the refresh are
  // contained per-gauge (see refreshObservabilityGauges) so we never block
  // the scrape on a flaky dependency.
  await refreshObservabilityGauges();

  const body = await renderMetrics();
  return new Response(body, {
    status: 200,
    headers: { 'content-type': METRICS_CONTENT_TYPE },
  });
}
