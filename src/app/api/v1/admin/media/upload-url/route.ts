/**
 * POST /api/v1/admin/media/upload-url
 *
 * Begins a direct-upload. Validates `{ filename, mime, bytes }`, asks the
 * MediaProvider for a pre-signed PUT URL (R2 in prod, a local stub URL in
 * dev/test), and persists a *pending* asset row keyed to the provider's
 * pre-allocated assetId. Returns the upload target so the client can PUT the
 * bytes directly, then call the finalize endpoint.
 *
 * Admin pipeline: auth + RBAC `media:write` + CSRF + Idempotency-Key.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { getMediaProvider } from '@/modules/media/provider';
import { createAssetRecord } from '@/modules/media/assets';
import { runAdminPipeline, readJsonBody, getStoreSlug, mapMediaError } from '../_lib';

const BodySchema = z.object({
  filename: z.string().min(1).max(512),
  mime: z.string().min(1).max(255),
  bytes: z.number().int().nonnegative().max(50 * 1024 * 1024), // 50 MiB hard cap
});

export async function POST(req: Request): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, { requireMutation: true, permission: 'media:write' });
  if (!pipeline.ok) return pipeline.response;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = BodySchema.safeParse(parsed.data);
  if (!body.success) {
    return problem(
      422,
      'asset-validation',
      'Invalid upload request',
      body.error.issues.map(i => ({ path: i.path, message: i.message })),
    );
  }

  try {
    const result = await withIdempotency(
      `admin:media:upload-url:${pipeline.storeId}`,
      pipeline.idempotencyKey!,
      async () => {
        const slug = await getStoreSlug(pipeline.storeId);
        if (!slug) throw new Error('store slug not found');

        const provider = getMediaProvider();
        const presigned = await provider.presignUpload({
          storeSlug: slug,
          filename: body.data.filename,
          mime: body.data.mime,
          bytes: body.data.bytes,
        });

        // Persist a pending row so finalize can find it and so the assetId is
        // stable across the round-trip.
        await createAssetRecord(pipeline.storeId, {
          id: presigned.assetId,
          key: presigned.key,
          kind: presigned.kind,
          mime: body.data.mime,
          bytes: body.data.bytes,
          uploadedBy: pipeline.session.userId,
          meta: { originalFilename: body.data.filename, pending: true },
        });

        return {
          assetId: presigned.assetId,
          key: presigned.key,
          uploadUrl: presigned.uploadUrl,
          headers: presigned.headers,
          kind: presigned.kind,
        };
      },
    );

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    return mapMediaError(err);
  }
}
