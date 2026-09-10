# Public landing redesign

Baseline: `4b5e5ce379031bb9f51737c3c193875ff5432b2a` on `main`.

The page uses a light neutral surface, Bazaar blue, a restrained dark product section, and one muted green mobile section. The story moves from a store overview through everyday sales and stock work, team/location management, integrations, pricing, questions and signup. CSS and illustrations are scoped to `src/components/marketing`; authenticated application styling and accounting services are unchanged.

## Product and content evidence

| Public claim | Source / decision |
| --- | --- |
| POS, parked receipts, split payments, returns, shifts | Existing POS routes and services; retained actual `pos-desktop-wide.webp` capture |
| Products, variants, barcodes, store stock and movements | Product/inventory pages and services; actual `products-wide.webp` capture |
| Sales, average receipt, gross profit and top products | Dashboard summary/read model and actual `dashboard-wide.webp` capture; profit copy explicitly requires recorded costs |
| Stores, roles and customers/order history | Store access and customer services; no invented staff permissions or CRM features |
| Supported marketplace/API connections | Existing M-Market, Bakai, O! Market and Bazaar API implementations; separate setup stated, no claim that all channels are always connected |
| Prices and store/product/user limits | Read directly from `src/server/billing/planCatalog.ts`, including configured price overrides and decimal prices |
| Starter plan | Existing `pos: false`: removed the old landing's incorrect promise of POS; POS begins at Business |
| Trial duration | Existing `TRIAL_DAYS` configuration/default and validation behavior from signup; no unverified permanent-free offer |
| Demo data | Existing screenshots show synthetic stores. Localized dashboard/phone illustrations show a clearly labeled sample, not customer results or a redesigned authenticated UI |
| Contact and policy | Retained existing WhatsApp contact; privacy now links to the real `/privacy` page |

There is no separate public authenticated demo flow in the current landing. “Explore the product” opens the real-screen showcase. Signup and login retain their existing destinations. Registration now initializes its account language from the locale chosen on the landing, instead of silently defaulting to Russian.

RU/KG/EN copy lives in the new `marketing` message namespace. Existing message text and formatting outside that namespace are preserved. Metadata and structured offers are server rendered and localized; canonical URL, indexing, app authentication redirect and existing global providers remain intact.

## Mobile menu defect

The old menu was a fixed descendant of a header that acquired `backdrop-filter` after scrolling. That header became its containing block: at 390 px, the open menu measured only **56 px high** after scrolling, even though its links extended below it. Its almost-opaque background therefore did not cover the content below. Before screenshots record both top-of-page and scrolled cases.

The replacement is an opaque, full-viewport native modal dialog in the browser's top layer. It locks/restores the page scroll position, contains Tab/Shift+Tab, closes on Escape or a navigation choice, focuses the target section after anchor navigation, and closes when switching to desktop navigation. A short viewport scrolls inside the dialog. Language errors are shown with retry; changing locale keeps the menu usable.

## Verification

- `QA_BROWSER_CHANNEL=chrome node scripts/marketing/run.mjs` starts an isolated anonymous preview, runs the browser checks and shuts it down. CI uses bundled Chromium and makes `landing-browser` a required release prerequisite.
- `scripts/marketing/browser.mjs` checks RU/KG/EN at 360, 390, 768 and 1440 px; additional 999/1000/1199/1200 px boundaries; opaque scrolled menus; keyboard focus; scroll restoration; short screens; language switching/failure/retry; tabs; FAQ; original-size screenshots; signup/login handoff; price/structured-data consistency; dark-cookie isolation; and server-rendered content without JavaScript.
- Regression tests render all localized marketing documents, check actual pricing overrides/limits/trial settings and Starter POS boundaries, and cover account-language handoff into signup.
- Production run: `QA_BASE_URL=https://www.bazaar.kg QA_EXPECTED_SHA=<exact SHA> QA_BROWSER_CHANNEL=chrome node scripts/marketing/browser.mjs`. It checks `/api/version` before and after the run. Only anonymous navigation and locale-cookie changes are made; no forms, customer messages, sales or payments are submitted.
- Screenshots, logs and JSON results are saved under ignored `artifacts/bazaar-landing-redesign/`. CI uploads the browser evidence. Exact final SHA and CI/deployment evidence are recorded in the release report after deployment verification.

No schema migration is needed for this release. Existing first-party assets are reused with responsive Next Image sizing; the hero illustration is HTML/CSS, without a large image download. Content does not depend on scroll-triggered reveal effects, and reduced-motion preferences disable decorative transitions.
