import { describe, it, expect } from 'vitest';
import {
  validateBlocks,
  BLOCK_REGISTRY,
  BLOCK_KINDS,
  isBlockKind,
} from '@/modules/cms/blocks';
import { BlockValidationError } from '@/modules/cms/errors';

describe('cms block registry', () => {
  it('registry exposes all eight block kinds', () => {
    expect(BLOCK_KINDS.slice().sort()).toEqual(
      [
        'banner',
        'featured-categories',
        'hero',
        'newsletter',
        'product-grid',
        'rich-text',
        'testimonials',
        'two-column',
      ].sort(),
    );
    expect(Object.keys(BLOCK_REGISTRY)).toHaveLength(8);
  });

  it('isBlockKind guards correctly', () => {
    expect(isBlockKind('hero')).toBe(true);
    expect(isBlockKind('nope')).toBe(false);
    expect(isBlockKind(42)).toBe(false);
  });

  it('validates a valid hero block', () => {
    const out = validateBlocks([
      { kind: 'hero', props: { title: 'Hi', cta: { label: 'Go', href: '/x' } } },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('hero');
  });

  it('applies zod defaults (product-grid limit/layout)', () => {
    const out = validateBlocks([
      { kind: 'product-grid', props: { collectionSlug: 'notebooks' } },
    ]);
    const props = out[0]!.props as { limit: number; layout: string };
    expect(props.limit).toBe(12);
    expect(props.layout).toBe('grid');
  });

  it('rejects an unknown block kind', () => {
    expect(() => validateBlocks([{ kind: 'carousel-3000', props: {} }]))
      .toThrow(BlockValidationError);
  });

  it('rejects a hero missing its required title', () => {
    let caught: unknown;
    try {
      validateBlocks([{ kind: 'hero', props: { subtitle: 'no title' } }]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BlockValidationError);
    expect((caught as BlockValidationError).issues.join(' ')).toMatch(/hero.*title/i);
  });

  it('rejects product-grid with neither collectionSlug nor productIds', () => {
    expect(() => validateBlocks([{ kind: 'product-grid', props: {} }]))
      .toThrow(BlockValidationError);
  });

  it('rejects a non-object block entry', () => {
    expect(() => validateBlocks(['not-a-block']))
      .toThrow(BlockValidationError);
  });

  it('validates featured-categories requires at least one slug', () => {
    expect(() => validateBlocks([{ kind: 'featured-categories', props: { categorySlugs: [] } }]))
      .toThrow(BlockValidationError);
    expect(validateBlocks([{ kind: 'featured-categories', props: { categorySlugs: ['a'] } }]))
      .toHaveLength(1);
  });

  it('recurses into two-column columns and rejects a bad nested block', () => {
    // valid nested
    const ok = validateBlocks([
      {
        kind: 'two-column',
        props: {
          left: [{ kind: 'rich-text', props: { markdown: 'left' } }],
          right: [{ kind: 'rich-text', props: { markdown: 'right' } }],
        },
      },
    ]);
    expect(ok).toHaveLength(1);

    // invalid nested (rich-text missing markdown)
    let caught: unknown;
    try {
      validateBlocks([
        { kind: 'two-column', props: { left: [{ kind: 'rich-text', props: {} }], right: [] } },
      ]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BlockValidationError);
    expect((caught as BlockValidationError).issues.join(' ')).toMatch(/two-column\.left/);
  });

  it('reports issues for multiple bad blocks at once', () => {
    let caught: unknown;
    try {
      validateBlocks([
        { kind: 'hero', props: {} },
        { kind: 'rich-text', props: {} },
      ]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BlockValidationError);
    expect((caught as BlockValidationError).issues.length).toBeGreaterThanOrEqual(2);
  });
});
