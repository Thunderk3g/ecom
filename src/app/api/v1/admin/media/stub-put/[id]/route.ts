/**
 * PUT /api/v1/admin/media/__stub_put__/[id]
 *
 * Stub object-storage receiver. In production the pre-signed PUT URL points
 * directly at Cloudflare R2 (no app code runs). With `MEDIA_PROVIDER=stub`
 * (dev/test default), the StubMediaProvider hands out *this* local URL instead,
 * so the client's direct-upload PUT has somewhere to land. We discard the body
 * and return 204 — finalize then trusts the client-reported metadata.
 *
 * This endpoint mimics an opaque pre-signed URL: it is not part of the JSON API
 * surface and intentionally does not enforce CSRF/Idempotency (those guard the
 * mutating JSON endpoints upload-url + finalize). It requires a valid admin
 * session so the stub isn't a fully open sink.
 */

import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/modules/auth/rbac';
import { problem } from '@/lib/errors';

type RouteCtx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, _ctx: RouteCtx): Promise<NextResponse> {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return problem(401, 'unauthenticated', 'Authentication required', []);
  }
  // Drain and discard the uploaded bytes.
  try {
    await req.arrayBuffer();
  } catch {
    // Body may be absent/streamed; ignore.
  }
  return new NextResponse(null, { status: 204 });
}
