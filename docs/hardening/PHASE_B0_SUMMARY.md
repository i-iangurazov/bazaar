# Bazaar hardening Phase B0 summary

Date: 2026-07-22

Accepted integration baseline: `f308b2b793c2b43d7e46814c3c2007a0927fede7`

Scope: isolated test infrastructure, baseline stabilization, and independent runtime classification of the 46 Phase A P0 findings. No domain application fix was authorized or started.

## Isolated environment inventory

| Agent | Branch/worktree | PostgreSQL database | Redis | File/export namespace | Provider mode |
| --- | --- | --- | --- | --- | --- |
| Agent 1 — POS | `hardening/b0-agent-1-pos` / `/private/tmp/bazaar-b0-agent-1-pos` | `bazaar_hardening_agent1_pos` | logical DB `11`, identity `agent1-pos` | agent-specific local temporary namespace | KKM and external providers mocked |
| Agent 2 — Inventory | `hardening/b0-agent-2-inventory` / `/private/tmp/bazaar-b0-agent-2-inventory` | `bazaar_hardening_agent2_inventory` | logical DB `12`, identity `agent2-inventory` | agent-specific local temporary namespace | print/export providers mocked |
| Agent 3 — Commerce | `hardening/b0-agent-3-commerce` / `/private/tmp/bazaar-b0-agent-3-commerce` | `bazaar_hardening_agent3_commerce` | logical DB `13`, identity `agent3-commerce` | agent-specific local temporary namespace | marketplace, email, AI, and HTTP providers mocked |
| Agent 4 — Platform | `hardening/b0-agent-4-platform` / `/private/tmp/bazaar-b0-agent-4-platform` | `bazaar_hardening_agent4_platform` | logical DB `14`, identity `agent4-platform` | `/private/tmp/bazaar-hardening-agent4-storage` | email/jobs/providers local or mocked |

All four databases are positively identified local PostgreSQL databases. Each received all 87 checked-in migrations with `prisma migrate deploy`. `db push` was not used. No Production, Preview Production, real customer, marketplace, email, or fiscal-provider data was contacted.

Each worktree has an ignored `.env.hardening` containing its exact database identity, explicit destructive-test flags, isolated Redis identity, local storage namespace, and mocked provider configuration. Secrets are not committed.

## Destructive test-database guard

`tests/helpers/testDatabaseSafety.ts` is now the single precondition for migration, reset, or truncation in the Vitest harness. It requires all of the following before destructive SQL:

- `NODE_ENV=test`;
- `RUN_DB_TESTS=1`;
- `ALLOW_TEST_DB_RESET=1`;
- exact `EXPECTED_TEST_DB_NAME`;
- a mandatory `DATABASE_TEST_URL` whose parsed database matches that name;
- membership in the hardcoded hardening/CI database allowlist;
- the expected `bazaar_hardening_*` or explicit CI test-name pattern;
- a non-production host and non-production Vercel environment.

It rejects implicit fallback to `DATABASE_URL`, missing flags, mismatched names, unallowlisted names, production hosts, and an absent DB identity before the first destructive statement. CI now fails instead of silently skipping DB tests when the isolated identity is absent.

Evidence: 20 guard tests passed; a guarded migrate/reset proof passed against only `bazaar_hardening_agent4_platform`. Agent 1 cross-reviewed and approved Agent 4 commits `584c37d` and `d6079b7`.

## Baseline disposition and checks

The two accepted Phase A unit failures were stale source-string assertions, not application regressions:

- `HARD-A4-018`: the POS completion cleanup moved behind the existing completion handler. The test was updated to exercise the extracted handler (`8c4c671`).
- `HARD-A2-016`: the duplicate-product dialog moved into an extracted component. The test was updated to cover that component (`df814f8`).

Enabling the real DB gate also exposed a time-dependent email-marketing fixture: its fixed March 2026 timestamp was no longer newest on 2026-07-22. Production correctly orders by `createdAt DESC, id DESC`; the test fixture now uses a deterministic future instant (`4ff8332`). Agent 3 independently reviewed and approved this test-only correction.

| Gate | Result | Evidence |
| --- | --- | --- |
| Typecheck | PASS | `pnpm typecheck` |
| Lint | PASS | `pnpm lint` |
| i18n | PASS | `pnpm i18n:check` |
| Full unit/integration suite | PASS | 166 files, 884 tests, guarded single-worker run on Agent 4 DB |
| Production build | PASS | 81 static pages generated; only the existing Browserslist age warning |
| Whitespace | PASS | `git diff --check` |

The authoritative DB run was uncontended and completed in 130.66 seconds. An earlier otherwise-green run was deliberately not accepted as authoritative because another reviewer process briefly targeted Agent 4's DB; all agents were stopped and the entire suite was rerun alone.

## P0 classification

