# Bazaar production-readiness decisions

This log records decisions that affect implementation, evidence, or reporting. It does not change the original audit formula.

## D-001 — Official score remains the original audit score

Status: accepted

The official metric uses the eight fixed category weights, per-row risk 1/3/5, PASS=1, PARTIAL=0.5, FAIL/BLOCKED=0, and justified N/A exclusion. Scores use full internal precision and one-decimal display rounding. The unresolved-defect caps and verdict gates are applied exactly as specified in the audit prompt.

Application-owned readiness is a secondary, uncapped engineering metric using the same category formula on rows explicitly reviewed as application-owned. It never replaces the official score and does not remove external blockers from official readiness.

## D-002 — Stable requirement identity

Status: accepted

The frozen CSV did not contain IDs. The importer assigns `BZR-REQ-0001`–`BZR-REQ-0230` once in immutable source order. Every row stores the original CSV line and SHA-256 fingerprint of category, requirement, and risk. The calculator rejects identity or baseline drift.

## D-003 — Evidence is required for every status change

Status: accepted

Baseline fields are immutable. A changed current status requires a history record, new current evidence, an updated timestamp, and execution evidence for PASS/PARTIAL/FAIL. BLOCKED must remain unexecuted. Defects are resolved only through the authoritative unique defect registry, never by counting requirement references.

## D-004 — External dependencies are not N/A

Status: accepted

Fiscal/KKM, live email, live integration, and billing sandbox requirements remain BLOCKED in the official denominator until verified. N/A is permitted only when the feature is genuinely absent or out of scope and the row contains written justification.

## D-005 — Test data and destructive safety

Status: accepted

Database suites use only an explicitly named, allowlisted, isolated test database. The baseline used a temporary PostgreSQL cluster and `bazaar_hardening_ci`. Production and ordinary development databases must never be reset. Browser records use `QA-BAZAAR-*` prefixes. No real external side effect is authorized.

## D-006 — Build environment classification

Status: accepted

A build rejected by the repository’s environment preflight is recorded as a configuration failure. A second run with a non-secret conforming ephemeral value establishes compiler/bundler health but does not erase the default-environment failure.

## D-007 — Deterministic and service-enabled test lanes

Status: accepted

The default integration lane explicitly clears ambient Redis and external-provider credentials/endpoints, selects log/local/mock/disabled providers, and rejects unmocked external fetches. Database reset safety is evaluated before runtime sanitization and remains mandatory. Redis behavior is verified only in a database-free opt-in contract lane with an exact `bazaar:test:<unique-run-id>:` key prefix, local or explicitly allowlisted non-production host, and exact-key cleanup. Provider contracts use a separate database-free opt-in lane that preserves only the selected provider, requires an explicit sandbox acknowledgement plus sandbox-host allowlist, and otherwise fails closed. Ambient `.env` services may not silently change test results.

## D-008 — Weighted-cost persistence and rounding

Status: proposed for Milestone 1 implementation

Persist precise inventory cost-basis value separately from the two-decimal displayed average. Use decimal arithmetic throughout accounting. Round receipt line money at its document boundary, retain sufficient precision for accumulated basis value, and round the exposed weighted average to two decimals with `ROUND_HALF_UP`. Never reconstruct precise historical value from an already rounded average when precise value is available.

This becomes accepted only after migration design and the required lifecycle tests prove it.

## D-009 — Positive unpriced inventory

Status: pending product/accounting confirmation

Proposed safe default: an adjustment or count increase with no explicit unit cost inherits the current product/variant weighted average. If no cost basis exists, it remains explicitly unvalued/zero-valued and must be visible to reconciliation rather than silently treated as a valued receipt. Initial stock paired with an entered cost is valued at quantity × entered cost.

## D-010 — Negative inventory crossing zero

Status: accepted conservative accounting policy

Negative inventory remains available only for explicitly unvalued, non-financial movement streams. A product/variant with no `ProductCost` row and no movement cost fields may be depleted below zero when store policy allows it; those movements retain null unit cost and null inventory-value delta and remain visible to reconciliation as unvalued history.

A financially tracked product/variant cannot be depleted below zero. A valued receipt, return, transfer-in, adjustment, count correction, manual basis change, or value-only movement also cannot be posted while any store position in that scope is already negative, even if the operation would return the quantity to zero or positive. The application rejects these boundaries atomically with `valuedNegativeStockDepletionBlocked` or `valuedNegativeStockRecoveryBlocked`; it does not invent a cost, retroactively rewrite COGS, or partially update quantity, cost basis, idempotency, or audit data. Operators must first reconcile the negative unvalued history through a reviewed correction. The invariant is enforced by the common stock-movement writer and the organization-wide cost-basis helpers, covering sales/orders, write-offs, adjustments, counts, transfers, receipts, imports, bundles, and returns.

## D-011 — Retroactive receipt edits after downstream consumption

Status: accepted conservative accounting policy

A stock-receiving document may be edited or archived only while it is the latest movement-ledger event for every affected product/variant. The affected set includes all existing document lines and every line requested by an edit. Once any other receipt, sale, return, write-off, adjustment, stock count, transfer, import, archive marker, or other stock/value movement exists at or after the document boundary for one of those exact scopes, the historical document is immutable and the application returns `stockReceivingEditLockedAfterDownstreamMovement`.

The check and every stock writer serialize on the affected product rows, so a concurrent downstream operation cannot race past it. Manual or imported basis changes after a receipt write an explicit zero-quantity `PRODUCT_COST_REVALUATION` journal marker, making later valuation order detectable without inventing a store-level value delta. A rejected edit is transactionally side-effect free, including audit and idempotency records. Same-document corrections remain editable and idempotently replayable until the first downstream event. After lockout, operators must post a new compensating document; ambiguous history is never silently replayed or automatically revalued.

## D-012 — Interaction-freeze remediation

Status: accepted technical direction for Milestone 4

Fix the duplicated Radix interaction stack and menu/dialog choreography at the cause. Do not add an unconditional `document.body.style.pointerEvents = ""` route cleanup, because that can unlock a legitimately open modal and hide the dependency defect.
