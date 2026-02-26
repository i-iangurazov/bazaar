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
