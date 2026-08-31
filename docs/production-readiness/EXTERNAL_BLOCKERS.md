# Bazaar external blockers and product decisions

External blockers remain BLOCKED with value zero in the official score. They are never converted to N/A to improve readiness.

## Authorized sandbox dependencies

| Requirement    | Dependency                                                           | Needed evidence                                                                                              | Pilot impact                                                 |
| -------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `BZR-REQ-0083` | Non-production fiscal/KKM connector, tax fixture, and receipt target | Pairing, transmission, retry, tax, receipt, reconciliation, and failure recovery without a real fiscal event | Blocks any fiscal pilot and full verification                |
| `BZR-REQ-0118` | Authorized email sender sandbox and test inbox                       | Signup/reset delivery, token lifecycle, redaction, retry, duplicate prevention, and inbox receipt            | Blocks production account lifecycle and full verification    |
| `BZR-REQ-0180` | Provider sandbox credentials and non-production integration target   | Connect, validate, sync, disconnect, retry, audit, masking, and tenant isolation                             | Blocks integration-enabled pilots and full verification      |
| `BZR-REQ-0182` | Billing-provider sandbox and non-production payment method           | Upgrade/change/cancel, idempotency, webhook/retry, authorization, and reconciliation                         | Blocks paid-plan mutation verification and full verification |

Application-owned mocks and contract tests should still be completed before these dependencies arrive. External access is required for final provider-boundary proof, not for postponing internal correctness.

## Deployment-operator actions

| Action                               | Owner               | Required evidence before release                                                                                                                        | Current boundary                                                                                             |
| ------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Rotate any live/demo-seeded accounts | Deployment operator | Confirm every previously distributed or repository-derived credential is revoked, replace it with a unique managed secret, and record a redacted audit  | This audit does not modify `.env`, rotate live accounts, reveal credentials, or perform production DB writes |
| Verify production secret segregation | Deployment operator | Confirm local seed variables and the seed opt-in flag are absent from every deployed environment and that platform-owner access uses managed identities | Application seed code now fails closed outside explicit local/test use; environment verification is external |

These are required operator controls, not reasons to weaken the application checks or award readiness credit without evidence.

## Product/legal decisions

| Item                          | Decision required                                                                                                                                | Current safe behavior                                                                                         | Pilot impact                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `PUBLIC-002`                  | Counsel-approved controller/operator identity, privacy contact, retention/deletion, rights, complaint process, effective date, and locale parity | Keep existing copy; do not invent legal statements                                                            | Blocks compliant paying-client onboarding                                  |
| Negative inventory valuation  | Resolved by D-010: negative stock is unvalued-only; financially valued depletion/recovery at a negative boundary fails closed                    | Preserve explicit unvalued negative movements; require reviewed reconciliation before valued activity resumes | No remaining policy blocker; implementation evidence is still required     |
| Unpriced positive adjustments | Decide whether to inherit WAC, require explicit cost, or record an unvalued state                                                                | Proposed: inherit existing WAC; otherwise explicitly unvalued                                                 | Blocks complete valuation certification for those adjustments              |
| Retroactive receipt edits     | Resolved by D-011: lock edit/archive after the first later movement in an affected product/variant stream and require compensation               | Allow same-document correction only before downstream movement                                                | No remaining policy blocker; implementation evidence is still required     |
| Native association resources  | Supply production Apple/Android application identifiers and signing associations                                                                 | Resources remain syntactically valid but empty                                                                | Blocks verified universal/app-link association, not internal web pilot use |

## Environment limitations that do not currently block implementation

- Docker Desktop was unavailable, but a temporary isolated PostgreSQL 16 cluster provided a safe database test lane.
- The existing browser E2E runner is missing from project dependencies/configuration. This is an application-owned repository gap and must be fixed; it is not an external blocker.
- Local `.env` lacks a conforming `CRON_SECRET` for the default build. The build preflight correctly rejects it; a controlled ephemeral conforming value proved the application bundles successfully. Production runtime secrets still require deployment-operator verification before release.
- Redis was not running during the first full integration baseline. Deterministic provider/Redis sanitization and the isolated, run-prefixed Redis contract lane are implemented; the full allowlisted database rerun and an authorized disposable Redis target remain execution evidence, not application-code blockers.

## Authority boundary

No deployment, production data mutation, live communication, real payment, fiscal submission, billing change, public catalog publication, or live integration connection is authorized by this readiness effort. If final proof needs one of those actions, obtain explicit user approval and a safe non-production target first.
