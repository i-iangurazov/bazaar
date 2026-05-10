# Integrations Store Scope Audit

## Current Implementation Findings

### Bazaar Catalogue

- Catalogue settings are keyed by `organizationId + storeId`.
- The public catalogue product query filters products by `storeProducts.some({ storeId, isActive: true })` and excludes products hidden for that store.
- Catalogue checkout creates orders for the catalogue store.
- Catalogue product list uses store currency and store price overrides.
- The authenticated catalogue router currently checks organization/store existence inside services, but it does not assert the signed-in manager has access to the selected store.
- Product visibility updates accept organization products, then hide/show for a store. The product list is store-scoped, but the mutation should require the selected products to be assigned to that same store.

### bazaar API

- API keys are stored per store and API authentication resolves a single `storeId`.
- Product GET is store-scoped and includes `currencyCode`.
- API order creation is store-bound by token, but its product lookup currently lacks an explicit `storeProducts.some({ storeId, isActive: true })` filter. That can allow an org product outside the token store to be ordered if it is not hidden in the catalogue.
- bazaar API keys and docs are currently managed from the Bazaar Catalogue router and catalogue page. The integrations index has a bazaar API card, but it links into the catalogue page hash instead of a separate API page.

### M-Market

- Branch IDs are mapped per store through `MMarketBranchMapping`.
- Export payload stock is assembled across all organization stores with mappings.
- Product inclusion is organization-wide through `MMarketIncludedProduct` with `@@unique([orgId, productId])`.
- Product list, select-all IDs, preflight, and exports do not take a selected store or user store-access scope.
- Managers with limited store access can currently see/select products and mappings across the full organization.

### Bakai Store

- Template stock columns and API branch IDs are mapped to stores.
- Product inclusion is organization-wide through `BakaiStoreIncludedProduct` with `@@unique([orgId, productId])`.
- Product list, select-all IDs, template preflight, API preflight, and exports do not take a selected store or user store-access scope.
- API sync uses branch mappings per store, but product inclusion is not per store.
- Managers with limited store access can currently see/select products and mappings across the full organization.

### Image Studio

- Jobs are organization-scoped and linked to optional products.
- Product access in the service checks only organization ownership, not store assignment or user store access.
- The history table is rendered as a plain `Table` without a responsive wrapper. On small widths, status, product, creator, dates, and actions can overflow.

### Other Integration-Like Surfaces

- Product import is store-targeted and already requires a selected store for stock fields.
- Public catalogue and bazaar API order flows should call the customer upsert helper so the customer database remains store-scoped.

## Data Model Proposal

- bazaar API separation needs no new API key schema; it needs a separate tRPC router/page and stronger store-access assertions.
- M-Market and Bakai Store should evolve product inclusion to per-store selection:
  - add nullable/non-null `storeId` to included-product models
  - change uniqueness to `orgId + storeId + productId`
  - backfill existing selections for all mapped/accessible stores only if a safe migration strategy is chosen
- If that migration is too risky for this slice, the immediate safe fix is to add selected-store filtering to product list/update/export APIs and document the remaining migration risk.
- Image Studio can either remain organization-scoped for standalone image jobs or add store filtering when a product is selected. Product-linked operations should respect the selected/accessed store.

## Affected Routes and Files

- `src/app/(app)/operations/integrations/page.tsx`
- `src/app/(app)/operations/integrations/bazaar-catalog/page.tsx`
- new `src/app/(app)/operations/integrations/bazaar-api/page.tsx`
- `src/app/(app)/operations/integrations/m-market/page.tsx`
- `src/app/(app)/operations/integrations/bakai-store/page.tsx`
- `src/app/(app)/operations/integrations/product-image-studio/page.tsx`
- `src/server/trpc/routers/bazaarCatalog.ts`
- new `src/server/trpc/routers/bazaarApi.ts`
- `src/server/trpc/routers/mMarket.ts`
- `src/server/trpc/routers/bakaiStore.ts`
- `src/server/trpc/routers/productImageStudio.ts`
- `src/server/services/bazaarCatalog.ts`
- `src/server/services/bazaarApi.ts`
- `src/server/services/mMarket.ts`
- `src/server/services/bakaiStore.ts`
- `src/server/services/productImageStudio.ts`
- `src/server/services/storeAccess.ts`
- `prisma/schema.prisma` if per-store marketplace inclusion is migrated
- `docs/bazaar-api.md`
- relevant integration tests and source tests

