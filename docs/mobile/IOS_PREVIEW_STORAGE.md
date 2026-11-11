# Durable media for the isolated iOS Preview

The ordinary local provider writes product images into `public/uploads` and report files into the operating system's temporary directory. A Vercel function's filesystem is not a durable shared media store. Moving product files into `/tmp` would not make a later request, another function instance, or a redeployment able to serve them.

The new optional `vercel-blob` provider stores organization product photos separately from private exports. It does not change production's existing local/R2 selection. Private BAAM-only attachments remain AES-256-GCM encrypted in the isolated PostgreSQL database; only an explicitly confirmed product-photo adoption copies an image into the organization photo store.

## Explicit storage identities

| Purpose | Provider/configuration | Access |
| --- | --- | --- |
| Organization product images | `IMAGE_STORAGE_PROVIDER=vercel-blob`, `BLOB_IMAGE_STORE_ID` | Public product images, with organization/product-scoped content-hash paths |
| CSV/XLSX reports and short-lived image ZIP exports | `EXPORT_STORAGE_PROVIDER=vercel-blob`, `BLOB_EXPORT_STORE_ID` | Separate private Blob store; authenticated Bazaar download routes stream the content |

The two stores must differ. Before every upload, read, metadata lookup or deletion, the service calls the official `@vercel/oidc` resolver afresh and supplies its token together with the exact purpose-specific `storeId`. Vercel Functions supply OIDC through their request context; a build-time `VERCEL_OIDC_TOKEN` environment variable is not required at runtime. Missing/empty/failed OIDC resolution stops the operation before Blob is called. A default `BLOB_STORE_ID` or generic `BLOB_READ_WRITE_TOKEN` cannot substitute for either the explicit store or OIDC. No token is returned to the browser, copied from another application, or written into these documents.

The Blob SDK does not automatically refresh an explicitly supplied `oidcToken`. The resolver therefore runs for each operation, including a new recovery attempt, with no cached token in this service. Existing command timeouts remain 45 seconds for uploads/reads and 15 seconds for metadata/deletion. The upload route logs only an allowlisted internal/provider failure category and two token-presence booleans; it never logs exception messages/stacks, header values, credentials, filenames or account identifiers, and the client still receives the generic failure response.

With `HARDENING_PREVIEW_GUARD=1`, both providers must explicitly be `vercel-blob` before this storage exception is available. The following checks apply in addition to the existing exact isolated database host/name, disabled providers and Redis namespace requirements:

- `HARDENING_PREVIEW_EXPECTED_PROJECT_ID` must equal the platform's `VERCEL_PROJECT_ID`.
- `HARDENING_PREVIEW_EXPECTED_IMAGE_STORE_ID` must exactly equal `BLOB_IMAGE_STORE_ID`.
- `HARDENING_PREVIEW_EXPECTED_EXPORT_STORE_ID` must exactly equal `BLOB_EXPORT_STORE_ID`.
- The two store identities must be distinct. Their URL hostnames are normalized to lowercase; configured store identifiers retain their original case.
- All R2 credentials/endpoints remain forbidden. The separate storage permission does not authorize AI, email, payment or other external-provider calls.

Root provisioned two new stores, connected only to the new isolated project's Preview environment. The existing Vercel team is on an active Pro plan; these stores must not be described as independent Free/Hobby resources. The test uses tiny synthetic artifacts, with no plan upgrade or production storage reuse. Actual metering/remaining included usage is a platform fact to check, not a guarantee that any future volume is free.

## Download, retry and erasure behavior

Images use the existing server upload normalization and size bounds; R2 direct-upload targets remain unavailable for this provider, so the existing bounded upload proxy is used. An erasure request can delete only an image in the configured image store and the same organization's validated product path. Adopted company product images stay outside personal-account erasure when still referenced.

Report storage locations use the `vercel-blob:` prefix in the existing `ExportJob.storagePath`. Before a Blob read or metadata lookup, the service validates the private store origin and the job's organization/job path. The existing authorization, store access, content disposition, `nosniff`, and `Cache-Control: private, no-store` remain in the download route. A missing artifact can be rebuilt from the authorized report job. Private Blob reads use `useCache:false`; the provider's minimum internal cache lifetime is 60 seconds and does not turn the Bazaar download response into a public cache.

Both export creation and retry retain their already-handled background job promise through the existing hosting-lifetime helper. The immediate account-asset erasure attempt uses the same helper. They still return their normal response without waiting for the background attempt, and existing durable recovery/claim behavior remains in place. This matters on serverless hosting, where an unretained promise can be stopped when the HTTP response completes.

Image ZIPs use the existing owner-scoped atomic Redis claim and original absolute lease. A failed object read restores only the remaining lease; successful retrieval stays one-time even if object deletion or expiration-list cleanup fails. Expired object cleanup retries on subsequent export writes. Temporary files are used only to build/stage the upload in one request, never as the durable artifact.

## Verification boundary

The source has provider-mocked unit checks for store separation, missing OIDC, foreign URLs/traversal, scoped erasure, Preview identity guards and original ZIP retry/one-time behavior. A disposable PostgreSQL integration file exercises actual export jobs and the authenticated download route with the Blob SDK mocked, including anonymous/role/tenant denials and missing-artifact recovery. The root serializes all executions on this laptop; record their actual results in the release progress log.

After deployment, a small synthetic product image and CSV/ZIP must still be uploaded, read after separate requests, and checked from the iPhone. Those cloud operations establish the real project connection/OIDC/provider behavior; mocked SDK tests do not establish that behavior. No real customer or production artifacts are suitable for this smoke check.

Primary references: [Blob SDK/OIDC and explicit store IDs](https://vercel.com/docs/vercel-blob/using-blob-sdk), [private Blob storage](https://vercel.com/docs/vercel-blob/private-storage), [Preview-only CLI connection options](https://vercel.com/docs/cli/blob), [current usage and pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing).

The runtime token source is documented in [Vercel OIDC federation](https://vercel.com/docs/oidc) and [system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables#vercel_oidc_token). Local `vercel env pull` obtains a Development token, even when other requested environment values are for Preview. The Preview-only storage connections deliberately reject that local token; cloud smoke checks must use the deployed Preview function's OIDC context.
