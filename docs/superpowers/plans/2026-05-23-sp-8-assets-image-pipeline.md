# SP-8: Asset Library & Image Pipeline — Implementation Plan

> Use superpowers:subagent-driven-development.

**Goal:** Replace SP-2's stubbed `upload-url` endpoint with a real direct-upload-to-S3 (Cloudflare R2 default) flow. Build the assets registry, derivative pipeline via imgproxy, SVG sprite generation, and Next.js custom image loader.

---

## Scope

**Schemas:**
- `assets` (id, store_id, key text — content-hashed object key, kind, mime, bytes, width, height, checksum, meta jsonb, uploaded_by, created_at)
- `asset_derivatives` (id, asset_id, preset, width, height, url, created_at)
- `asset_tags` (asset_id, tag) — optional taxonomy

**Object key convention:** `<store_slug>/<sha256-of-bytes>.<ext>`. Content-addressed enables free dedupe.

**Upload flow:**
1. Admin POST /admin/assets/upload-url with `{ filename, mime, bytes }` → returns pre-signed PUT URL + temporary asset_id
2. Client PUTs the file directly to R2
3. Client POST /admin/assets/[id]/finalize → server fetches the object, validates checksum/dimensions/mime, INSERT asset row, enqueues `image.post-process` job
4. Worker job: extracts EXIF, strips it, generates derivatives via imgproxy at presets (thumb 128, card 320, detail 800, hero 1600), persists asset_derivatives rows

**imgproxy integration:**
- Self-hosted imgproxy container in docker-compose.dev.yml
- URL signing: HMAC-signed URLs to prevent abuse
- Presets: thumb/card/detail/hero with WebP + AVIF fallback

**Cloudflare Images swappability:**
- `MediaProvider` interface — R2 + imgproxy implementation vs Cloudflare Images implementation. Selected via env `MEDIA_PROVIDER=r2-imgproxy|cf-images`.

**SVG sprite pipeline:**
- Admin uploads individual SVG icons → asset rows with kind='svg'
- CI step or runtime job generates `/public/sprites/icons-<storeSlug>.svg` `<symbol>` aggregate
- Storefront `<Icon name="cart"/>` renders `<svg><use href="/sprites/icons-<storeSlug>.svg#cart"/></svg>`

**Next.js custom image loader:**
- `next.config.ts` sets a custom `loader` that builds imgproxy signed URLs
- `<Image>` calls reach imgproxy automatically

---

## Tasks (high-level)

1. assets + asset_derivatives + asset_tags schemas (migration 0020)
2. RLS for asset tables
3. R2 client wrapper (S3-compatible — use `@aws-sdk/client-s3`)
4. MediaProvider interface + R2/imgproxy implementation
5. Cloudflare Images alternate implementation (stub for now if account access not arranged)
6. Pre-signed URL endpoint (replaces SP-2 stub)
7. Finalize endpoint
8. `image.post-process` worker handler
9. imgproxy URL signer + Next.js custom loader
10. SVG aggregator (admin batch action: build sprite)
11. Admin assets gallery (browse, filter by kind/tag, replace, delete)
12. Migrate product_images to FK assets.id properly (already in schema as uuid; just add FK constraint)
13. docker-compose.dev.yml updates: add imgproxy service
14. Tests: upload pre-sign + finalize + post-process via test bucket

---

## Risks

1. **CORS on R2:** must allow PUT from the admin origin. Add a CORS config doc.
2. **Image post-process latency:** large image conversion can take seconds. Show "processing…" placeholders in admin and use revalidate tags when derivatives complete.
3. **imgproxy security:** must use signed URLs in prod to prevent SSRF / unbounded resize.
4. **Storage cost:** content-hashing dedupes within a store but not across stores. Per-store keys keep tenancy clean; multi-store dedupe is out of scope.
5. **Antivirus scan:** v1 trusts the admin user. AV scanning is a follow-up.