Every classification below is supported by a runtime API, DB, HTTP/SSE, rendered-component, mocked-side-effect, or executable guard result. Code inspection and source-string assertions were not accepted as classification evidence. Detailed before/after facts and test commands are in the linked agent reports.

| ID | Classification | Root cause group | Runtime evidence | Status |
| --- | --- | --- | --- | --- |
| HARD-A1-001 | CONFIRMED | RC-01 | Limited actor read inaccessible-store POS/receipt records | OPEN |
| HARD-A1-002 | CONFIRMED | RC-01 | Limited actor persisted cash/return/debt state in another store | OPEN |
| HARD-A1-003 | CONFIRMED | RC-02 | Disallowed register, close, and refund operations persisted by role | OPEN |
| HARD-A1-004 | CONFIRMED | RC-08 | A second cashier completed another cashier's active and held drafts | OPEN |
| HARD-A1-005 | CONFIRMED | RC-07 | Two sequentially completed stale return drafts refunded and restored the same quantity twice | OPEN |
| HARD-A1-006 | CONFIRMED | RC-08 | Shift closed with an active draft, leaving checkout blocked | OPEN |
| HARD-A1-007 | CONFIRMED | RC-08 | Active register with open operational state was deactivated | OPEN |
| HARD-A1-008 | CONFIRMED | RC-07 | Restricted sale paths persisted prohibited negative stock | OPEN |
| HARD-A1-009 | CONFIRMED | RC-09 | Concurrent retries invoked the mocked fiscal adapter twice | OPEN |
| HARD-A2-001 | CONFIRMED | RC-01 | Limited user accessed stock-count/lot state outside assigned stores | OPEN |
| HARD-A2-002 | CONFIRMED | RC-04 | Manager product/price mutations crossed source/target store scope | OPEN |
| HARD-A2-003 | CONFIRMED | RC-04 | Store-limited user read cost/pricing outside active assignments | OPEN |
| HARD-A2-004 | CONFIRMED | RC-02 | Manager created initial variant stock reserved for Admin | OPEN |
| HARD-A2-005 | CONFIRMED | RC-05 | Replayed create/import/price requests duplicated durable effects | OPEN |
| HARD-A2-006 | CONFIRMED | RC-05 | Retried scanner mutation incremented stock repeatedly | OPEN |
| HARD-A2-007 | CONFIRMED | RC-06 | Bulk stock correction committed a partial result | OPEN |
| HARD-A2-008 | CONFIRMED | RC-06 | Store-scoped category deletion removed wider preferences | OPEN |
| HARD-A2-009 | CONFIRMED | RC-01 | Limited actor obtained inaccessible-store print artifacts | OPEN |
| HARD-A2-010 | CONFIRMED | RC-03 | Export token resolved without binding to its authenticated owner | OPEN |
| HARD-A2-017 | CONFIRMED | RC-08 | Receiving draft state leaked between users in one browser profile | OPEN |
| HARD-A3-001 | CONFIRMED | RC-07 | API order stock changed `10 -> 9 -> 8` across create and complete | OPEN |
| HARD-A3-002 | CONFIRMED | RC-03 | Revoked warmed API credential continued authenticating | OPEN |
| HARD-A3-003 | CONFIRMED | RC-05 | Four equivalent no-`externalId` requests created four orders | OPEN |
| HARD-A3-004 | CONFIRMED | RC-05 | Replayed sales and PO creates produced duplicate documents/effects | OPEN |
| HARD-A3-005 | CONFIRMED | RC-10 | `EXT-1` collided with existing `EXT-10` by substring | OPEN |
| HARD-A3-006 | CONFIRMED | RC-01 | Store-limited manager read and mutated another store's customer | OPEN |
| HARD-A3-007 | CONFIRMED | RC-02 | Disallowed roles read suppliers/POs and canceled another-store PO | OPEN |
| HARD-A3-008 | CONFIRMED | RC-02 | Disallowed roles read integration data and wrote another-store selection | OPEN |
| HARD-A3-009 | CONFIRMED | RC-04 | Unassigned product completed as a sale and drove store stock negative | OPEN |
| HARD-A3-010 | CONFIRMED | RC-11 | Warm API cache served old price/stock after committed mutations | OPEN |
| HARD-A3-011 | CONFIRMED | RC-08 | Return-labelled UI created/completed an ordinary sale | OPEN |
| HARD-A3-012 | CONFIRMED | RC-06 | Bulk PO cancel settled one success and one failure irreversibly | OPEN |
| HARD-A3-021 | CONFIRMED | RC-05 | Same checkout key created two orders, events, and mocked emails | OPEN |
| HARD-A3-022 | CONFIRMED | RC-11 | Catalogue displayed 100 while checkout persisted price 120 | OPEN |
| HARD-A3-026 | CONFIRMED | RC-03 | Public proxy returned mocked loopback secret bytes | OPEN |
| HARD-A4-001 | CONFIRMED | RC-02 | Cashier/Staff called forbidden dashboard/analytics procedures | OPEN |
| HARD-A4-002 | CONFIRMED | RC-02 | Cashier read private billing request and review notes | OPEN |
| HARD-A4-003 | CONFIRMED | RC-02 | Cashier listed, read, and downloaded a sensitive export | OPEN |
| HARD-A4-004 | CONFIRMED | RC-02 | Cashier received a forbidden store result from server search | OPEN |
| HARD-A4-005 | CONFIRMED | RC-01 | Store-A Cashier received Store-B SSE event payload | OPEN |
| HARD-A4-006 | CONFIRMED | RC-01 | Store-limited Manager closed an inaccessible store period | OPEN |
| HARD-A4-007 | CONFIRMED | RC-12 | KGS total fields persisted quantities `2` and `5` instead of money | OPEN |
| HARD-A4-008 | CONFIRMED | RC-12 | 01:30 Bishkek sale was omitted under UTC server bounds | OPEN |
| HARD-A4-009 | CONFIRMED | RC-03 | Tenant Admin read and resolved a global null-org dead letter | OPEN |
| HARD-A4-010 | CONFIRMED | RC-13 | Prior inferred shared-reset path was established from the harness; the new guard's 20-case failure/success matrix is enforced | B0_RESOLVED |
| HARD-A4-011 | CONFIRMED | RC-02 | Cashier route guard allowed two forbidden settings routes | OPEN |

