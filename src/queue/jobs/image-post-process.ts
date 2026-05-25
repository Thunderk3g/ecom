/**
 * image.post-process worker handler (SP-8).
 *
 * Enqueued by the media finalize endpoint after an upload is validated. The job
 * generates derivative renditions for an image asset at the standard presets
 * (thumb / card / detail / hero) and persists `asset_derivatives` rows.
 *
 * The job payload carries `storeId` so the handler scopes all DB work through
 * `withTenant` (NOBYPASSRLS app_user) — no BYPASSRLS / migratorDb needed, which
 * keeps tenant isolation intact even in background processing.
 *
 * Stub provider: derivative URLs are synthesized deterministically (no real
 * image conversion). Real (r2-imgproxy) provider: deriveUrl builds imgproxy
 * signed URLs; actual byte conversion is performed lazily by imgproxy at
 * request time, so the job only needs to record the URLs. Non-image assets
 * (svg/doc) are skipped — they have no raster derivatives.
 */

import type { Job } from 'bullmq';
import { logger } from '@/lib/logger';
import { getAsset, recordDerivative } from '@/modules/media/assets';
import { getMediaProvider, DERIVATIVE_PRESETS, type DerivativePreset } from '@/modules/media/provider';

export interface ImagePostProcessPayload {
  storeId: string;
  assetId: string;
}

export interface ImagePostProcessResult {
  assetId: string;
  derivatives: number;
  skipped?: 'not-image';
}

const PRESETS = Object.keys(DERIVATIVE_PRESETS) as DerivativePreset[];

export async function imagePostProcess(
  job: Job<ImagePostProcessPayload>,
): Promise<ImagePostProcessResult> {
  const { storeId, assetId } = job.data;
  logger.info({ jobId: job.id, storeId, assetId }, 'image post-process received');

  const asset = await getAsset(storeId, assetId);

  if (asset.kind !== 'image') {
    logger.info({ jobId: job.id, assetId, kind: asset.kind }, 'image post-process skipped (not an image)');
    return { assetId, derivatives: 0, skipped: 'not-image' };
  }

  const provider = getMediaProvider();
  const deriveAsset = { storeSlug: asset.key.split('/')[0] ?? '', key: asset.key, kind: asset.kind };

  let count = 0;
  for (const preset of PRESETS) {
    const size = DERIVATIVE_PRESETS[preset];
    const url = provider.deriveUrl(deriveAsset, preset);
    await recordDerivative(storeId, {
      assetId,
      preset,
      // Longest-edge target; exact post-resize dimensions are unknown without a
      // decode, so we record the bound. Storefront uses these as max hints.
      width: size,
      height: size,
      url,
    });
    count += 1;
  }

  logger.info({ jobId: job.id, assetId, derivatives: count }, 'image post-process complete');
  return { assetId, derivatives: count };
}
