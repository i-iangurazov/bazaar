# Pre-runtime readiness reconciliation — 2026-08-31

Status: **PRE-RUNTIME DRAFT / DO NOT APPLY / NO SCORE CHANGE**

The machine-readable ledger is
`docs/production-readiness/evidence/pre-runtime-reconciliation-ledger-2026-08-31.json`.
It is generated and checked by
`scripts/production-readiness/build-preruntime-reconciliation.mjs`.

This draft does not mutate `readiness-current.json`, the frozen defect register, or any readiness
score. It separates test/source discovery from completed evidence: a row marked “candidate PASS”
still remains at its live status until every named gate runs successfully against the final source
cutoff and proves the row's exact wording.

## Mechanical accounting

| Bucket                                      |   Count |
| ------------------------------------------- | ------: |
| Existing live PASS, retained for recheck    |      54 |
| Conditional PASS candidates, runtime-gated  |     150 |
| Deliberately held at PARTIAL                |      16 |
| Legal/external/manual/native boundary rows  |      10 |
| **Requirements accounted for exactly once** | **230** |
| Defects with exact closure gates            |      26 |

The ledger pins SHA-256 snapshots for the source tracker, defect register, exact route matrix,
canonical route matrix, and workflow matrix. Validation also checks every requirement fingerprint,
every referenced gate, and every referenced repository evidence file.

## Rows deliberately held below PASS

- `BZR-REQ-0009`: route matrices and form tests do not cover every safe loading, empty, success,
  validation, permission, and error family across applicable workflows.
- `BZR-REQ-0017`: every Guide article still needs step-by-step parity against the final live UI and
  every applicable role.
- `BZR-REQ-0039`: database creation plus browser validation/edit does not yet prove a full browser
  create-and-inspect customer lifecycle.
- `BZR-REQ-0048`: KKM still needs a dependency-specific ADMIN browser assertion at 1440, 1024, and
  390 that identifies expected states/actions and proves there is no unexplained 403.
- `BZR-REQ-0054`: important invalid, past, and future date boundaries are not systematically
  covered across date-bearing forms.
- `BZR-REQ-0055`: product-image validation does not cover rejected type/size behavior for every
  upload/import control.
- `BZR-REQ-0072`: a rendered sales-order add-line, remove-line, and re-total lifecycle is missing.
- `BZR-REQ-0131`: modal dirty-close coverage does not prove navigation-away, refresh, and
  browser-close preservation/warning across important forms.
- `BZR-REQ-0136`: containment automation does not replace a complete cross-route alignment and
  spacing review at every audited viewport.
- `BZR-REQ-0139`: the application-wide button label, disabled-state, and resulting-action inventory
  is incomplete.
- `BZR-REQ-0140`: all destructive actions have not been inventoried and checked for appropriate
  confirmation/warning behavior.
- `BZR-REQ-0141`: the application-wide notification/toast audit for clarity, conflicts,
  duplication, and timing is incomplete.
- `BZR-REQ-0142`: every important empty state has not been checked for an actionable next step.
- `BZR-REQ-0159`: desktop order acceptance plus responsive route smoke does not prove a real
  mobile order lookup/create/edit/status lifecycle.
- `BZR-REQ-0163`: the full responsive tables/dropdowns/dates/scanners/print/long-label action
  matrix is incomplete.
- `BZR-REQ-0205`: key parity and one complete localized workspace do not prove that every rendered
  screen is free of untranslated or mixed-language copy.

## Non-local boundaries

- `BZR-REQ-0014`: counsel-approved operational legal facts (`PUBLIC-002`).
- `BZR-REQ-0083`: authorized fiscal/KKM sandbox and tax/receipt target.
- `BZR-REQ-0118`: real provider/inbox email-delivery evidence.
- `BZR-REQ-0180`: authorized live-integration sandbox.
- `BZR-REQ-0182`: authorized billing sandbox/payment/webhook evidence.
- `BZR-REQ-0196`: automation can measure contrast, but the required recorded manual review is
  absent (`PUBLIC-008`).