Totals: **46 CONFIRMED, 0 DUPLICATE, 0 DOWNGRADED, 0 FALSE_POSITIVE, 0 BLOCKED_BY_ENVIRONMENT**. `HARD-A4-010` is the sole P0 corrected during B0 because it is the approved infrastructure blocker; the other 45 remain open.

Detailed evidence:

- [Agent 1 POS verification](./B0_AGENT_1_P0_VERIFICATION.md): 9/9 focused tests passed; Agent 4 independently reran 9/9 on Agent 4's environment.
- [Agent 2 Inventory verification](./B0_AGENT_2_P0_VERIFICATION.md): 11/11 focused tests passed; Agent 4 independently reran 11/11.
- [Agent 3 Commerce verification](./B0_AGENT_3_P0_VERIFICATION.md): 17/17 focused tests passed; Agent 4 independently reran 17/17 with providers mocked.
- [Agent 4 Platform verification](./B0_AGENT_4_P0_VERIFICATION.md): 31/31 evidence/guard tests passed; Agent 1 cross-reviewed and approved Agent 4's evidence changes.

The focused evidence set contains 68 passing tests. These reproduce the accepted baseline's unsafe outcomes and must be inverted or paired with post-fix assertions during implementation.

## Consolidated root causes

Grouping identifies shared implementation seams; it does not erase distinct runtime contracts. No finding is classified `DUPLICATE` because each retains a separately verified authorization, stock, money, document, or side-effect acceptance case.

| Root Cause Group | Primary Issue | Duplicate Issues | Affected Routes | Owning Agent | Shared Files |
| --- | --- | --- | --- | --- | --- |
| RC-01 — effective-store authorization | HARD-A1-001 | None; related: A1-002, A2-001, A2-009, A3-006, A4-005, A4-006 | POS APIs/artifacts/SSE, inventory counts/lots/printing, customers, period close | Domain owners; Agent 4 coordinates | store-access and auth helpers, SSE |
| RC-02 — route/procedure policy parity | HARD-A4-001 | None; related: A1-003, A2-004, A3-007, A3-008, A4-002/003/004/011 | POS admin, initial stock, PO/suppliers, integrations, dashboard/analytics, billing, exports, search, settings | Agents 1–4 by route; Agent 4 coordinates | global RBAC, middleware, export auth |
| RC-03 — sensitive capability/secret boundary | HARD-A3-002 | None; related: A2-010, A3-026, A4-009 | API authentication, export download, image proxy, dead-letter jobs | Agents 2–4 | auth/cache helpers, provider/storage clients, job framework |
| RC-04 — product/store eligibility | HARD-A2-002 | None; related: A2-003, A3-009 | products, store prices, manual sales orders | Agent 2 primary; Agent 3 order validation | product assignment and store-access helpers |
| RC-05 — durable operation identity | HARD-A3-003 | None; related: A2-005/006, A3-004/021 | product/import/count mutations, API/internal/public order create, PO create | Agents 2 and 3 | idempotency service; possible Prisma migration |
| RC-06 — atomic destructive batch | HARD-A2-007 | None; related: A2-008, A3-012 | bulk inventory, category delete, bulk PO cancellation | Agents 2 and 3 | transaction helpers; audit history |
| RC-07 — stock transition invariant | HARD-A3-001 | None; related: A1-005/008 | API order completion, POS returns/sale completion | Agents 1 and 3; Agent 2 reviews | shared inventory mutation helpers |
| RC-08 — operational document lifecycle | HARD-A1-004 | None; related: A1-006/007, A2-017, A3-011 | POS drafts/shifts/registers, receiving drafts, sales return mode | Agents 1–3 | scoped client persistence; audit/actor attribution |
| RC-09 — external side-effect claim | HARD-A1-009 | None | POS fiscal retry/worker | Agent 1; Agent 4 job coordination | shared POS service and job framework |
| RC-10 — exact external identity | HARD-A3-005 | None | Bazaar API orders | Agent 3 | possible Prisma migration |
| RC-11 — product cache consistency | HARD-A3-010 | None; related: A3-022 | Bazaar API and public catalogue/checkout | Agent 3; Agent 2 mutation review | shared query/cache configuration |
| RC-12 — period money and business time | HARD-A4-007 | None; related: A4-008 | dashboard, reports, period close/export | Agent 4 | report/export contracts and time helpers |
| RC-13 — destructive test identity | HARD-A4-010 | None | test/CI infrastructure | Agent 4; Agent 1 reviewed | test harness, CI workflow |

