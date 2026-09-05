# Production migration ledger acknowledgement

The first guarded Vercel builds on 5 September stopped before applying migrations because five completed production ledger entries differed from `main`. The serving baseline was `190edad`; this release had changed no existing migration files relative to that baseline.

The guard now recognizes only these exact historical records. They are separate from the two approved pending migrations. Unknown names/digests and unfinished migrations still stop deployment. No ledger rows, historical SQL files or existing application data are rewritten.

- `20260429123000_bazaar_api_keys`: the production digest matches commit `fd7049617a8ffe3b42e6e4bc99383416cb6439e3`. Commit `5c38f849006a1c5b2cc942775576cf30d4aff5d4` changed capitalization in two SQL comments only. Both the recorded and current-file SHA-256 values are pinned in `acknowledgedAppliedHistory`.
- Four August 31 records absent from `main` match exact Git blobs in commit `4e587c2a4fe203550267107e81a4f5410e62bf2a`, committed on August 31 at 20:41:52 +06:00. That commit is retained on the `codex/bazaar-readiness-release-20260831` and `codex/bazaar-readiness-deferred-20260901` refs. Their names and exact digests are pinned in the guard. Verification was limited to Git metadata and file hashes because those historical files concern excluded Inventory scope. They are neither restored nor replayed, and their SQL semantics were not assessed.

The ignored evidence files `migration-git-history.json`, `production-migration-ledger-compatibility.json`, and `vercel-diagnostic-build.log` under `artifacts/bazaar-continuation/20260905/` record provenance. Production diagnostics contain migration names and SQL digests, not credentials or business rows. No production environment download occurred.

This acknowledgement supports applying the two independently reviewed additive auth/job migrations to the existing database. It does not reconcile the separate branches or certify physical schema drift. A later owner-authorized Inventory/schema workstream must resolve the broader historical divergence.

Prisma's production deployment command applies pending migrations without resetting the database; it does not detect physical drift and does not replay already-applied missing files. The application guard supplies the stricter exact-history checks described here. [Prisma production migration behavior](https://www.prisma.io/docs/orm/v6/prisma-migrate/workflows/development-and-production).
