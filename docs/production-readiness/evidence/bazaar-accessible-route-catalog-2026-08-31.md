# Bazaar accessible route catalog

Generated from the application source and test inventories on **2026-08-31**.

This document answers “what can be addressed?” at the route-pattern level. It includes public
pages, landing and Guide states, authenticated pages, compatibility redirects, dynamic patterns,
recognized query-state families, locale prefixes, public resources, and HTTP interfaces. A pattern
such as `/products/{id}` represents every valid concrete product URL; arbitrary identifiers and
filter combinations are intentionally not expanded into an infinite list.

Catalog inclusion is **not** a runtime PASS claim. Runtime results belong in the final readiness
reconciliation after the production-build browser suites finish. This catalog does not modify the
frozen scoring denominator.

## Count reconciliation

| Inventory                                     | Public canonical patterns | Authenticated canonical patterns | Canonical total | Exact/state-style total | Scoring effect                                                               |
| --------------------------------------------- | ------------------------: | -------------------------------: | --------------: | ----------------------: | ---------------------------------------------------------------------------- |
| Frozen production audit                       |                        41 |                               75 |         **116** |                 **132** | Authoritative scored denominator                                             |
| Current maintained browser inventories        |                        47 |                               75 |         **122** |                 **138** | Coverage growth only; no score inflation                                     |
| Complete current code-discovered page catalog |                        47 |                               75 |         **122** |                 **138** | Matches the maintained inventories, including the post-freeze `/legal` route |

The frozen 132 exact URL/state rows reconcile to 116 canonical route patterns as follows:

- The landing has eight exact forms (`/` plus seven fragments) but one canonical page: seven
  duplicate fragment states.
- Bazaar Guide home has four exact forms (`/help` plus three fragments) but one canonical page:
  three duplicate fragment states.
- Six authenticated query forms are states of three existing pages: two `/products/new` type
  states, one `/customers` add state, and three `/inventory` action states.
- Therefore `132 - 10 fragment duplicates - 6 query-state duplicates = 116`.

The maintained inventories added six public patterns after the freeze: the Customers category,
four Orders/Customers articles, and `/legal`. That gives `116 + 6 = 122`. Applying the same ten
fragment and six query-state expansions yields 138 maintained and complete current forms. None of
the post-freeze additions changes the frozen 116/132 readiness score.

## Access and canonicalization rules

| Situation                              | Declared behavior                                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Public visitor                         | Can address the public pages and resources listed below without a session.                                                                                               |
| Signed-in request to `/`               | Server redirects to `/dashboard`. Role middleware may then enforce the caller's allowed home.                                                                            |
| Signed-out request to a protected page | Redirects to `/login?next={original-path-and-query}`.                                                                                                                    |
| Authenticated but disallowed base role | Redirects to `/dashboard?from={original}` for ADMIN/MANAGER or `/pos?from={original}` for STAFF/CASHIER.                                                                 |
| ADMIN/MANAGER home                     | `/dashboard`.                                                                                                                                                            |
| STAFF/CASHIER home                     | `/pos`.                                                                                                                                                                  |
| Platform owner                         | `/platform` additionally requires the `isPlatformOwner` claim; ADMIN alone is insufficient.                                                                              |
| Organization owner                     | `/settings/diagnostics` additionally requires the `isOrgOwner` claim; ADMIN alone is insufficient.                                                                       |
| Development scanner                    | `/dev/scanner-test` exists for ADMIN in non-production, but must render the terminal 404 state in production.                                                            |
| Locale prefix                          | `/ru`, `/kg`, `/en`, or legacy `/ky` is removed from the URL; the same underlying route is used and `NEXT_LOCALE` is persisted.                                          |
| Unknown dynamic record                 | Dynamic acceptance contracts use owned, foreign-tenant, malformed, and syntactically valid missing identifiers; negative cases must terminate without mutation controls. |

Base application roles are `ADMIN`, `MANAGER`, `STAFF`, and `CASHIER`. The Guide's content-audience
labels (`owner`, `manager`, `cashier`, `stockkeeper`) are editorial guidance labels, not middleware
role claims.

## Public page routes

### Landing page and exact anchor states

All eight forms below are public and share the canonical page `/`. Fragments select a client-side
section and never create a second server route.

