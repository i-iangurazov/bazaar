# Second-ad Meta identifiers — 14 November 2026

## Confirmed request and defect

Native Vercel request logs showed an Instagram iOS arrival at
`https://www.bazaar.kg/ru` with these exact labels:

```text
utm_source=instagram
utm_medium=paid_social
utm_campaign=kg_store_launch_202611
utm_content=ad02_ru
utm_id=52574017478097
utm_term=52574017478697
fbclid present (raw value not recorded here)
```

The two HTTP 200 GET records at 14 November 01:57:00.918 and .926 Bishkek
shared the same click ID: one clicked arrival, not evidence of two visitors.
Root saved sanitized `server-landing-evidence.json`. These requests establish
the automatic parameters of this advertisement; they were not inferred from
the first advertisement.

Before the change, an isolated JSDOM reproduction of this URL with a synthetic
bounded click ID returned `safeMetaContext=false`, no SDK script after explicit
Meta consent, empty GA4 campaign overrides, and valid first-party attribution.
It loaded no real SDK and made no network requests.

## Narrow change

Add only the observed campaign ID `52574017478097` and ad-set ID
`52574017478697` as a complete pair bound to
`instagram / paid_social / kg_store_launch_202611 / ad02_ru`. The ad's own ID
`52574017479297` is not accepted in either field. The existing first-ad pair,
bare four-label URLs, consent, public-anchor, origin, referrer, unknown-query
and privacy guards are unchanged.

GA4 receives only the controlled registry fields, including `campaign_id` and
`campaign_term`; raw click IDs/fragments are not included in its public context.
The existing first-touch cookie retains the campaign labels/ad-set term and
drops `utm_id`/`fbclid`. No server/database, advertisement or budget changes.

## Verification

Node 22.23.4, sequential checks, one test worker:

```text
SKIP_DB_TESTS=1 RUN_DB_TESTS=0 pnpm exec vitest run tests/unit/meta-marketing.test.ts tests/unit/marketing-campaigns.test.ts tests/unit/marketing-analytics.test.ts tests/unit/acquisition.test.ts tests/unit/marketing-analytics-consent.test.tsx tests/unit/signup-page.test.tsx --maxWorkers=1
6 files / 316 tests passed, 2.93 seconds
pnpm exec tsc --noEmit          passed
pnpm exec next lint             passed, no warnings/errors
pnpm i18n:check                 passed
pnpm exec next build --no-lint  passed, 129/129 static pages
git diff --check                passed
```

Tests cover both observed advertisements with/without bounded click IDs and
public anchors, no SDK before permission, manual landing/signup PageViews, one
mock new-account event, full signup referrers, exact GA4 fields, first-touch
retention, and missing/wrong/mixed/duplicate identifiers. Independent focused
review approved the source/test diff without blockers.

The local production build used synthetic localhost-only configuration, no
`.env`/deployment lifecycle, one Next/Rust/UV worker and a 3 GB Node heap. Log:
`/private/tmp/bazaar-second-meta-identifiers-build-20261114.log`. No database,
provider, real registration or production conversion event was used. SDK mocks
are not receipt evidence; root performs the separately authorized release and
postrelease native verification. This preparation performs no push/deploy.

## Before another advertisement

Verify the complete final Meta URL, including its campaign/ad-set IDs; checking
only the four custom UTM fields is insufficient. Register each exact approved
combination before launch. Keep the raw click ID out of saved evidence.
Postrelease QA verifies new requests and does not replay historical PageViews
or create replacement conversions for previously blocked events.
