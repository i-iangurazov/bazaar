# Owner Diagnostics

## Purpose
`/settings/diagnostics` allows an organization owner to run safe health checks for the tenant without support access.

## Access
- Only authenticated organization owners (`user.isOrgOwner = true`) can run diagnostics.
- Checks are tenant-scoped and never expose platform secrets.

## Checks
- `database`: verifies app-level DB query and migration health signal.
- `redis`: verifies Redis connectivity (`PING`) and pub/sub roundtrip.
- `sse`: verifies realtime event pipeline delivery.
- `email`: verifies email provider configuration, optional test email.
- `exports`: runs a tiny export job and checks completion state.
- `pdf`: generates a tiny price-tags PDF and verifies output bytes.
- `jobs`: runs a safe no-op background job and verifies lock behavior.
- `subscription`: returns current tier, status, limits, usage, trial/period dates.

## Security Rules
- Reports are persisted in `DiagnosticsReport` per organization.
- Report payload excludes secrets, URLs with credentials, env vars, headers, and tokens.
- Endpoint rate limits:
  - `runAll`: max 3 per 60s per actor+path.
  - `runOne`: max 10 per 60s per actor+path.
- Email test send in production requires explicit user confirmation.

## Report Shape
- `id`
- `createdAt`
- `generatedAt`
- `overallStatus` (`ok` | `warning` | `error`)
- `checks[]` with:
  - `type`
  - `status`
  - `code`
  - `details` (safe, non-secret)
  - `ranAt`
  - `durationMs`

## Owner QA
1. Sign in as org owner and open `/settings/diagnostics`.
2. Run one check (`database`) and confirm status updates with timestamp.
3. Run all checks and confirm a full report appears.
4. Click copy report and verify JSON can be pasted externally.
5. Confirm non-owner users receive forbidden access for diagnostics API/page.
