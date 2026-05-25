/**
 * Typed errors for the CMS domain (pages, versions, blocks, navigation).
 * HTTP route handlers (future UI streams) translate these to RFC 7807
 * problem+json. Module services throw them directly — never build HTTP
 * responses inline. Naming mirrors src/modules/orders/errors.ts.
 */

export class CmsDomainError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = new.target.name;
  }
}

/** Page id/slug not visible in the current tenant. */
export class PageNotFoundError extends CmsDomainError {
  constructor(public readonly identifier: string) {
    super(`Content page not found: ${identifier}`);
  }
}

/** A version id referenced (e.g. a draft to publish, or a preview target) does not exist for the page. */
export class VersionNotFoundError extends CmsDomainError {
  constructor(public readonly identifier: string) {
    super(`Content version not found: ${identifier}`);
  }
}

/** A page with the same (store_id, slug) already exists. */
export class SlugConflictError extends CmsDomainError {
  constructor(public readonly slug: string) {
    super(`Content page slug already in use: ${slug}`);
  }
}

/**
 * One or more blocks failed validation against their registered zod schema.
 * `issues` is a flat list of human-readable problems keyed by block index.
 */
export class BlockValidationError extends CmsDomainError {
  constructor(public readonly issues: string[]) {
    super(`Block validation failed: ${issues.join('; ')}`);
  }
}