| Exact form    | Destination/section                 | Frozen exact row |
| ------------- | ----------------------------------- | ---------------- |
| `/`           | Marketing landing hero              | `PUB-001`        |
| `/#platform`  | Retail platform overview            | `PUB-002`        |
| `/#pos`       | POS capability                      | `PUB-003`        |
| `/#inventory` | Inventory capability                | `PUB-004`        |
| `/#commerce`  | Commerce and integration capability | `PUB-005`        |
| `/#analytics` | Analytics and reports capability    | `PUB-006`        |
| `/#mobile`    | Mobile capability                   | `PUB-007`        |
| `/#pricing`   | Pricing section                     | `PUB-008`        |

### Public identity, trust, developer, and catalog pages

| Route pattern                | Access           | Purpose/canonical behavior                                                                      | Inventory status                                       |
| ---------------------------- | ---------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `/privacy`                   | Public           | Published Privacy Policy                                                                        | Frozen canonical                                       |
| `/legal`                     | Public           | Durable legal-information hub linking to Privacy, Guide, API docs, and support contact          | **Post-freeze addition; maintained browser inventory** |
| `/developers/bazaar-api`     | Public           | Bazaar API documentation                                                                        | Frozen canonical                                       |
| `/login`                     | Public           | Login; accepts safe `?next={path-and-query}` continuation                                       | Frozen canonical                                       |
| `/signup`                    | Public           | Account signup                                                                                  | Frozen canonical                                       |
| `/invite`                    | Public           | Invitation-code entry                                                                           | Frozen canonical                                       |
| `/invite/{token}`            | Public/tokenized | Invitation acceptance or terminal invalid/expired/reused state                                  | Frozen canonical/dynamic token                         |
| `/reset`                     | Public           | Password-reset request                                                                          | Frozen canonical                                       |
| `/reset/{token}`             | Public/tokenized | Password-reset completion or terminal invalid/expired state                                     | Frozen canonical/dynamic token                         |
| `/verify/{token}`            | Public/tokenized | Email verification or terminal invalid/expired state                                            | Frozen canonical/dynamic token                         |
| `/register-business/{token}` | Public/tokenized | Business-registration completion or terminal invalid/expired state                              | Frozen canonical/dynamic token                         |
| `/c/{catalog-slug}`          | Public           | Published Bazaar catalog; unpublished, foreign, or unknown slugs use a terminal not-found state | Frozen canonical/dynamic slug                          |

### Bazaar Guide home states

The Guide is public. The four exact forms share canonical route `/help`.

| Exact form              | Destination/state                                  | Frozen exact row |
| ----------------------- | -------------------------------------------------- | ---------------- |
| `/help`                 | Guide home, search, role tracks, and task progress | `GUIDE-001`      |
| `/help#getting-started` | Getting-started section                            | `GUIDE-002`      |
| `/help#tasks`           | Tasks section                                      | `GUIDE-003`      |
| `/help#roles`           | Role-track section                                 | `GUIDE-004`      |

### Bazaar Guide categories

| Route                   | English title       | Inventory status                                                  |
| ----------------------- | ------------------- | ----------------------------------------------------------------- |
| `/help/getting-started` | Getting started     | Frozen                                                            |
| `/help/pos`             | POS                 | Frozen                                                            |
| `/help/products`        | Products            | Frozen                                                            |
| `/help/inventory`       | Inventory           | Frozen                                                            |
| `/help/orders`          | Customer orders     | Frozen route; populated after the original empty-category finding |
| `/help/customers`       | Customers           | **Post-freeze addition**                                          |
| `/help/reports`         | Analytics & reports | Frozen                                                            |
| `/help/integrations`    | Integrations        | Frozen                                                            |
| `/help/settings`        | Settings            | Frozen                                                            |

### Bazaar Guide articles

Every article route is public. “App destination” is the authenticated deep link offered by the
article, not a redirect from the article itself.

