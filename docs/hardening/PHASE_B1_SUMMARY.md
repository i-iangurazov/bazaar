# Phase B1 — P0-A security and isolation summary

Baseline integration commit: `343079b4e6cd6140f84a8448610259b2d7573704`

Approved and deployed commit: `042ed6781f1ee483ee3f428f6fc8c8ecc0b3a15c`

Main remained: `4d7c9b33218b584334ca62f7a816f8997f144a10`

Status: **P0-A PREVIEW SECURITY GATE PASS; ONE NEW NON-P0 RUNTIME FINDING LOGGED**

## Outcome

All 24 confirmed P0-A issues are closed. Agent 4 independently repeated the relevant allowed, same-org denied, cross-org, cross-store/ID-tampering, direct API, and no-side-effect checks locally and against the protected Preview deployment. Five consolidated root-cause groups close the 24 individual acceptance contracts. No P1/P2 fix or UI polish was included.

| Owner | Closed P0-A | Issues | Verification |
| --- | ---: | --- | --- |
| Agent 1 — POS | 3 | HARD-A1-001/002/003 | APPROVED |
| Agent 2 — Products/Inventory | 7 | HARD-A2-001/002/003/004/008/009/010 | APPROVED |
| Agent 3 — Commerce/API | 6 | HARD-A3-002/006/007/008/009/026 | APPROVED |
| Agent 4 — Platform | 8 | HARD-A4-001/002/003/004/005/006/009/011 | APPROVED; Agent 1 cross-review |
| **Total** | **24** |  | **24 APPROVED** |

## Root-cause closures

| Group | Primary issue | Related issues closed | Closure |
| --- | --- | --- | --- |
| RC-01 — effective-store authorization | HARD-A1-001 | A1-002, A2-001/009, A3-006, A4-005/006 | Trusted session/API-key identity now determines effective stores before reads, mutations, artifacts, SSE, and period close. |
| RC-02 — route/procedure policy parity | HARD-A4-001 | A1-003, A2-004, A3-007/008, A4-002/003/004/011 | Shared role policy is enforced at middleware, tRPC/API and service boundaries. The root middleware was moved under `src/`, making the route gate active in the production build. |
| RC-03 — sensitive capability boundary | HARD-A3-002 | A2-010, A3-026, A4-009 | Revoked keys bypass no cache; export/job identities are tenant-bound; the public image proxy validates URL, DNS, redirects, type, size and timeout. |
| RC-04 — product/store eligibility | HARD-A2-002 | A2-003, A3-009 | Product read/write, price, assignment and sales-order lines require an active product assignment in an allowed store. |
| RC-06 — scoped destructive mutation | HARD-A2-008 | — | Category removal is constrained to the selected accessible store and produces no foreign-store side effect. |

## Authored and integrated commits

Only reviewed commits were selectively cherry-picked; no full agent branch was merged.

| Agent | Authored commits | Integration commits |
| --- | --- | --- |
| Agent 1 | `a3bfe01`, `3964a39` | `1b00df6`, `cd799a4` |
| Agent 2 | `ed3a46f`, `beb9d9f`, `981f8ce`, `5b38a73`, `e7f61eb`, `b6da544`, `3b59bb1` | `1cc6689`, `175b42f`, `1d300f1`, `868ddfa`, `f263073`, `4883049`, `5a68742`, `4daa421` |
| Agent 3 | `10543b2`, `0850fae`, `fede2d1`, `9ace74d`, `8729ebf`, `136b384`, `d7c42c2` | `4ee5d3f`, `6aa0a52`, `b2d6dae`, `e085245`, `6c27ea7`, `fbb0fc8`, `21bb9ee`, `fa0c486` |
| Agent 4 | platform batch and test commits recorded in integration log; Preview Redis isolation `6a8cd99`; active middleware `ba9938a` | `75a026b`, `7b23fae`, `de98a51`, `23c44b9`, `62360e4`, `93cfebf`, `1233f4b`, `cfdb8a2`, `6a8cd99`, `ba9938a` |

## Security verification

