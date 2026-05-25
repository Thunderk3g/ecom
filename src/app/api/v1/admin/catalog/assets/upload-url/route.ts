/**
 * POST /api/v1/admin/catalog/assets/upload-url
 *
 * SP-2 introduced this as a stub. SP-8 wires it to the real media pipeline: it
 * delegates to the MediaProvider for a pre-signed PUT URL and persists a
 * pending asset row, exactly like /api/v1/admin/media/upload-url. Kept as a
 * thin alias so existing catalog admin clients (and the SP-2 image attach flow)
 * continue to work; the `media:write` permission gates it.
 *
 * Body: `{ filename, mime, bytes }`. Admin pipeline: auth + RBAC + CSRF +
 * Idempotency-Key.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { getMediaProvider } from '@/modules/media/provider';
import { createAssetRecord } from '@/modules/media/assets';
import { runAdminPipeline } from '../../_lib';
import { getStoreSlug, mapMediaError } from '../../../media/_lib';

const BodySchema = z.object({
  filename: z.string().min(1).max(512),
  mime: z.string().min(1).max(255),
  bytes: z.number().int().nonnegative().max(50 * 1024 * 1024),
});

export async function POST(req: Request): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'media:write',
  });
  if (!pipeline.ok) return pipeline.response;

  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return problem(400, 'invalid-json', 'Request body must be valid JSON', []);
  }
  const body = BodySchema.safeParse(data);
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
      `admin:catalog:assets:upload-url:${pipeline.storeId}`,
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

        await createAssetRecord(pipeline.storeId, {
          id: presigned.assetId,
          key: presigned.key,
          kind: presigned.kind,
          mime: body.data.mime,
          bytes: body.data.bytes,
          uploadedBy: pipeline.session.userId,
          meta: { originalFilename: body.data.filename, pending: true },
        });

        // `url` retained for backward compatibility with the SP-2 stub shape.
        return { assetId: presigned.assetId, key: presigned.key, url: presigned.uploadUrl };
      },
    );

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    return mapMediaError(err);
  }
}