| Guide article route                      | English title                   | Editorial audience                   | App destination            | Inventory status         |
| ---------------------------------------- | ------------------------------- | ------------------------------------ | -------------------------- | ------------------------ |
| `/help/getting-started/choose-store`     | How to create or choose a store | owner                                | `/stores`                  | Frozen                   |
| `/help/products/add-product`             | How to add a product            | owner, manager, stockkeeper          | `/products/new`            | Frozen                   |
| `/help/products/edit-product`            | How to edit a product           | owner, manager                       | `/products`                | Frozen                   |
| `/help/products/import-products`         | How to import products          | owner                                | `/settings/import`         | Frozen                   |
| `/help/inventory/receiving`              | How to receive stock            | owner, manager                       | `/inventory/receiving`     | Frozen                   |
| `/help/inventory/transfer`               | How to transfer stock           | owner, manager                       | `/inventory/transfers`     | Frozen                   |
| `/help/inventory/write-off`              | How to write off stock          | owner, manager                       | `/inventory/write-offs`    | Frozen                   |
| `/help/inventory/inventory-count`        | How to run an inventory count   | owner, manager                       | `/inventory/counts`        | Frozen                   |
| `/help/pos/open-shift`                   | How to open a POS shift         | owner, manager, cashier, stockkeeper | `/pos`                     | Frozen                   |
| `/help/pos/make-sale`                    | How to make a sale              | owner, manager, cashier, stockkeeper | `/pos/sell`                | Frozen                   |
| `/help/pos/apply-discount`               | How to apply a discount         | owner, manager, cashier, stockkeeper | `/pos/sell`                | Frozen                   |
| `/help/pos/split-payment`                | How to split a payment          | owner, manager, cashier, stockkeeper | `/pos/sell`                | Frozen                   |
| `/help/pos/hold-receipt`                 | How to hold a receipt           | owner, manager, cashier, stockkeeper | `/pos/sell`                | Frozen                   |
| `/help/pos/resume-receipt`               | How to resume a held receipt    | owner, manager, cashier, stockkeeper | `/pos/sell`                | Frozen                   |
| `/help/pos/return-sale`                  | How to process a return         | owner, manager, cashier, stockkeeper | `/pos/history`             | Frozen                   |
| `/help/pos/close-shift`                  | How to close a shift            | owner, manager, cashier, stockkeeper | `/pos/shifts`              | Frozen                   |
| `/help/orders/create-order`              | How to create a customer order  | owner, manager, cashier              | `/sales/orders/new`        | **Post-freeze addition** |
| `/help/orders/process-order`             | How to process a customer order | owner, manager, cashier              | `/sales/orders`            | **Post-freeze addition** |
| `/help/customers/add-customer`           | How to add a customer           | owner, manager                       | `/customers?add=1`         | **Post-freeze addition** |
| `/help/customers/review-history`         | How to review customer history  | owner, manager                       | `/customers`               | **Post-freeze addition** |
| `/help/settings/add-employee`            | How to add an employee          | owner                                | `/settings/users`          | Frozen                   |
| `/help/reports/analytics-basics`         | How to read analytics           | owner, manager                       | `/reports/analytics`       | Frozen                   |
| `/help/reports/export-reports`           | How to open and export a report | owner, manager                       | `/reports/exports`         | Frozen                   |
| `/help/integrations/connect-marketplace` | How to prepare an integration   | owner, manager                       | `/operations/integrations` | Frozen                   |

## Authenticated page routes by role boundary

All 75 patterns in this section are part of the frozen canonical denominator. A route appearing in a
broader role group is also accessible to every role explicitly named in that group; access is not
implied for omitted roles.

### ADMIN, MANAGER, STAFF, and CASHIER — 18 patterns

| Area               | Route patterns                                                                                                  | Canonical behavior                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| POS                | `/pos`, `/pos/debts`, `/pos/history`, `/pos/kkm`, `/pos/receipts`, `/pos/registers`, `/pos/sell`, `/pos/shifts` | Register-scoped POS pages; applicable pages add/preserve `registerId` |
| Cash compatibility | `/cash`, `/finance/income`, `/finance/expense`                                                                  | Redirect to `/pos/shifts` cash-movement state                         |
| Sales orders       | `/orders`, `/sales/orders`, `/sales/orders/new`, `/sales/orders/metrics`, `/sales/orders/{id}`                  | `/orders` redirects to `/sales/orders`; detail is dynamic             |
| Personal/help      | `/settings/profile`, `/help/compliance`                                                                         | User profile and authenticated compliance help                        |

### ADMIN, MANAGER, and CASHIER — 3 patterns

| Route pattern        | Purpose                |
| -------------------- | ---------------------- |
| `/products`          | Product catalog/list   |
| `/products/{id}`     | Dynamic product detail |
| `/settings/printing` | Printing configuration |

### ADMIN and MANAGER — 43 patterns

