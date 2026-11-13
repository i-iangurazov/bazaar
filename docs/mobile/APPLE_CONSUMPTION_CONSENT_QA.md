# Apple refund information consent UI

Checkpoint: 2026-11-13. Policy version: `2026-11-13-v1`.

The purchase history has a separate, optional consent for a particular Apple
transaction. Both factual answers require an explicit selection, including an
explicit unknown answer. The consent checkbox starts unchecked on every opening.
An unknown answer can be saved but is shown as incomplete, without permission to
send information. No saved state is inferred from a local checkbox or an
unconfirmed mutation.

Granting or changing answers requires the original purchaser's current ADMIN
access to the same organization. Other purchasers' panels are hidden. Cached
results for another viewer or organization do not reveal answers or dates.
The personal privacy section can revoke the buyer's own consent after a role or
organization change without opening the billing catalog or financial history.
Refund requests and purchased access remain independent from consent, including
while a consent mutation is pending or has failed.

Privacy disclosures in Russian, Kyrgyz and English describe the limited Apple
response, unknown answers, the required undelivered classification of 0%, neutral
refund preference and the effect of withdrawal. Withdrawal cannot erase a response
already received by Apple. The backend rechecks eligibility before further sends.

## Verification completed

The isolated UI runner scrubbed provider credentials and used
`RUN_DB_TESTS=0`, `SKIP_DB_TESTS=1`, `ALLOW_TEST_DB_RESET=0`:

```sh
node .local/ios-release-20261111/run-ui-check.mjs test \
  tests/unit/apple-consumption-consent-ui.test.tsx \
  tests/unit/apple-payments-ui.test.tsx \
  tests/unit/privacy-billing-disclosures.test.tsx --maxWorkers=1
```

Result: 70 tests passed: 17 consent UI, 50 checkout/recovery and 3 public privacy
disclosures. Existing temporary-upgrade cases emit React `act` warnings.

A separate offline fixture bundled the actual new components with application
CSS, synthetic session/RPC responses and no HTTP server. One headless Chrome
instance at a time checked Russian, Kyrgyz and English at 1280×900, 390×844 and
844×390. Result: 27 checks passed, zero network requests, zero page errors; the
browser closed in `finally`. Checks covered dialog bounds, horizontal overflow,
action labels, keyboard select focus, unknown answers, decline, retryable errors,
pending confirmation, withdrawal, personal STAFF withdrawal, non-buyer privacy,
loading and query recovery. Screenshots were inspected for desktop, portrait and
landscape states.

Private fixture and evidence:
`.local/ios-release-20261111/apple-consumption-ui-qa/`.
Initial missing Playwright-browser and immediate-focus/fixture-refresh assertion
failures remain recorded separately. Final `report.json` reports `PASS`.

## Verification boundaries

These are browser UI checks with in-memory responses, not a real Apple purchase,
sender delivery proof, WebKit test or physical iPhone acceptance. Backend database
and sender checks are recorded separately. Type checking, lint, translation
validation and a production build must be run on the integrated backend and UI
checkpoint. This change does not enable reporting, sales, prices or availability.
