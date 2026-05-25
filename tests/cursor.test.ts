import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor, parseLimit, DEFAULT_LIMIT, MAX_LIMIT } from '@/lib/cursor';

describe('cursor', () => {
  const sampleId = '11111111-1111-1111-1111-111111111111';

  describe('encodeCursor / decodeCursor', () => {
    it('round-trips a valid payload', () => {
      const payload = { k: '2026-05-22T12:00:00.000Z', id: sampleId };
      const encoded = encodeCursor(payload);
      expect(typeof encoded).toBe('string');
      expect(encoded.length).toBeGreaterThan(0);
      expect(decodeCursor(encoded)).toEqual(payload);
    });

    it('returns null for undefined / null / empty string', () => {
      expect(decodeCursor(undefined)).toBeNull();
      expect(decodeCursor(null)).toBeNull();
      expect(decodeCursor('')).toBeNull();
    });

    it('returns null for non-base64url garbage', () => {
      expect(decodeCursor('!!!not-valid-base64!!!')).toBeNull();
    });

    it('returns null for valid base64url that is not JSON', () => {
      const garbage = Buffer.from('not json at all', 'utf8').toString('base64url');
      expect(decodeCursor(garbage)).toBeNull();
    });

    it('returns null when shape is wrong (missing id)', () => {
      const bad = Buffer.from(JSON.stringify({ k: 'x' }), 'utf8').toString('base64url');
      expect(decodeCursor(bad)).toBeNull();
    });

    it('returns null when id is not a uuid', () => {
      const bad = Buffer.from(JSON.stringify({ k: 'x', id: 'not-a-uuid' }), 'utf8').toString(
        'base64url',
      );
      expect(decodeCursor(bad)).toBeNull();
    });
  });

  describe('parseLimit', () => {
    it('returns default when input is missing', () => {
      expect(parseLimit(undefined)).toBe(DEFAULT_LIMIT);
      expect(parseLimit(null)).toBe(DEFAULT_LIMIT);
      expect(parseLimit('')).toBe(DEFAULT_LIMIT);
    });

    it('returns parsed value when in range', () => {
      expect(parseLimit('10')).toBe(10);
      expect(parseLimit('1')).toBe(1);
    });

    it('clamps to max', () => {
      expect(parseLimit(String(MAX_LIMIT + 1))).toBe(MAX_LIMIT);
      expect(parseLimit('999999')).toBe(MAX_LIMIT);
    });

    it('falls back to default for non-numeric and non-positive inputs', () => {
      expect(parseLimit('not-a-number')).toBe(DEFAULT_LIMIT);
      expect(parseLimit('0')).toBe(DEFAULT_LIMIT);
      expect(parseLimit('-5')).toBe(DEFAULT_LIMIT);
    });

    it('honors custom default and max', () => {
      expect(parseLimit(undefined, 25, 100)).toBe(25);
      expect(parseLimit('500', 25, 100)).toBe(100);
    });
  });
});
