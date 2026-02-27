# M-маркет Integration

## Prerequisites

Before export, each product must satisfy all required fields from the M-маркет import contract:

- `sku`: non-empty and unique in export payload.
- Export scope is **all in-stock products** (`onHand > 0`) across mapped stores.
- `name`: 7-250 characters.
- `price`: numeric, `>= 0`.
- `category`: non-empty.
- `description`: at least 50 characters.
- `images`: at least 3 direct URLs ending with `.jpg`, `.png`, or `.webp`.
- `stock`: generated per mapped store as `{ branch_id, quantity }`.
- `specs`: required; derived from category attribute templates and product attribute values.
  - Internal attribute `key` in Bazaar may remain technical (latin).
  - Outgoing M-маркет spec key is taken from attribute `labelRu` (for example, `Тип`, `Цвет`).

Optional fields are omitted if absent (`discount`, `similar_products_sku`) and are never sent as `null`.

## Specs Catalog (M-маркет API)

M-маркет treats `specs` as required key/value characteristics.

- Available keys per category are provided by M-маркет catalog APIs.
- Available values per key are provided by M-маркет catalog APIs.
- Both APIs support filtering by `?name=...` (example: `?name=Память`).
- If a value is missing in catalog, it can be submitted as a new value.
- If a key is missing for a category, it can be submitted for review and later added by M-маркет.

Bazaar-side workflow stays strict for data quality:

- Define attribute definitions in Settings -> Attributes.
- Assign attribute keys to each category template.
- Fill these attribute values in product variants.
- Export preflight blocks products missing template-required specs.

## Branch Mapping

M-маркет requires `stock[].branch_id`.

- In integration settings, map each Bazaar store to a M-маркет `branch_id`.
- Export is blocked until all store mappings are filled.

## Rate Limit and Full Sync

The importer is called with **one request per full export**.

- API cooldown: **1 request every 15 minutes**.
- Lock key: `mmarket:export:<orgId>` in Redis with 15-minute TTL.
- If export is attempted during cooldown, job is saved as `RATE_LIMITED` with remaining seconds.

M-маркет import works as full sync:

- If a previously exported product is missing in the next payload, M-маркет sets its availability/stock to `0`.
- Bazaar uses in-stock-only scope consistently to avoid accidental partial uploads.

## Export Flow

1. Configure environment (`DEV` or `PROD`) and save API token.
2. Map stores to `branch_id` values.
3. Run preflight validation.
4. Export button is enabled only when preflight has no blockers and cooldown is over.
5. Export job runs in background (`QUEUED -> RUNNING -> DONE/FAILED`).

## Endpoints

- DEV: `https://dev.m-market.kg/api/crm/products/import_products/`
- PROD: `https://market.mbank.kg/api/crm/products/import_products/`

Auth header format:

- `Authorization: Token <token>`

## Audit and Security

- Token is encrypted at rest.
- Only `ADMIN` and `MANAGER` can configure integration or run export.
- Audit events:
  - `MMARKET_CONFIG_UPDATED`
  - `MMARKET_EXPORT_STARTED`
  - `MMARKET_EXPORT_FINISHED`
  - `MMARKET_EXPORT_FAILED`

## Error Reports

Each failed export stores `errorReportJson` in `MMarketExportJob`.

- UI exposes downloadable JSON report per job.
- Response payload (without secrets) is persisted in `responseJson` for debugging.
