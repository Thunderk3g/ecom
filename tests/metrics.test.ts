import { describe, it, expect } from 'vitest';
import {
  metrics,
  recordRequest,
  renderMetrics,
  requestsTotal,
  METRICS_CONTENT_TYPE,
} from '@/lib/metrics';

describe('metrics registry', () => {
  it('exposes the prometheus 0.0.4 content type', () => {
    expect(METRICS_CONTENT_TYPE).toContain('text/plain');
    expect(METRICS_CONTENT_TYPE).toContain('version=0.0.4');
  });

  it('records a request into the counter and histogram', async () => {
    recordRequest({ method: 'get', route: '/api/v1/test', status: 200, durationSeconds: 0.012 });

    const value = await requestsTotal.get();
    const sample = value.values.find(
      (v) =>
        v.labels.method === 'GET' &&
        v.labels.route === '/api/v1/test' &&
        v.labels.status === '200',
    );
    expect(sample).toBeDefined();
    expect(sample?.value).toBeGreaterThanOrEqual(1);
  });

  it('produces parseable exposition output with our metric names', async () => {
    recordRequest({ method: 'POST', route: '/api/v1/cart', status: 201, durationSeconds: 0.2 });
    const text = await renderMetrics();

    // HELP/TYPE lines must be present for each custom metric.
    expect(text).toContain('# HELP requests_total');
    expect(text).toContain('# TYPE requests_total counter');
    expect(text).toContain('# TYPE request_duration_seconds histogram');
    expect(text).toContain('# TYPE build_info gauge');

    // Histogram emits the _bucket/_sum/_count families.
    expect(text).toContain('request_duration_seconds_bucket');
    expect(text).toContain('request_duration_seconds_sum');
    expect(text).toContain('request_duration_seconds_count');

    // A recorded counter sample with our label set appears verbatim.
    expect(text).toMatch(/requests_total\{[^}]*method="POST"[^}]*route="\/api\/v1\/cart"[^}]*status="201"[^}]*\}/);

    // Default process metrics are registered too.
    expect(text).toContain('process_cpu_user_seconds_total');
  });

  it('renderMetrics delegates to the shared registry', async () => {
    // Same registry instance is exported and scraped by the route handler.
    expect(metrics.contentType).toBe(METRICS_CONTENT_TYPE);
    expect(typeof (await renderMetrics())).toBe('string');
  });
});
