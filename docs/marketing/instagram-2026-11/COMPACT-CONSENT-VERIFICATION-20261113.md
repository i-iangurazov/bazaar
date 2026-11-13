# Compact public-site consent panel — 13 November 2026

Status: implemented locally on `main`; awaiting the human’s separate production release approval. No push or production deployment performed. Base: `63480186ad03e7c9eec31842d492265335ec8616`.

The old multi-section prompt covered the mobile landing. Approved variant B is a nonmodal bottom panel with short provider/purpose text, equally visible Accept all and Reject all controls, Customize, and an accessible close button. The panel does not dim or lock the landing. Details and three draft switches appear only in a requested settings dialog.

## Behavior

- Close/Escape dismiss without granting, denying, persisting or refreshing consent. Settings can be reopened.
- Accept/Reject apply only to configured providers. Combined writes finish before either provider is synchronized.
- Google statistics, Google advertising and Meta remain separate choices; Google advertising requires Google statistics. Existing grants are not expanded automatically.
- Save writes changed choices only; Cancel, close, Escape and following the privacy link discard drafts. Unrelated storage updates preserve unsaved switches; actual consent updates and BFCache restoration reconcile them.
- Existing DNT/GPC, public-route boundaries, expiry, legacy statistics-only grants and Meta withdrawal safeguards are retained. SDK/provider code is unchanged.
- The settings dialog traps/restores focus. A measured bottom spacer lets the last page content scroll above the panel and disappears with it.
- Short mobile viewports use compact hero spacing and a smaller heading size, retaining the existing font family/weight. The 320 px heading fits two lines. Desktop controls use a single row.
- Russian, Kyrgyz and English copy included. No schema, database, payment, ad, budget or registration mutations changed.

## Automated verification

Node 22.23.4; tests used `SKIP_DB_TESTS=1 RUN_DB_TESTS=0`, one worker, no database/provider calls.

- `pnpm exec vitest run tests/unit/marketing-analytics-consent.test.tsx tests/unit/marketing-analytics.test.ts tests/unit/marketing-advertising-measurement.test.ts tests/unit/meta-marketing.test.ts tests/unit/marketing-campaigns.test.ts tests/unit/marketing-locale-routing.test.ts tests/unit/marketing-request-locale.test.ts tests/unit/signup-page.test.tsx --maxWorkers=1`: 239 passed across 8 files, including 27 consent UI regressions.
- `pnpm exec vitest run tests/unit/marketing-landing-source.test.ts --maxWorkers=1`: 4 passed.
- `pnpm lint`: passed. `pnpm i18n:check`: passed.
- Final `pnpm exec next build`: passed, including lint, TypeScript checks, all 129 static pages and build traces. Build ran with two-worker cap, isolated loopback service addresses, synthetic public measurement IDs and no production/provider credentials.
- Independent code review: no remaining blockers; `git diff --check`: passed.

## Hydrated browser verification

The final production build was served only on `127.0.0.1:3161`. A local CSP blocked external tracking requests; a disposable loopback Redis instance (no persistence, 32 MB cap) supported the real public signup-mode endpoint. No database was started or accessed, and no signup was submitted.

All 11 layout checks passed: no horizontal overflow, the complete primary CTA above the panel with at least 8 px clearance, and its center hit the actual signup link.

| Locale | Viewport | Panel height | CTA clearance |
| --- | --- | --- | --- |
| RU | 320 × 568 | 121 px | 50.75 px |
| KG | 320 × 568 | 140 px | 31.75 px |
| EN | 320 × 568 | 121 px | 50.75 px |
| RU | 360 × 560 | 121 px | 58.20 px |
| RU | 360 × 640 | 121 px | 138.20 px |
| RU | 375 × 568 | 121 px | 65.45 px |
| RU | 375 × 667 | 121 px | 164.45 px |
| RU | 390 × 568 | 121 px | 65.45 px |
| RU | 390 × 844 | 121 px | 245.69 px |
| RU | 414 × 568 | 121 px | 65.45 px |
| RU | 1280 × 720 | 73 px | 22.59 px |

Actual interactions verified: close leaves all switches off; signup link opens the real form; changing only Meta and saving preserves an entered synthetic name; withdrawing Meta works; the privacy link navigates and closes settings. No form submission or customer records created.

Evidence in the review workspace: `artifacts/consent-banner-20261113/implemented/` (`layout-checks.json`, `interaction-checks.json`, per-viewport screenshots and `final-mobile-review.jpg`). Temporary browser viewport override reset; QA tab, app server, disposable Redis and prior static preview server stopped.

Limit: responsive browser viewports were checked, not physical iPhone Safari/Instagram WebView. The new UI has not been deployed or checked on the live domain; that follows release approval.