| Area                           | Route patterns                                                                                                                                                                                                                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product creation and dashboard | `/products/new`, `/dashboard`                                                                                                                                                                                                                                                                                               |
| Customers                      | `/customers`, `/customers/new`                                                                                                                                                                                                                                                                                              |
| Inventory overview/counts      | `/inventory`, `/inventory/counts`, `/inventory/counts/new`, `/inventory/counts/{id}`                                                                                                                                                                                                                                        |
| Movement journal/print         | `/inventory/movements`, `/inventory/movements/{id}`, `/inventory/movements/{id}/print`                                                                                                                                                                                                                                      |
| Receiving                      | `/inventory/receiving`, `/inventory/receiving/{id}/edit`                                                                                                                                                                                                                                                                    |
| Transfers                      | `/inventory/transfers`, `/inventory/transfers/{id}/edit`                                                                                                                                                                                                                                                                    |
| Write-offs                     | `/inventory/write-offs`, `/inventory/write-offs/{id}/edit`                                                                                                                                                                                                                                                                  |
| Purchasing                     | `/purchase-orders`, `/purchase-orders/new`, `/purchase-orders/{id}`                                                                                                                                                                                                                                                         |
| Suppliers                      | `/suppliers`, `/suppliers/new`                                                                                                                                                                                                                                                                                              |
| Stores                         | `/stores`, `/stores/new`, `/stores/{id}/compliance`, `/stores/{id}/hardware`                                                                                                                                                                                                                                                |
| Reports                        | `/reports`, `/reports/analytics`, `/reports/close`, `/reports/exports`, `/reports/receipts`                                                                                                                                                                                                                                 |
| Integrations                   | `/operations/integrations`, `/operations/integrations/bakai-store`, `/operations/integrations/bazaar-api`, `/operations/integrations/bazaar-catalog`, `/operations/integrations/email-marketing`, `/operations/integrations/m-market`, `/operations/integrations/o-market`, `/operations/integrations/product-image-studio` |
| Catalog/import settings        | `/settings/attributes`, `/settings/categories`, `/settings/import`, `/settings/units`                                                                                                                                                                                                                                       |

### ADMIN — 8 production application patterns plus one non-production route

| Route pattern            | Purpose/production behavior                                      |
| ------------------------ | ---------------------------------------------------------------- |
| `/admin/jobs`            | Job administration                                               |
| `/admin/metrics`         | Operational metrics UI                                           |
| `/admin/support`         | Support administration                                           |
| `/billing`               | Billing/subscription UI                                          |
| `/onboarding`            | Organization onboarding                                          |
| `/settings/store-groups` | Store-group management                                           |
| `/settings/users`        | Employee/user management                                         |
| `/settings/whats-new`    | What's New management/view                                       |
| `/dev/scanner-test`      | ADMIN-only development utility; production must terminate as 404 |

### Claim-gated owner routes — 2 patterns

| Route pattern           | Required claim    | Important boundary                                         |
| ----------------------- | ----------------- | ---------------------------------------------------------- |
| `/platform`             | `isPlatformOwner` | A base ADMIN without the platform-owner claim is denied    |
| `/settings/diagnostics` | `isOrgOwner`      | A base role without the organization-owner claim is denied |

The role-pattern totals reconcile as `18 + 3 + 43 + 9 + 1 + 1 = 75`. At the base-role level,
ADMIN is declared for 73 patterns (including the production-404 scanner pattern), MANAGER for 64,
CASHIER for 21, and STAFF for 18. Owner-claim routes are additive only when their corresponding
claim is present.

## Dynamic page patterns

These 11 patterns are already included in the 75 authenticated canonical patterns; this table does
not add another denominator. Each deterministic acceptance family defines owned, foreign-tenant,
malformed, and syntactically valid missing concrete values.

| Pattern                           | Allowed base roles             | Parameter meaning                 |
| --------------------------------- | ------------------------------ | --------------------------------- |
| `/sales/orders/{id}`              | ADMIN, MANAGER, STAFF, CASHIER | Sales-order identifier            |
| `/products/{id}`                  | ADMIN, MANAGER, CASHIER        | Product identifier                |
| `/inventory/counts/{id}`          | ADMIN, MANAGER                 | Stock-count identifier            |
| `/inventory/movements/{id}`       | ADMIN, MANAGER                 | URL-encoded movement document key |
| `/inventory/movements/{id}/print` | ADMIN, MANAGER                 | Printable movement document key   |
| `/inventory/receiving/{id}/edit`  | ADMIN, MANAGER                 | Receiving reference identifier    |
| `/inventory/transfers/{id}/edit`  | ADMIN, MANAGER                 | Transfer reference identifier     |
| `/inventory/write-offs/{id}/edit` | ADMIN, MANAGER                 | Write-off reference identifier    |
| `/purchase-orders/{id}`           | ADMIN, MANAGER                 | Purchase-order identifier         |
| `/stores/{id}/compliance`         | ADMIN, MANAGER                 | Store identifier                  |
| `/stores/{id}/hardware`           | ADMIN, MANAGER                 | Store identifier                  |

