/**
 * Named error classes for the SP-8 media / asset module.
 *
 * Domain errors thrown by module-service + provider code. HTTP route handlers
 * catch these and translate to RFC 7807 problem responses.
 */

export class MediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Asset id was not found in the current tenant. */
export class AssetNotFoundError extends MediaError {
  public readonly assetId: string;
  constructor(assetId: string) {
    super(`Asset ${assetId} not found`);
    this.assetId = assetId;
  }
}

/** The asset row exists but its upload has not been finalized yet. */
export class AssetNotFinalizedError extends MediaError {
  public readonly assetId: string;
  constructor(assetId: string) {
    super(`Asset ${assetId} upload has not been finalized`);
    this.assetId = assetId;
  }
}

/** The requested upload's mime type / size / kind failed validation. */
export class AssetValidationError extends MediaError {
  public readonly issues: { path: (string | number)[]; message: string }[];
  constructor(message: string, issues: { path: (string | number)[]; message: string }[] = []) {
    super(message);
    this.issues = issues;
  }
}

/**
 * A real media provider (r2-imgproxy) was selected but the required
 * credentials/config are missing from the environment. Thrown lazily at first
 * use so dev + tests can run with `MEDIA_PROVIDER=stub` and no keys.
 */
export class MediaProviderConfigError extends MediaError {
  public readonly missing: string[];
  constructor(provider: string, missing: string[]) {
    super(`Media provider '${provider}' is misconfigured; missing: ${missing.join(', ')}`);
    this.missing = missing;
  }
}

/** Asset cannot be deleted because it is still referenced (e.g. product image). */
export class AssetInUseError extends MediaError {
  public readonly assetId: string;
  constructor(assetId: string, message?: string) {
    super(message ?? `Asset ${assetId} is still referenced and cannot be deleted`);
    this.assetId = assetId;
  }
}