## Required Fixes

- Add store-access assertions to Bazaar Catalogue authenticated procedures.
- Move bazaar API key management and docs out of the Bazaar Catalogue page into `/operations/integrations/bazaar-api`.
- Add a bazaar API router and wire the integrations index card to the separate page.
- Add `storeProducts` filtering to bazaar API order product lookup.
- Ensure bazaar API orders and public catalogue orders upsert customers for the same store.
- Add responsive wrapping or responsive cards for Image Studio history.
- For M-Market and Bakai Store, add store selection and restrict product list/update/preflight/export to the selected store where practical in this slice.

## Risks

- Fully migrating M-Market and Bakai Store included products to per-store rows changes historical selection semantics. That may require careful backfill and UI copy.
- Marketplace export formats aggregate stock across branch mappings. A narrow store selector may be incompatible with existing all-branch sync behavior unless export jobs are explicitly store-scoped.
- Bazaar Catalogue and bazaar API currently share some public visibility assumptions. Separating the UI should not remove the existing hidden-product behavior used by public API product responses.
- Image Studio jobs created without a product cannot naturally be store-scoped unless a storeId is added to jobs.

## Validation Plan

- Add source/unit tests that bazaar API has a separate page/card/router and catalogue page no longer contains API key UI.
- Add integration tests for bazaar API product and order store scoping.
- Add catalogue tests for user store access and same-store visibility mutations.
- Add customer auto-create tests for catalogue and API order paths.
- Add source/UI tests for Image Studio responsive history wrapping.
- Add marketplace tests where practical for selected-store product filtering and denied inaccessible-store updates.

## Implemented Fixes

| Integration | Current Store Handling | Implemented Fix | Deferred Risk |
| --- | --- | --- | --- |
| Bazaar Catalogue | Settings and public products are store-keyed; authenticated router needed stronger selected-store access checks. | Added store-access assertions to catalogue store/settings/product visibility/API-key legacy procedures. Product visibility mutation now validates products are active in the selected store. Public checkout upserts customers for the catalogue store. | Legacy API key procedures remain in the catalogue router for compatibility, but UI moved away from them. |
| bazaar API | API keys are store-keyed, but API UI was mixed into catalogue settings and API order product lookup did not require selected-store assignment. | Added separate `bazaarApi` tRPC router and `/operations/integrations/bazaar-api` page/card. API order product lookup now requires active `StoreProduct` assignment for the token store. API orders upsert customers for the token store. | Existing public API visibility rules still share catalogue hidden-product semantics for GET products. |
| M-Market | Branch IDs are per store; included-product selection remains organization-level. | Audited and documented. Existing branch mapping remains explicit per store. | Per-store included-product schema/backfill remains deferred because it changes historical export selection semantics. |
| Bakai Store | Branch/template mappings are per store; included-product selection remains organization-level. | Audited and documented. Existing branch and template mapping remains explicit per store. | Per-store included-product schema/backfill remains deferred for the same historical selection reason as M-Market. |
| Image Studio | Product-linked jobs are organization/product based; history table overflowed on small screens. | Wrapped history table in a responsive `TableContainer` with stable minimum width so thumbnails/status/actions stay accessible. | Adding `storeId` directly to image jobs is deferred; standalone image jobs do not naturally map to a store. |
| Email Marketing | New integration. | Store-scoped customer audience, one saved logo per store, selected logo preview/send, campaign history, fixed sender, admin/manager access, and recipient filtering by email were implemented. | Background send queue and unsubscribe preference center remain future work. |

## Bazaar Catalogue vs bazaar API Separation

- Bazaar Catalogue remains the public storefront/catalogue configuration surface at `/operations/integrations/bazaar-catalog`.
- bazaar API is now a separate integration surface at `/operations/integrations/bazaar-api` with its own API key list, key creation/revoke actions, and endpoint examples.
- The integrations index links the two cards independently.
- Catalogue settings no longer render API key management UI.
