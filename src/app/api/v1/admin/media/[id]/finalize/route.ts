/**
 * POST /api/v1/admin/media/[id]/finalize
 *
 * Completes a direct-upload: the client has PUT the bytes to the pre-signed
 * URL, now the server validates the object via the MediaProvider, records the
 * confirmed metadata (size/dimensions/checksum, clears the `pending` flag), and
 * enqueues the `image.post-process` job to generate derivatives.
 *
 * Admin pipeline: auth + RBAC `media:write` + CSRF + Idempotency-Key.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { getMediaProvider } from '@/modules/media/provider';
import { getAsset, updateAssetMetadata } from '@/modules/media/assets';
import { imagePostProcessQueue } from '@/queue/queues';
import { runAdminPipeline, readJsonBody, mapMediaError } from '../../_lib';

type RouteCtx = { params: Promise<{ id: string }> };

const BodySchema = z.object({
  bytes: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  checksum: z.string().min(1).max(128).optional(),
});

export async function POST(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, { requireMutation: true, permission: 'media:write' });
  if (!pipeline.ok) return pipeline.response;

  const { id } = await ctx.params;

  // Body is optional for the stub flow; tolerate an empty/absent body.
  let metadata: z.infer<typeof BodySchema> = {};
  const parsed = await readJsonBody(req);
  if (parsed.ok) {
    const body = BodySchema.safeParse(parsed.data ?? {});
    if (!body.success) {
      return problem(
        422,
        'asset-validation',
        'Invalid finalize request',
        body.error.issues.map(i => ({ path: i.path, message: i.message })),
      );
    }
    metadata = body.data;
  }

  try {
    const result = await withIdempotency(
      `admin:media:finalize:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () => {
        const asset = await getAsset(pipeline.storeId, id);

        const provider = getMediaProvider();
        const finalized = await provider.finalizeUpload({
          assetId: asset.id,
          key: asset.key,
          mime: asset.mime,
          bytes: metadata.bytes,
          width: metadata.width,
          height: metadata.height,
          checksum: metadata.checksum,
        });

        const meta = { ...asset.meta };
        delete meta.pending;

        const updated = await updateAssetMetadata(pipeline.storeId, id, {
          bytes: finalized.bytes,
          width: finalized.width,
          height: finalized.height,
          checksum: finalized.checksum,
          meta,
        });

        await imagePostProcessQueue.add(
          'image.post-process',
          { storeId: pipeline.storeId, assetId: id },
          {
            jobId: `post-process:${id}`,
            attempts: 5,
            backoff: { type: 'exponential', delay: 1_000 },
            removeOnComplete: true,
            removeOnFail: 50,
          },
        );

        return {
          assetId: updated.id,
          key: updated.key,
          kind: updated.kind,
          bytes: updated.bytes,
          width: updated.width,
          height: updated.height,
          checksum: updated.checksum,
        };
      },
    );

    return NextResponse.json({ data: result }, { status: 200 });
  } catch (err) {
    return mapMediaError(err);
  }
}