Public dynamic patterns are `/invite/{token}`, `/reset/{token}`, `/verify/{token}`,
`/register-business/{token}`, and `/c/{catalog-slug}`. They are listed with the public pages because
their access and negative-state contracts differ from authenticated record isolation.

## Query states, redirects, and canonical destinations

### Six exact query forms in the frozen 132-row audit

These six rows are state variants, not additional canonical page patterns.

| Exact input                  | Roles          | Declared final location/state                                               |
| ---------------------------- | -------------- | --------------------------------------------------------------------------- |
| `/products/new?type=product` | ADMIN, MANAGER | Same URL; product creation mode                                             |
| `/products/new?type=bundle`  | ADMIN, MANAGER | Same URL; bundle creation mode                                              |
| `/customers?add=1`           | ADMIN, MANAGER | `/customers?add=1&storeId={selected-store}` when fixture selection resolves |
| `/inventory?action=receive`  | ADMIN, MANAGER | `/inventory/receiving`                                                      |
| `/inventory?action=adjust`   | ADMIN, MANAGER | `/inventory` with the consumed action removed                               |
| `/inventory?action=transfer` | ADMIN, MANAGER | `/inventory/transfers?fromStoreId={selected-store}`                         |

### Compatibility and canonicalization redirects

| Input route                                      | Roles/session  | Canonical destination                                           |
| ------------------------------------------------ | -------------- | --------------------------------------------------------------- |
| `/cash`                                          | All base roles | `/pos/shifts#cash-movement`                                     |
| `/finance/income`                                | All base roles | `/pos/shifts?cashMovementType=PAY_IN#cash-movement`             |
| `/finance/expense`                               | All base roles | `/pos/shifts?cashMovementType=PAY_OUT#cash-movement`            |
| `/orders`                                        | All base roles | `/sales/orders`                                                 |
| `/customers/new`                                 | ADMIN, MANAGER | `/customers?add=1&storeId={selected-store}`                     |
| `/inventory/counts/new`                          | ADMIN, MANAGER | `/inventory/counts?page=1&pageSize=25&storeId={selected-store}` |
| `/suppliers/new`                                 | ADMIN, MANAGER | Opens create state, then canonicalizes to `/suppliers`          |
| `/stores/new`                                    | ADMIN, MANAGER | Opens create state, then canonicalizes to `/stores`             |
| `/` with an authenticated session                | Authenticated  | `/dashboard`                                                    |
| Any protected `{path}?{query}` without a session | Signed out     | `/login?next={path-and-query}`                                  |
| Disallowed `{path}?{query}`                      | Authenticated  | Role home with `?from={path-and-query}`                         |

### Deterministic auto-selected state

These are canonicalization behaviors in the maintained authenticated inventory, not separate frozen
query rows.

| Input                                     | Declared final state when deterministic fixture data resolves      |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `/pos`                                    | `/pos?registerId={selected-register}`                              |
| `/pos/debts`                              | `/pos/debts?registerId={selected-register}`                        |
| `/pos/history`                            | `/pos/history?registerId={selected-register}`                      |
| `/pos/sell`                               | `/pos/sell?registerId={selected-register}`                         |
| `/pos/shifts`                             | `/pos/shifts?registerId={selected-register}`                       |
| `/customers`                              | `/customers?storeId={selected-store}`                              |
| `/inventory/counts`                       | `/inventory/counts?page=1&pageSize=25&storeId={selected-store}`    |
| `/settings/import`                        | `/settings/import?page=1&pageSize=25`                              |
| `/operations/integrations/bazaar-catalog` | `/operations/integrations/bazaar-catalog?storeId={selected-store}` |

### Other recognized operational query families

The following query keys create useful user states but are not individually expanded into scored
route rows. Valid combinations are potentially unbounded.

| Page family                         | Recognized state keys                                                                                                                                                                                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login                               | `next`                                                                                                                                                                                                                             |
| App-wide guidance                   | `tour`                                                                                                                                                                                                                             |
| POS                                 | `registerId`, `q`, `store`, `receiptId`, `mode`, `from`, `returnTo`, `cashMovementType`                                                                                                                                            |
| Customers                           | `storeId`, `search`, `source`, `page`, `pageSize`, `sortBy`, `sortDirection`, `add`                                                                                                                                                |
| Products                            | `readiness`; creation additionally uses `type`                                                                                                                                                                                     |
| Inventory journal/detail            | `page`, `pageSize`, `search`, `dateFrom`, `dateTo`, `storeId`, `type`, `status`, `paymentStatus`, `orderStatus`, `archiveMode`, `senderSearch`, `recipientSearch`, `authorSearch`, `sortBy`, `sortDirection`, `source`, `returnTo` |
| Purchase orders                     | `page`, `pageSize`, `search`, `storeId`, `status`, `sortBy`, `sortDirection`                                                                                                                                                       |
| Sales orders                        | `view`, `page`, `pageSize`, `search`, `storeId`, `status`, `sortBy`, `sortDirection`, `returnTo`                                                                                                                                   |
| Suppliers/stores/users create state | `create`; suppliers also use `q`, `page`, `pageSize`                                                                                                                                                                               |
| Integration workspaces              | `storeId`                                                                                                                                                                                                                          |
| Public catalog API/state            | `page`, `pageSize`, `search`, `category`, repeated `productId`                                                                                                                                                                     |

