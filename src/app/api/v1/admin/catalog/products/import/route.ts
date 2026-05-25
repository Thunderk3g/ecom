/**
 * POST /api/v1/admin/catalog/products/import
 *
 * Accepts a multipart/form-data upload with a single `file` field (CSV). The
 * file body is read, buffered, and enqueued onto the `csv.imports` BullMQ
 * queue. The actual import processor lands in SP-6 — here we just produce a
 * job that the worker will consume.
 *
 * Response: { data: { jobId } }
 *
 * Idempotency-Key is honoured so re-submitting the same form returns the
 * same jobId without enqueueing twice.
 */

import { NextResponse } from 'next/server';
import { csvImportsQueue } from '@/queue/queues';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapCatalogError, runAdminPipeline } from '../../_lib';

const MAX_BYTES = 20 * 1024 * 1024; // 20 MiB safety cap

export async function POST(req: Request): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'catalog:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return problem(415, 'unsupported-media-type', 'Expected multipart/form-data', []);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return problem(400, 'invalid-multipart', 'Failed to parse multipart form', []);
  }

  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return problem(422, 'invalid-body', 'Missing file field', [
      { path: ['file'], message: 'required' },
    ]);
  }
  if (file.size > MAX_BYTES) {
    return problem(413, 'payload-too-large', `File exceeds ${MAX_BYTES} bytes`, []);
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const result = await withIdempotency(
      `admin:catalog:products:import:${pipeline.storeId}`,
      pipeline.idempotencyKey!,
      async () => {
        const job = await csvImportsQueue.add(
          'products-import',
          {
            kind: 'products',
            storeId: pipeline.storeId,
            uploadedBy: pipeline.session.userId,
            fileName: file.name,
            mimeType: file.type,
            sizeBytes: buffer.byteLength,
            // For SP-2 we ship the raw bytes inline (small files only). SP-6
            // replaces this with an object-storage reference uploaded via the
            // assets pipeline.
            bodyBase64: buffer.toString('base64'),
          },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5_000 },
            removeOnComplete: 100,
            removeOnFail: 100,
          },
        );
        return { jobId: job.id ?? null };
      },
    );

    return NextResponse.json({ data: result }, { status: 202 });
  } catch (err) {
    return mapCatalogError(err);
  }
}
