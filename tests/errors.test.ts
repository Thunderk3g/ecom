import { describe, it, expect } from 'vitest';
import { problem } from '@/lib/errors';

describe('problem', () => {
  it('returns RFC 7807-shaped JSON with correct status', async () => {
    const res = problem(404, 'not-found', 'Resource missing', []);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    const body = await res.json();
    expect(body).toMatchObject({ type: 'about:blank', title: 'not-found', status: 404, detail: 'Resource missing', errors: [] });
  });

  it('carries field errors', async () => {
    const res = problem(400, 'invalid-body', 'Validation failed', [{ path: ['email'], message: 'must be email' }]);
    const body = await res.json();
    expect(body.errors).toEqual([{ path: ['email'], message: 'must be email' }]);
  });
});