## Locale-prefixed forms

The canonical URL remains unprefixed. The prefix is a compatibility input that selects locale,
preserves query state, and writes the HTTP-only `NEXT_LOCALE` cookie for one year.

| Prefix | Persisted locale | HTML language | Example input                   | Canonical destination                                                             |
| ------ | ---------------- | ------------- | ------------------------------- | --------------------------------------------------------------------------------- |
| `/ru`  | `ru`             | `ru`          | `/ru/help/pos/make-sale?step=2` | `/help/pos/make-sale?step=2`                                                      |
| `/kg`  | `kg`             | `ky-KG`       | `/kg/products/{id}?tab=history` | `/products/{id}?tab=history`                                                      |
| `/en`  | `en`             | `en-US`       | `/en/inventory?action=transfer` | `/inventory/transfers?fromStoreId={selected-store}` after action canonicalization |
| `/ky`  | `kg`             | `ky-KG`       | `/ky/orders`                    | `/sales/orders`; `ky` is the legacy alias for `kg`                                |

The same prefix rule applies to landing, auth, Guide, catalog, authenticated, dynamic, and
compatibility paths. For example, `/ru` becomes `/`, `/kg/c/{slug}` becomes `/c/{slug}`, and
`/en/login?next=%2Fproducts` becomes `/login?next=%2Fproducts`. A URL fragment remains a
browser-side fragment across the redirect but is not sent to middleware. Prefix forms are not new
canonical routes and do not multiply the frozen 116 or current 122 counts by four.

## Special and infrastructure routes

### Public resources and native association documents

These are addressable resources but are outside the page-route readiness denominator.

| Route/pattern                                                                                                          | Access      | Purpose                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| `/robots.txt`                                                                                                          | Public      | Search crawler policy                                                                                  |
| `/sitemap.xml`                                                                                                         | Public      | Landing, signup, developer, legal/privacy, and complete Guide discovery                                |
| `/manifest.webmanifest`                                                                                                | Public      | Installable PWA metadata; start URL `/dashboard` and shortcuts for dashboard, POS, products, inventory |
| `/offline.html`                                                                                                        | Public      | Service-worker offline document fallback                                                               |
| `/offline.js`                                                                                                          | Public      | Offline fallback behavior                                                                              |
| `/sw.js`                                                                                                               | Public      | Service worker                                                                                         |
| `/favicon.ico`                                                                                                         | Public      | Conventional site icon                                                                                 |
| `/apple-touch-icon.png`                                                                                                | Public      | Apple touch icon                                                                                       |
| `/icons/{icon-192,icon-512,maskable-192,maskable-512}.png`                                                             | Public      | PWA icons                                                                                              |
| `/brand/{icon,logo}.png`                                                                                               | Public      | Brand assets                                                                                           |
| `/marketing/captures/{dashboard-wide,integrations-wide,movements-wide,pos-desktop-wide,pos-mobile,products-wide}.webp` | Public      | Landing/Guide captures                                                                                 |
| `/.well-known/apple-app-site-association`                                                                              | Public JSON | iOS app-link association; details remain empty until `APPLE_TEAM_ID` is supplied                       |
| `/.well-known/assetlinks.json`                                                                                         | Public JSON | Android app-link association; array remains empty until release signing fingerprints are supplied      |

Next.js internals such as `/_next/static/*` and `/_next/image` are framework resources, not Bazaar
product routes. Loading boundaries, global errors, and not-found renderings are states rather than
separately navigable product routes.

### HTTP interfaces — 50 API route-handler patterns

These 50 API interfaces are not counted in the 116/132 page matrices. Together with the two
`.well-known` association route handlers listed above, the source tree contains 52 `route.ts`
handlers. “Guard” describes the source-level entry boundary; procedure- or record-level
authorization still applies inside the relevant service.