- `BZR-REQ-0199`: recorded 200% zoom/narrow-viewport review.
- `BZR-REQ-0200`: formal recorded screen-reader workflow session.
- `BZR-REQ-0226` and `BZR-REQ-0227`: production Apple/Android release identities and physical
  device association proof (`PUBLIC-009`).

Product decision `D-009` is a separate gate for full cost/report certification: automation follows
the proposed conservative policy for positive unpriced adjustments, but product/accounting approval
must not be inferred. `PUBLIC-015` additionally requires final-build mobile-throttled and field Web
Vitals evidence; a byte-budget script alone is not its full closure proof.

## Defect closure state

- Pending final runtime (17): `PUBLIC-001`, `REPORTS-001`, `PUBLIC-003`, `PUBLIC-004`,
  `PUBLIC-005`, `PUBLIC-006`, `PUBLIC-007`, `PUBLIC-010`, `LAYOUT-001`, `INVENTORY-001`,
  `LAYOUT-002`, `ORDERS-001`, `ORDERS-002`, `DYNAMIC-001`, `COMPAT-001`, `PUBLIC-013`, and
  `AUTH-A11Y-001`.
- Pending final source freeze (2): `PUBLIC-012` and `PUBLIC-014`.
- Pending runtime plus role/UI parity review: `PUBLIC-011`.
- Pending runtime plus product decision `D-009`: `BZR-PRD-001`.
- Missing a targeted KKM runtime case: `KKM-002`.
- Pending final build, throttling, and field evidence: `PUBLIC-015`.
- Blocked by legal/manual/native proof: `PUBLIC-002`, `PUBLIC-008`, and `PUBLIC-009`.

The JSON ledger records the full frozen acceptance wording and exact closure gate for each of all 26
defects; this summary intentionally does not abbreviate those machine-readable gates into a status
change.

## Supporting-metrics patch contract

The eventual updater manifest must use the exact `update-readiness.mjs` shape:

```text
supportingMetrics: {
  value: {
    routes: {
      exact:     { PASS, PARTIAL, FAIL, BLOCKED, total: 132 },
      canonical: { PASS, PARTIAL, FAIL, BLOCKED, total: 116 }
    },
    workflows: {
      total,
      executed,                 // exactly PASS + PARTIAL + FAIL
      outcomes: { PASS, PARTIAL, FAIL, BLOCKED }
    },
    roles: {
      credentialed,
      expected,
      credentialedRoleNames,
      blockedRoleNames,
      lowerRoleBoundaryAssertions: { passed, total },
      crossTenantIsolationVerified
    },
    responsive: {
      desktopExactForms: { executed, total: 132 },
      tabletExactForms:  { executed, total: 132 },
      mobileExactForms:  { executed, total: 132 },
      publicViewportChecks: { executed, total },
      adminViewportChecks:  { executed, total }
    },
    localization: {
      supportedLocales,
      compatibilityPrefixes,
      representativePrefixAssertions: { passed, total },
      fullRouteLocaleCrossProductVerified
    }
  },
  evidence: [typed file and command evidence]
}
```

The frozen exact/canonical denominators come from:

- `tmp/bazaar-audit-final-2026-08-31/route-matrix-exact-132.csv`
- `tmp/bazaar-audit-final-2026-08-31/route-matrix-canonical-116.csv`
- `tmp/bazaar-audit-final-2026-08-31/workflow-matrix.csv` (85 workflows)

Final metric outcome counts must be recomputed row by row after runtime. Collected test counts,
current inventory size, or candidate counts must not be substituted for the frozen matrices. Typed
evidence must include the frozen matrix files and final command entries with exact commands, exit
codes, and passed/failed counts.

## Validation

Run:

```bash
node scripts/production-readiness/build-preruntime-reconciliation.mjs
```

Expected result:

```text
Validated PRE-RUNTIME draft: 230/230 requirements, 26/26 defects, 132 exact routes, 116 canonical routes, 85 workflows; no score or official mutation
```

Use `--write` only to regenerate this draft ledger after reviewing source/test changes. It still
does not create or apply a readiness updater manifest.