| Gate | Result |
| --- | --- |
| Typecheck | PASS |
| Lint | PASS — no warnings/errors |
| i18n | PASS |
| Unit/integration suite | PASS — 168 files, 946 tests |
| Production build | PASS — 81 static-generation steps; active 48.5 kB middleware |
| `git diff --check` | PASS |
| DB migrations | PASS — 87/87 existing migrations; no B1 migration authored |
| Browser security matrix | PASS — 12/12, four roles, desktop/mobile |
| API/DB security smoke | PASS — 14/14, two organizations and three stores |
| SSRF | PASS — 42 unit cases and 13 live denied targets; public image positive path retained |
| API key isolation | PASS — scope/tampering/revocation/indistinguishable 404/no-side-effect checks |
| Secret/network/log scan | PASS — 26 HTTP bodies, browser page/network traffic, and 500 runtime-log records contained no QA sentinel/token or credential pattern |
| Preview deployment | READY — protected Preview, exact approved SHA verified |

Durable machine-readable evidence:

- [`evidence/b1/agent4-verification.json`](./evidence/b1/agent4-verification.json)
- [`evidence/b1/api-security-smoke.json`](./evidence/b1/api-security-smoke.json)
- [`evidence/b1/browser-security-smoke/summary.json`](./evidence/b1/browser-security-smoke/summary.json)
- [`B1_RBAC_MATRIX.md`](./B1_RBAC_MATRIX.md)

## Environments and migrations

| Environment | Database | Redis isolation |
| --- | --- | --- |
| Agent 1 | `bazaar_hardening_agent1_pos` | logical DB 11 |
| Agent 2 | `bazaar_hardening_agent2_inventory` | logical DB 12 |
| Agent 3 | `bazaar_hardening_agent3_commerce` | logical DB 13 |
| Agent 4 | `bazaar_hardening_agent4_platform` | logical DB 14 |
| Preview QA | `bazaar_hardening_preview_b1` | `bazaar:hardening:b1:preview:042ed678:` key/channel prefix |

The Preview QA database was seeded only with synthetic data: two organizations, three stores, four application roles, scoped API keys, and secret sentinels. All 87 checked-in migrations were applied with `prisma migrate deploy`; a final migration check reported no pending migrations. No `db push`, schema change, or new migration was used in B1. Email/marketplace/AI providers were mocked or disabled for the gate. After verification, all five QA users were deactivated, both API keys revoked, and all stored synthetic provider-token fields cleared.

## Shared files

Shared authorization, store-access, SSE/event, export/download, provider URL-fetching, Redis/runtime, middleware, and job-capability files changed under the recorded exclusive claims in [`SHARED_FILE_OWNERSHIP.md`](./SHARED_FILE_OWNERSHIP.md). Agent 4 changes received Agent 1 cross-review. No package dependency, lockfile, Prisma schema, migration, translation, global CSS, or shared UI primitive changed.

## Preview deployment and cleanup

| Field | Value |
| --- | --- |
| Existing Vercel project | `bazaar` / `prj_M1de7oGW6aL0xRTTYlHjz3ATxXbi` |
| Deployment ID | `dpl_B4cmRL7MxKwSXyr54JK12mfRH14n` |
| Preview URL | `https://bazaar-hardening-b1.vercel.app` |
| Generated deployment URL | `https://bazaar-3ki9wg2u6-ilyas0707s-projects.vercel.app` |
| Deployed SHA | `042ed6781f1ee483ee3f428f6fc8c8ecc0b3a15c` |
| Vercel target/state | `Preview` / `Ready` |
| Access | Vercel Authentication; unauthenticated and revoked-bypass requests redirect to SSO |

Deployment preflight checked the Preview target, exact database name, distinct non-Production database host, provider-disabled/mock mode, Redis prefix, and absence of destructive-test flags before upload. The deployment used only the 886 committed, non-ignored files from the detached approved commit. Deployment-specific secrets were newly generated and passed only to this Preview deployment; no Development or Production environment variable was changed.

The temporary Vercel automation bypass was revoked and verified unusable, local cookie/env/fixture secret files were removed, and the accidental empty CLI auto-link project was deleted. The protected deployment and synthetic database are retained only for a possible Phase B2 handoff; their application credentials are inactive. Storage is local ephemeral storage under the B1 namespace and all external providers remain disabled/mock.

## New non-P0 observation

`HARD-B1-001` (P2, Agent 4): the final 500-record runtime-log sample contained 30 Vercel `Task timed out after 300 seconds` records for `/api/sse`. The security/browser/API checks still passed and no secret or cross-tenant side effect was observed. The route intentionally holds an unbounded event stream, while the Preview runtime has a finite request duration. This P2 was recorded but not fixed under the explicit B1 scope.

Remaining confirmed P0s: **21** — P0-B: 15, P0-C: 5, P0-D: 1. They remain untouched; Phase B2 has not started.
