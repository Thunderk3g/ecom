import { describe, it, expect } from 'vitest';
import { getOrCreateRequestId, bindRequestId, REQUEST_ID_HEADER } from '@/lib/request-id';

describe('getOrCreateRequestId', () => {
  it('passes through an existing x-request-id header', () => {
    const headers = new Headers({ [REQUEST_ID_HEADER]: 'abc-123' });
    expect(getOrCreateRequestId(headers)).toBe('abc-123');
  });

  it('mints a UUID when the header is absent', () => {
    const id = getOrCreateRequestId(new Headers());
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('mints a UUID when the header is blank/whitespace', () => {
    const headers = new Headers({ [REQUEST_ID_HEADER]: '   ' });
    const id = getOrCreateRequestId(headers);
    expect(id).not.toBe('   ');
    expect(id.length).toBeGreaterThan(0);
  });

  it('accepts a plain record of headers', () => {
    expect(getOrCreateRequestId({ [REQUEST_ID_HEADER]: 'rec-1' })).toBe('rec-1');
    expect(getOrCreateRequestId({ [REQUEST_ID_HEADER]: ['arr-1', 'arr-2'] })).toBe('arr-1');
  });

  it('mints distinct ids across calls', () => {
    expect(getOrCreateRequestId(new Headers())).not.toBe(getOrCreateRequestId(new Headers()));
  });
});

describe('bindRequestId', () => {
  it('returns a logger that stamps req_id', () => {
    const child = bindRequestId('req-xyz');
    // pino child bindings live on a non-public field; assert the logger is
    // usable and has the expected level interface rather than introspecting.
    expect(typeof child.info).toBe('function');
    expect(child.bindings()).toMatchObject({ req_id: 'req-xyz' });
  });
});
