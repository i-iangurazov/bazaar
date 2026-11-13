# Meta landing identifiers — 13 November 2026

## Demonstrated defect

The current Instagram advertisement reaches `/ru` with the reviewed labels
`instagram / paid_social / bishkek_take6 / take6_landing`. Meta also appends
`utm_id=52573740529697` and `utm_term=52573740529897` (campaign and ad-set IDs).
The investigation confirmed a successful real Instagram in-app-browser request
at `2026-11-13T01:51:54.960Z` with these labels and `https://instagram.com/` as
referrer. A separate production reproduction confirmed that granting Meta
measurement permission on this URL did not insert the SDK script; the reviewed
four-label URL loaded it.

The URL guard rejected the unknown `utm_id`, and the controlled campaign registry
did not match the numeric `utm_term`. Consequently, Meta measurement was blocked
even after consent and GA4 lost the controlled campaign overrides. This explains
a demonstrated measurement failure; it does not prove that every outbound click
loaded the site or that any registration occurred.

## Narrow change

- Register only that exact campaign/ad-set pair together, bound to the current
  source, medium, campaign name and `take6_landing` content.
- Keep the existing four-label URLs, organic links and Search groups valid.
- Export the reviewed pair as GA4 `campaign_id` and `campaign_term`, using only
  registry constants. Google documents both fields in its
  [GA4 configuration reference](https://developers.google.com/analytics/devguides/collection/ga4/reference/config).
- Continue rejecting unknown, malformed, incomplete or duplicate identifiers,
  mismatched campaigns/creatives, private routes, and arbitrary URL parameters.
  `nxtPlocale` observed in server logs is not added to the browser allowlist.
- Preserve separate Meta consent, DNT/GPC, native-app exclusion and the fresh
  document boundary around private onboarding.

First-party attribution and its 30-day first-touch cookie are unchanged. They
already retain the numeric campaign term while dropping `utm_id` and `fbclid`.
`CompleteRegistration` still means a newly created account, with the existing
`accountCreated` gate and per-document deduplication. No server/database business
flow, migration, landing layout, user-facing text or advertising setting changes.

## Verification

Node `22.23.4`, one test worker, `SKIP_DB_TESTS=1 RUN_DB_TESTS=0`:

```text
pnpm exec vitest run tests/unit/meta-marketing.test.ts tests/unit/marketing-campaigns.test.ts tests/unit/marketing-analytics.test.ts tests/unit/acquisition.test.ts tests/unit/marketing-analytics-consent.test.tsx tests/unit/signup-page.test.tsx --maxWorkers=1
6 files, 201 tests passed (2.22 seconds)

pnpm exec tsc --noEmit       passed
pnpm exec next lint          passed, no warnings/errors
pnpm i18n:check              passed
pnpm exec next build --no-lint   passed, 129/129 static pages
git diff --check             passed
```

The production build used only synthetic localhost configuration, no `.env`
files, and bypassed the deployment/prebuild lifecycle. `CIRCLE_NODE_TOTAL=2`
sets Next's default CPU worker count to one; Rust/UV threads were also limited
to one. The operating system declined `nice`, so lower scheduling priority was
not applied. No database server or provider request was needed for these tests.
The local build log is `/private/tmp/bazaar-meta-url-fix-build-20261113.log`.

Regressions cover the observed URL with and without a bounded `fbclid`, no SDK
before consent, one landing PageView, one signup PageView, one new-account event,
the complete production landing URL as a fresh `/signup` document's same-origin
referrer, sanitized GA4 overrides, first-touch retention, and privacy negatives.
An independent focused source/test review found no blocking issues.

These tests mock the SDK and do not prove receipt by Meta. The production build
is local verification, not a deployment. After the separately approved release,
verify the real public landing and native Meta event processing. Previously
blocked views cannot be reconstructed as historical Pixel events.
