# Cloudflare R2 Setup

End-to-end provisioning for the object storage backing the SP-8 media
pipeline. The platform talks to R2 via the S3-compatible API (the AWS SDK
is already a dependency). One bucket per environment.

Prereqs:

- A Cloudflare account with R2 enabled (the free tier is enough for staging).
- Permission to manage R2 buckets, API tokens, and (optionally) custom
  domains under the same account.

## 1. Create the bucket

1. Cloudflare dashboard → R2 → **Create bucket**.
2. Name: `<env>-stationery-media` (e.g. `prod-stationery-media`,
   `staging-stationery-media`). Lowercase, hyphens only — must be a valid
   S3 bucket name and a Cloudflare hostname segment.
3. Location: pick the jurisdiction closest to the storefront's primary
   market. For the India default (spec §16) prefer the APAC region.
4. Confirm. The bucket appears with an `Account ID` you'll need below.

## 2. Enable bucket versioning

Versioning is the DR layer: deletes become tombstones, overwrites keep
prior versions. Recovery is "restore the previous version" instead of
"restore from yesterday's backup".

1. Bucket → **Settings** → **Object versioning** → **Enable**.
2. Optionally configure a lifecycle rule to purge non-current versions
   older than 90 days, so versioning cost stays bounded.

## 3. Create a scoped API token

Use a dedicated R2 API token per environment — never reuse the
account-wide token.

1. R2 → **Manage R2 API Tokens** → **Create API token**.
2. Permissions: **Object Read & Write**.
3. Scope: **Apply to specific buckets only** → select the one bucket
   created above. (Account-wide tokens work but blast-radius the rotation.)
4. TTL: leave open-ended; rotation is manual per `docs/secrets.md`.
5. Click **Create** and copy:
   - **Access Key ID** → `R2_ACCESS_KEY_ID`
   - **Secret Access Key** → `R2_SECRET_ACCESS_KEY`
   - **Account ID** (shown on the R2 home; same for all tokens in the
     account) → `R2_ACCOUNT_ID`

The S3 endpoint URL is derived as
`https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` by the AWS SDK — the
platform does not require a separate `R2_ENDPOINT` env var.

## 4. CORS configuration

Direct-upload from the admin browser goes `PUT` against a presigned R2
URL. Storefront derivatives are fetched `GET` either through imgproxy
(server → R2) or directly from the public bucket URL (browser → R2).

Bucket → **Settings** → **CORS Policy** → paste:

```json
[
  {
    "AllowedOrigins": [
      "https://admin.example.com",
      "https://www.example.com"
    ],
    "AllowedMethods": ["PUT", "POST"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  },
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 86400
  }
]
```

Replace the `AllowedOrigins` in the first rule with every host that the
admin UI runs on (one entry per tenant domain that hosts `/admin`, plus
any preview / staging origin). The second rule is permissive on `GET`
because derivatives are publicly cacheable.

## 5. (Optional) Public access for derivatives

Two options for serving derivatives to the browser:

- **Public bucket URL**: R2 → bucket → Settings → R2.dev subdomain →
  enable. Set `R2_PUBLIC_BASE_URL=https://<random>.r2.dev`. Fine for
  staging; not recommended for prod (no custom domain, no cache control).
- **Custom domain via Cloudflare**: bucket → Settings → Custom Domains →
  add `cdn.example.com`. Cloudflare provisions the CNAME and a cert
  automatically. Set `R2_PUBLIC_BASE_URL=https://cdn.example.com`. This
  is the recommended prod path — it puts Cloudflare's cache in front of
  R2 and gives you per-route cache headers.

When imgproxy is the derivative origin (`MEDIA_PROVIDER=r2-imgproxy`,
the platform default), imgproxy itself fetches from R2 with the API
credentials and the storefront only sees `IMGPROXY_BASE_URL`. In that
setup `R2_PUBLIC_BASE_URL` is only used as a fallback for originals
that don't need a derivative.

## 6. Wire env vars

Add to the Render `ecommerce-secrets` env group (see `render.yaml`):

```
MEDIA_PROVIDER=r2-imgproxy
R2_ACCOUNT_ID=<from step 3>
R2_ACCESS_KEY_ID=<from step 3>
R2_SECRET_ACCESS_KEY=<from step 3>
R2_BUCKET=<env>-stationery-media
R2_PUBLIC_BASE_URL=https://cdn.example.com
```

Trigger a redeploy of `web` and `worker` (the image post-process job in
`worker` writes derivatives back to R2; the storefront reads from it).

## 7. Smoke test

1. Log into `/admin` as a staff user.
2. **Admin → Assets → Upload** an image. The browser issues `PUT` against
   a presigned URL; success indicates the CORS rule, the API token, and
   the bucket name are all correct.
3. Refresh the asset list and confirm the thumbnail renders. The
   thumbnail URL is either `R2_PUBLIC_BASE_URL/<key>` or an imgproxy URL
   wrapping it — both indicate the read path is healthy.
4. Re-upload the same key and confirm a new version appears in the R2
   dashboard (versioning sanity check).

## 8. Quotas & cost

- R2 has no egress fee, but Class A operations (writes) and Class B
  (reads) are billed past the free tier. The image post-process worker
  writes one derivative per `(asset, recipe)` pair on demand and caches
  the result; first-render fans these out, steady-state is small.
- Set a Cloudflare billing alert once monthly spend is non-trivial.

## 9. Rotation

See `docs/secrets.md` (R2 section). TL;DR: create a new scoped token,
swap the two `R2_*` env vars in Render, redeploy, then delete the old
token in Cloudflare.
