# bazaar API

bazaar API is separate from Bazaar Catalogue.

- Bazaar Catalogue is the public storefront/catalogue setup.
- bazaar API is the external system integration for store-scoped product reads and order creation.

## Admin Surface

- Integration card: `/operations/integrations`
- Settings page: `/operations/integrations/bazaar-api`
- Access: admin and manager roles only.
- Store scope: API keys belong to one store. Managers can manage only stores they can access.

## API Keys

- Keys are stored per organization and store.
- Newly created tokens are shown once.
- Revoked keys cannot authenticate requests.
- The old catalogue API-key UI is no longer shown on the Bazaar Catalogue settings page.

## Product Endpoint

`GET /api/bazaar/v1/products`

The authenticated API token resolves one store. Product responses are limited to products assigned to that store through active `StoreProduct` rows and catalogue visibility rules.

Pagination is explicit: use `page` and `pageSize`; `pageSize` is capped at `100`. The endpoint returns `page`, `pageSize`, `total`, and `items`.

Responses include safe integration fields such as:

- product identifiers, SKU, name, description, categories
- product `createdAt` and `updatedAt` timestamps
- unit/base unit
- supplier display fields
- barcodes and packs
- images and image objects
- variants with `createdAt`/`updatedAt` timestamps and variant attribute values
- store-scoped stock and variant stock; `pcs` is a compatibility alias for `stockQty` on the product, each variant, and each `stockByVariant` row
- `currencyCode` and currency rate metadata

Private cost/accounting fields are not exposed.

Admin product surfaces use different payloads by design:

- product list/search reads paginated summary data
- product detail/edit reads the full product record by ID
- product export uses the export service
- product duplication reads from the source product in the database, so it is not limited by list pagination and preserves unit/base unit data such as `pcs`

## Order Endpoint

`POST /api/bazaar/v1/orders`

Orders are created for the token store only.

- Product lines must reference products active in the same store.
- Orders store currency snapshots from the store.
- Customer name/email/phone from the order upserts the customer database for that same store.
- If both email and phone are missing, no customer row is created.

## Store-Scope Rules

- A Store A API key must not read Store B products.
- A Store A API key must not create Store B orders.
- The same customer email in two stores creates two customer records.
- API responses include `currencyCode`; callers should not assume KGS for display.

## Validation

Coverage includes bazaar API product payload tests, API order creation tests, and customer auto-create coverage through `tests/integration/bazaar-api.test.ts` and `tests/integration/customers.test.ts`.
