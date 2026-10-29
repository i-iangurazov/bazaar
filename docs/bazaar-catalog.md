# Bazaar Catalog Scope

## Decision

Bazaar Catalog is **store-scoped**.

- One organization can have multiple catalogs.
- Each store can have at most one catalog configuration.
- Catalog URL maps to exactly one store catalog (`/c/<slug>`).

## Why store-scoped

- Pricing is store-specific (store overrides vs base price).
- Availability and operations are store-bound.
- Customer orders created from catalog must land in `/sales/orders` with the correct `storeId`.

## Data isolation

- Public slug resolves to a single `BazaarCatalog` row.
- Product payload is fetched only from the catalog's `organizationId` and `storeId`.
- No cross-org listing or lookup paths are exposed.

## Lifecycle

- Catalog states: `DRAFT` and `PUBLISHED`.
- Public catalog is accessible only in `PUBLISHED` state.
- Publish/unpublish is restricted to `ADMIN` and `MANAGER`.

## Publication rules

- `hideOutOfStock` and `hideWithoutPhoto` are saved per store. Both default to
  `false`, preserving publication for existing catalogs.
- Availability uses the selected store's stock. Products with active variants
  require a positive stock balance on an active variant. A bundle requires enough
  of every component to assemble one bundle; its own phantom base balance is ignored.
- Photo presence includes a product photo, gallery image or active variant image.
  Inline data images do not count as public photos.
- These rules combine with manual hiding. Removing manual hiding does not bypass
  a publication rule. Administrative counts and visibility filters reflect both.
- Public search, category counts, pagination and saved-cart product recovery use
  the same rules. Checkout rejects products or variants excluded by current rules.
- A missing variant name is rendered from its characteristics, with a stable
  visible ordinal as the last fallback. Internal IDs are never used as fallback labels.
- AI product renaming is deliberately deferred and is not part of this release.
