# Deterministic and contract test lanes

The default Vitest configuration is the deterministic lane. It does not inherit Redis or external-provider credentials from `.env`, the shell, or a developer workstation. Test setup forces local/log/no-op implementations, clears provider credentials and endpoints, and blocks unmocked external `fetch` requests. Loopback HTTP remains available for local test servers, and tests may still install explicit in-process fetch mocks.

## Deterministic database lane

Database tests run only when all existing destructive-test gates pass:

```text
NODE_ENV=test
RUN_DB_TESTS=1
ALLOW_TEST_DB_RESET=1
EXPECTED_TEST_DB_NAME=<allowlisted bazaar_hardening_* database>
DATABASE_TEST_URL=postgresql://.../<same allowlisted database>
DATABASE_URL=postgresql://.../<same allowlisted database>
```

Then run:

```sh
pnpm test:db:deterministic
```

The safety helper still rejects a database-name mismatch, a production host, a non-local host that is not explicitly allowlisted, or `VERCEL_ENV=production`. Runtime sanitization happens only after those destructive-database checks.

This lane always uses:

- `REDIS_URL=""` and `REDIS_KEY_PREFIX=""`;
- `EMAIL_PROVIDER=log` with no Resend key;
- local image and export storage with no R2/AWS credentials;
- O!Market mock mode and disabled mobile push;
- no OpenAI, marketplace, Bakai Store, FCM, or APNS credentials/endpoints;
- an external-fetch deny guard, except for loopback and explicit test mocks.

## Redis contract lane

The Redis contract is database-free and opt-in. It requires a unique run identity and creates an exact application namespace:

```text
NODE_ENV=test
RUN_REDIS_CONTRACT_TESTS=1
BAZAAR_TEST_RUN_ID=<unique lowercase 8-48 character id>
REDIS_URL=redis://127.0.0.1:6379/<isolated db number>
REDIS_KEY_PREFIX=bazaar:test:<same-run-id>:
```

`REDIS_KEY_PREFIX` may be omitted; setup derives the exact value. A remote Redis host additionally requires `HARDENING_TEST_REDIS_HOST_ALLOWLIST`, and any host named by `PRODUCTION_REDIS_HOSTS` or `PRODUCTION_REDIS_URL` is rejected even if allowlisted.

Run only against an authorized disposable target:

```sh
pnpm test:contract:redis
```

The contract writes one run-scoped probe key, verifies that no unprefixed key was written, and deletes only the two exact probe-key forms. It never scans or flushes Redis.

## External-provider contract lane

The provider lane is also database-free and opt-in:

```text
NODE_ENV=test
RUN_EXTERNAL_PROVIDER_CONTRACT_TESTS=1
BAZAAR_TEST_PROVIDER_SANDBOX_ACK=SANDBOX_ONLY
BAZAAR_TEST_PROVIDER_CONTRACT=<resend|openai|r2|m-market|o-market|bakai-store|mobile-push>
HARDENING_TEST_PROVIDER_HOST_ALLOWLIST=<comma-separated sandbox hosts>
```

Each allowlisted hostname must be loopback or visibly identify a `dev`, `test`, `testing`, `sandbox`, or `staging` target. Only credentials for the selected provider survive setup; Redis and all unrelated provider credentials remain disabled. R2 additionally requires an allowlisted `R2_ENDPOINT`; Bakai Store requires an allowlisted `BAKAI_STORE_IMPORT_ENDPOINT`.

The checked-in provider test is a no-network policy preflight:

```sh
pnpm test:contract:provider
```

It does not contact a provider. Provider-specific request/response contracts may be added only for an authorized sandbox, with the exact target on the allowlist. Providers exposing only production endpoints remain externally blocked rather than being treated as tested.
