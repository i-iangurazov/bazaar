# Landing restoration — 10 September 2026

The owner cancelled the latest public landing redesign. The baseline is
`4b5e5ce379031bb9f51737c3c193875ff5432b2a`, immediately before
`4556bee5bf870a9f7ca29412005595bf006f0060` (`feat(marketing): redesign landing and fix mobile navigation`).

## Scope and preservation

- `src/app/page.tsx`, `MarketingLanding.tsx`, `FeatureShowcase.tsx` and `MarketingMotion.tsx`
  are restored byte for byte from the baseline. This restores original metadata, sections,
  copy, pricing, six feature tabs, animations and existing product captures.
- Marketing CSS is restored with changes only to mobile navigation. Navigation preserves
  the original labels, links, brand and layout, with the menu correction below.
- Unused redesign-only `MarketingIcon`, `ProductPreview` and `marketing` translation
  namespaces are removed. Other translation values are unchanged.
- Shared styles/components, authenticated routes, inventory, BAAM and reports are untouched.
  The independent signup preferred-locale fix and its regression tests are retained.
- The original landing is Russian-only and intentionally forces its own light theme,
  combining a dark hero/navigation with light sections. There was no landing language
  selector at the baseline. Existing RU/KG/EN auth language controls remain available;
  locale and theme preferences are preserved when following login/signup links.
- The required `landing-browser` CI job and release gate remain enabled. Its checks now
  cover the restored product story and interactions; redesign-only section/FAQ/language
  controls are no longer expected. Earlier redesign notes describe that historical release.

## Menu defect and correction

At 360, 390 and 768 px, after scrolling 700 px, the exact baseline produced a menu
panel only **56 px high**. The fixed menu was nested inside the fixed header whose
`backdrop-filter: blur(18px) saturate(130%)` established a new containing block.
The menu links overflowed the short panel onto the page. Its background also used
`rgba(7, 11, 19, 0.985)` rather than an opaque surface.

The panel is now a sibling of the filtered header in a viewport overlay. Its background
and the open header use the original `--dark: #070b13` with no transparency. The header
switches immediately to the opaque surface. Existing mobile spacing and typography are
unchanged. The panel scrolls internally on short screens and respects the bottom safe area.

Opening locks background scroll and makes only the landing background inert. Keyboard
focus stays within navigation; Escape and the original close button restore focus and
scroll. Anchor links close the menu, restore scrolling and focus the requested section
below the fixed header. Resizing to desktop cleans up the modal. JavaScript now uses
1000 px, matching the existing CSS breakpoint instead of prematurely closing at 900 px.

## Verification matrix

| Scenario | Expected / verification |
| --- | --- |
| Restoration | Four content/metadata files byte-identical to baseline; CSS changes limited to menu; original captures retained |
| Closed page | Hero and full-page screenshot comparison against the exact local baseline at 360/390/768/1440 px |
| Menu at top / after scroll | Opaque RGB(7,11,19), panel from header to viewport bottom, header outside panel ancestry |
| Keyboard / close | Tab and Shift+Tab containment, Escape/button close, trigger focus, background inert cleanup |
| Scrolling | Background position retained; short panel scrolls to registration CTA; desktop resize unlocks page |
| Navigation | All four mobile anchors focus matching sections below header; desktop anchors and actual signup/login links |
| Breakpoints | 899/900/999/1000/1199/1200 px; no unexpected closing within mobile range |
| Themes / languages | Light/dark cookie isolation; RU/KG/EN cookies preserved; actual auth language switching without submitting forms |
| Original interactions | Six feature tabs and arrow wrap, pricing comparison, original structured prices and canonical metadata |
| Crawlability | Story and pricing present without JavaScript |
| Production identity | `/api/version` must match the explicit 40-character expected SHA before and after browser smoke |

Local browser command: `node scripts/marketing/run.mjs`. It uses an anonymous preview
with isolated configuration; no production database, accounts or business operations.
Screenshots and machine-readable results are written to ignored
`artifacts/bazaar-landing-restoration/` and uploaded by the required CI job.

Production browser command:

```sh
QA_BASE_URL=https://www.bazaar.kg QA_EXPECTED_SHA=FULL_COMMIT_SHA \
  node scripts/marketing/browser.mjs
```

The browser script allows anonymous GETs and the existing locale-preference request only;
registration, login submission, messages, sales and payments are not performed. Viewport
checks are browser emulation, not a claim of testing a physical phone.

## Local results

The restored hero and full-page screenshots have **zero differing pixels** from the
exact baseline on all four widths (360, 390, 768, 1440). The full browser matrix passed
with no page errors, including opaque menus at the top and after scrolling. The complete
Vitest suite passed: 290 files / 2009 tests, including the isolated database suite.
Typecheck, lint, i18n validation and the production build passed. The menu also passed
a normal-motion touch-emulation check on the locally built production runtime. Release identity and public production
verification are captured separately for the final pushed SHA.