| Interface pattern                           | Methods           | Guard/audience                                        | Purpose                                        |
| ------------------------------------------- | ----------------- | ----------------------------------------------------- | ---------------------------------------------- |
| `/api/auth/[...nextauth]`                   | GET, POST         | Auth protocol/public entry                            | NextAuth session and authentication operations |
| `/api/trpc/[trpc]`                          | GET, POST         | Procedure-specific                                    | Main typed application API                     |
| `/api/impersonation`                        | GET, POST, DELETE | Session; ADMIN to activate                            | Impersonation cookie lifecycle                 |
| `/api/locale`                               | POST              | Public, validated locale                              | Locale-cookie update                           |
| `/api/sse`                                  | GET               | Authenticated and tenant/store scoped                 | Server-sent application events                 |
| `/api/help/events`                          | POST              | Public, size/type constrained                         | Sanitized Guide analytics events               |
| `/api/public/catalog/[slug]`                | GET               | Public/published catalog                              | Public catalog read model                      |
| `/api/public/catalog/[slug]/checkout`       | POST              | Public plus idempotency key                           | Public catalog checkout/order creation         |
| `/api/public/catalog/image`                 | GET               | Public, validated/SSRF-restricted source              | Catalog image transform/proxy                  |
| `/api/mobile/config`                        | GET               | Public                                                | Native/PWA runtime configuration               |
| `/api/bazaar/v1/products`                   | GET               | Bazaar API key and store scope                        | Product listing                                |
| `/api/bazaar/v1/orders`                     | GET, POST         | Bazaar API key and store scope                        | Order listing/creation                         |
| `/api/bazaar/v1/orders/[id]`                | GET               | Bazaar API key and store scope                        | Order lookup                                   |
| `/api/bazaar/v1/customers`                  | POST              | Bazaar API key and store scope                        | Customer creation/upsert                       |
| `/api/health`                               | GET               | Public shallow result; secret/ADMIN for internals     | Health status                                  |
| `/api/preflight`                            | GET               | Health secret, or ADMIN when no secret is configured  | Deployment preflight                           |
| `/api/metrics`                              | GET               | Metrics secret, or ADMIN when no secret is configured | Prometheus-style metrics                       |
| `/api/jobs/cron/[group]`                    | GET               | Cron secret                                           | Scheduled job group execution                  |
| `/api/jobs/run`                             | POST              | Jobs secret                                           | Explicit job execution                         |
| `/api/bakai-store/jobs/[id]/error-report`   | GET               | Session plus integration permission/store scope       | Bakai export error report                      |
| `/api/bakai-store/jobs/[id]/workbook`       | GET               | Session plus integration permission/store scope       | Bakai export workbook                          |
| `/api/bakai-store/template`                 | GET, POST         | ADMIN/MANAGER session                                 | Bakai template download/upload                 |
| `/api/m-market/jobs/[id]/error-report`      | GET               | Session plus integration permission/store scope       | M-Market error report                          |
| `/api/o-market/jobs/[id]/error-report`      | GET               | Session plus integration permission/store scope       | O!Market error report                          |
| `/api/bazaar-catalog/logo`                  | POST              | ADMIN/MANAGER plus organization/store access          | Bazaar Catalog logo upload                     |
| `/api/email-marketing/logo`                 | POST              | ADMIN/MANAGER plus organization/store access          | Email-marketing logo upload                    |
| `/api/email-marketing/resend-webhook`       | POST              | Svix/Resend signature and timestamp                   | Email delivery webhook                         |
| `/api/email-marketing/unsubscribe`          | GET, POST         | Public signed/tokenized link                          | Customer unsubscribe                           |
| `/api/product-image-studio/jobs/[id]/image` | GET               | Session plus integration permission/tenant scope      | Managed studio input/output image              |
| `/api/product-image-studio/upload`          | POST              | ADMIN/MANAGER organization access                     | Studio image upload                            |
| `/api/product-images/source`                | GET               | ADMIN/MANAGER organization access                     | Managed product-image source                   |
| `/api/product-images/upload-url`            | POST              | ADMIN/MANAGER                                         | Direct-upload target                           |
| `/api/product-images/upload`                | POST              | ADMIN/MANAGER organization access                     | Proxy image upload                             |
| `/api/products/export-images`               | GET               | Authenticated tenant scope                            | Product-image archive generation               |
| `/api/products/export-images/download`      | GET               | Authenticated tenant plus one-time token              | Product-image archive download                 |
| `/api/exports/[id]`                         | GET               | Authenticated tenant/user scope                       | Export-job download                            |
| `/api/pos/receipts/[id]/pdf`                | GET               | Authenticated tenant/store access                     | POS receipt PDF                                |
| `/api/purchase-orders/[id]/pdf`             | GET               | Authenticated purchasing/store access                 | Purchase-order PDF                             |
| `/api/price-tags/pdf`                       | POST              | Authenticated store access                            | Price-tag PDF                                  |
| `/api/printing/labels/connector`            | POST              | Authenticated store access                            | Label connector job                            |
| `/api/printing/receipt/connector`           | POST              | Authenticated sale/store access                       | Receipt connector job                          |
| `/api/kkm/connector/pair`                   | POST              | One-time pairing code plus rate limit                 | Pair KKM connector device                      |
| `/api/kkm/connector/heartbeat`              | POST              | Connector token                                       | Connector heartbeat                            |
| `/api/kkm/connector/queue`                  | GET               | Connector token                                       | Connector work queue                           |
| `/api/kkm/connector/result`                 | POST              | Connector token                                       | Connector result submission                    |
| `/api/mobile/devices`                       | GET, POST, DELETE | Authenticated tenant/user                             | Push-device registration lifecycle             |
| `/api/mobile/diagnostics`                   | POST              | Authenticated tenant/user                             | Native runtime diagnostic event                |
| `/api/qz/certificate`                       | GET               | Authenticated                                         | QZ Tray certificate                            |
| `/api/qz/sign`                              | POST              | Authenticated; signing config required                | QZ Tray payload signature                      |
| `/api/qz/status`                            | GET               | Authenticated                                         | QZ Tray signing status                         |