## Proposed P0 execution batches

| Batch | Issues | Owners and coordination |
| --- | --- | --- |
| P0-A — Security and isolation | A1-001/002/003; A2-001/002/003/004/008/009/010; A3-002/006/007/008/009/026; A4-001/002/003/004/005/006/009/011 | Domain owner authors route behavior. Agent 4 serializes global RBAC/store-access/cache/job/helper files. Agent 4 independently verifies all domain commits; another domain agent cross-reviews Agent 4 commits. |
| P0-B — Stock and order correctness | A1-005/008; A2-005/006/007; A3-001/003/004/005/010/012/021/022; A4-007/008 | Agent 2 owns shared inventory semantics; Agents 1 and 3 author domain transitions. Agent 4 owns report/time corrections. Schema/idempotency work is serialized migration-by-migration. |
| P0-C — POS and money/document lifecycle | A1-004/006/007; A2-017; A3-011 | Agent 1 leads POS lifecycle; Agents 2 and 3 own their draft/return surfaces. Shared persistence or attribution helpers require Agent 4 coordination. |
| P0-D — External side effects | A1-009 | Agent 1 leads fiscal correctness; Agent 4 coordinates job claim/retry primitives and Agent 3 reviews provider lifecycle conventions. Verified stuck marketplace/job findings are P1 and do not get promoted without evidence. |
| B0 infrastructure — complete | A4-010 | Agent 4 authored; Agent 1 approved; integrate before any domain DB-backed implementation. |

Batch order is P0-A, P0-B, P0-C, then P0-D. Within a batch, issues in one root-cause group should receive one minimal implementation seam plus all distinct acceptance tests, not separate symptom patches.

## Shared-file conflict plan

1. Agent 4 maintains the lock record in `SHARED_FILE_OWNERSHIP.md`; a claim names exact files, issues, start SHA, reviewers, and tests before editing.
2. Global RBAC/store access is one serialized P0-A stream. Domain owners submit policy and acceptance tests; Agent 4 coordinates the shared helper change.
3. Inventory transition helpers are locked to Agent 2 during P0-B. Agent 1/3 changes call the reviewed invariant rather than editing it concurrently.
4. Prisma migrations are queued and rebased one at a time. No `db push`; every migration includes deploy and rollback notes.
5. Idempotency, query/cache, job, provider, translation, dependency, and UI-primitive files each have one active owner. Cross-domain requirements are passed to that owner as tests or review notes.
6. Agent 4 does not silently repair domain business logic. Agent 4-authored changes require an Agent 1–3 approval before selective cherry-pick to `hardening/integration`.

## Preview and release readiness

| Gate | State |
| --- | --- |
| Local isolated DB/Redis environments | READY |
| Guarded DB-backed execution | READY |
| Baseline type/lint/i18n/test/build/diff | PASS |
| External provider automation | READY via mocks; live-provider testing not authorized |
| Browser/responsive/theme matrix | NOT_RUN in B0; required for each post-fix acceptance batch |
| Performance budgets | NOT_RUN in B0; measure warmed Preview after fixes |
| Integration Preview deployment | NOT_DEPLOYED; deploy after the first selectively integrated P0 batch |
| Preview/Production data access | NOT_USED |
| Production rollout | NOT_AUTHORIZED |

Phase B0 is an infrastructure and verification gate, not a release gate. The repository is ready for isolated P0 implementation after the approved B0 commits are selectively integrated. No application source, schema, migration, global UI, or domain business behavior was changed; only the destructive-test safety policy and three baseline test corrections were made.
