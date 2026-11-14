# Meta measurement on public landing anchors — 14 November 2026

## Demonstrated defect and boundary

The real landing's secondary hero action links to `#platform`. Desktop/mobile
navigation and the footer also link to `#pos`, `#inventory`, `#commerce`,
`#analytics`, `#mobile` and `#pricing`. Previously `safePublicUrl` rejected every
URL fragment, including these public links.

An isolated JSDOM reproduction used the reviewed first-ad six-UTM URL and an
Instagram origin referrer. It confirmed `safeMetaContext() === true` before the
fragment, then `false` after `#platform`. A subsequent measurement sync revoked
the mocked pixel and required a fresh document before signup measurement. No
real SDK, network request or production account was involved.

The direct affected journey is landing → public anchor → grant consent: the
anchor prevented SDK loading despite permission. A public anchor opened while
the SDK was loading could also prevent the initial manual PageView. Hash changes
alone do not invoke this application's synchronization callback, so this is not
evidence that every anchor click after an already-sent PageView lost an event.
The impact on the historical 26 clicks versus one measured landing view cannot
be quantified from the source or these tests; visitor consent choices are unknown.

## Minimal change

Allow only the seven exact, case-sensitive linked fragments, and only on the
existing landing paths `/`, `/ru`, `/kg`, `/en`. Keep rejecting arbitrary,
encoded, extended or non-landing fragments, including fragments on `/signup`,
`/privacy` and private application paths. Known fragment names do not bypass
the existing UTM/click-ID, origin, referrer, consent or native-app checks.

The allowlist is initialized before the module's initial `unsafeDocument` check
so a valid direct landing deep link is safe on its first evaluation.

Public anchor navigation does not add another PageView for the same pathname.
Signup still receives its own PageView; CompleteRegistration remains gated by
the existing successful `accountCreated:true` response, public signup context,
Meta consent and per-document deduplication. Unknown-fragment withdrawal still
requires a fresh document. No advertising configuration, server/database flow,
consent storage, landing appearance or user-facing string changes.

## Verification

All checks used Node `22.23.4` and ran sequentially:

```text
SKIP_DB_TESTS=1 RUN_DB_TESTS=0 pnpm exec vitest run tests/unit/meta-marketing.test.ts tests/unit/marketing-analytics-consent.test.tsx tests/unit/signup-page.test.tsx tests/unit/acquisition.test.ts tests/unit/marketing-campaigns.test.ts --maxWorkers=1
5 files / 223 tests passed, 2.75 seconds

pnpm exec tsc --noEmit         passed
pnpm exec next lint            passed, no warnings/errors
pnpm i18n:check                passed
pnpm exec next build --no-lint passed, 129/129 static pages
git diff --check               passed
```

Regressions include all seven anchors on four landing locales, the hero anchor
before permission, an anchor during SDK loading, a consented anchor followed by
signup and one mock account event, fresh signup referrers, unknown/private and
encoded fragments, unsafe query fields, DNT/GPC, and the existing SDK failure
and registration-resume protections.

The local production build used one Next worker (`CIRCLE_NODE_TOTAL=2`), one
Rust/UV thread, a 3 GB Node heap and synthetic localhost-only configuration.
No `.env` files or deployment/prebuild lifecycle were used. It emitted a
non-fatal next-intl/webpack dynamic-import cache warning. Log:
`/private/tmp/bazaar-meta-anchor-fix-build-20261114.log`.

Independent focused review of the source/test diff approved it without blockers.

The tests mock SDK calls and do not prove receipt by Meta. No database resets,
migrations, fake production registrations or live conversion events were used.
Deployment, CI/domain verification and real postrelease PageView checks belong
to the separately authorized root release procedure. No push or deployment is
performed by this patch preparation.