## Evidence map

| Evidence surface                                                                                                                                              | What it defines or checks                                                                                 | Runtime result recorded here? |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------- |
| [Frozen canonical 116 CSV](../../../tmp/bazaar-audit-final-2026-08-31/route-matrix-canonical-116.csv)                                                         | Immutable scored route patterns                                                                           | No; baseline contents only    |
| [Frozen exact 132 CSV](../../../tmp/bazaar-audit-final-2026-08-31/route-matrix-exact-132.csv)                                                                 | Immutable exact fragment/query/dynamic forms                                                              | No; baseline contents only    |
| [Public route inventory](../../../tests/e2e/public-route-inventory.ts)                                                                                        | Current 47 maintained public canonical patterns, including post-freeze Guide and `/legal` additions       | No                            |
| [Authenticated route inventory](../../../tests/e2e/authenticated/route-inventory.ts)                                                                          | 75 canonical patterns, 6 query states, role boundaries, redirects, and 11 dynamic families                | No                            |
| [Frozen-inventory reconciliation test](../../../tests/unit/route-inventory-reconciliation.test.ts)                                                            | Requires all 116 frozen patterns to map exactly once while allowing public growth                         | No                            |
| [Guide catalog source](../../../src/content/help/catalog.ts) and [Orders/Customers additions](../../../src/content/help/orders-customers.ts)                  | Nine categories, 24 articles, editorial roles, and app destinations                                       | No                            |
| [Guide route catalog test](../../../tests/unit/help-route-catalog.test.ts)                                                                                    | Category/article uniqueness, population, sitemap presence, and app-route references                       | No                            |
| [Public browser matrix](../../../tests/e2e/public-routes.spec.ts)                                                                                             | Public HTML/resources, locales, headings, navigation, network/console, and Guide route discovery          | No                            |
| [Authenticated role/responsive matrix](../../../tests/e2e/authenticated/authenticated-routes.spec.ts)                                                         | Direct role decisions, owner routes, responsive boundaries, and dynamic terminal cases                    | No                            |
| [Authenticated navigation acceptance](../../../tests/e2e/authenticated/authenticated-acceptance-navigation.spec.ts)                                           | Compatibility states, locale prefixes, deep-link refresh, shell navigation, title, active state, and Back | No                            |
| [Middleware source](../../../src/middleware.ts), [role rules](../../../src/lib/roleAccess.ts), and [middleware tests](../../../tests/unit/middleware.test.ts) | Protected prefixes, locale normalization, signed-out redirects, denied-role destinations                  | No                            |
| [Sitemap source](../../../src/app/sitemap.ts)                                                                                                                 | Public search-discovery set, including `/legal` and all Guide routes                                      | No                            |
| [`src/app` route tree](../../../src/app)                                                                                                                      | Current page and route-handler implementation                                                             | No                            |

The final readiness report should attach the actual command outputs and browser artifacts to this
catalog. Until then, the tables are an authoritative route map and denominator reconciliation, not
a claim that every mapped route has passed production acceptance.
