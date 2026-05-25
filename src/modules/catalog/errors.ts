/**
 * Typed catalog-domain error classes. HTTP route handlers (Stream C/D) map
 * these to RFC 7807 problem+json responses via `problem()` in `src/lib/errors.ts`.
 *
 * Module services throw these directly — never construct HTTP responses inline.
 */

export class CatalogError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = new.target.name;
  }
}

export class ProductNotFoundError extends CatalogError {
  constructor(public readonly identifier: string) {
    super(`Product not found: ${identifier}`);
  }
}

export class CategoryNotFoundError extends CatalogError {
  constructor(public readonly identifier: string) {
    super(`Category not found: ${identifier}`);
  }
}

export class VariantNotFoundError extends CatalogError {
  constructor(public readonly identifier: string) {
    super(`Variant not found: ${identifier}`);
  }
}

export class AttributeNotFoundError extends CatalogError {
  constructor(public readonly identifier: string) {
    super(`Attribute not found: ${identifier}`);
  }
}

export class ImageNotFoundError extends CatalogError {
  constructor(public readonly identifier: string) {
    super(`Image not found: ${identifier}`);
  }
}

export class SlugConflictError extends CatalogError {
  constructor(public readonly slug: string) {
    super(`Slug already exists: ${slug}`);
  }
}

export class SkuConflictError extends CatalogError {
  constructor(public readonly sku: string) {
    super(`SKU already exists: ${sku}`);
  }
}

export class AttributeKeyConflictError extends CatalogError {
  constructor(public readonly key: string) {
    super(`Attribute key already exists: ${key}`);
  }
}

export type AttributeValidationIssue = {
  path: (string | number)[];
  message: string;
};

export class AttributeValidationError extends CatalogError {
  constructor(public readonly issues: AttributeValidationIssue[]) {
    super(
      `Product attributes failed validation: ${issues
        .map(i => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }
}

export class BundleSelfReferenceError extends CatalogError {
  constructor(public readonly variantId: string) {
    super(`Bundle variant cannot reference itself: ${variantId}`);
  }
}

export class NotABundleError extends CatalogError {
  constructor(public readonly variantId: string) {
    super(`Variant is not part of a bundle product: ${variantId}`);
  }
}

export class InsufficientPermissionsError extends CatalogError {
  constructor(public readonly action: string) {
    super(`Insufficient permissions for action: ${action}`);
  }
}

export class CategoryInUseError extends CatalogError {
  constructor(public readonly categoryId: string, public readonly productCount: number) {
    super(
      `Category ${categoryId} is in use by ${productCount} product(s) and cannot be deleted`,
    );
  }
}

export class AttributeInUseError extends CatalogError {
  constructor(public readonly key: string, public readonly productCount: number) {
    super(
      `Attribute ${key} is in use by ${productCount} product(s) and cannot be deleted`,
    );
  }
}
