# BAZAAR Inventory Platform

A production-minded Retail Inventory Management Platform built for a single-country rollout. The system prioritizes inventory correctness, auditability, and straightforward operations for non-technical retail staff.

## Tech Stack
- **TypeScript-only**
- **Next.js App Router**
- **tRPC** (type-safe API inside Next.js; server layer modularized for extraction)
- **PostgreSQL** + **Prisma**
- **NextAuth Credentials** + **bcrypt**
- **Tailwind + shadcn-style UI components**
- **PDFKit** (PO PDF generation)
- **PapaParse** (CSV import/export)
- **xlsx** (Excel import/export)
- **Redis** (required in production for realtime, rate limiting, job locks)
- **Vitest**

## Setup

### 1) Install dependencies
```bash
pnpm install
```

### 2) Start Postgres + Redis
```bash
pnpm db:up
```

### 3) Configure environment
```bash
cp .env.example .env
```

### 4) Environment variables
- `DATABASE_URL` (required)
- `NEXTAUTH_SECRET` + `NEXTAUTH_URL` (required for auth)
- `REDIS_URL` (required in production; enables multi-instance realtime, rate limiting, and job locks)
- `JOBS_SECRET` (required to run `/api/jobs/run` via `x-job-secret`)
- `METRICS_SECRET` (recommended; protects `/api/metrics` via `x-metrics-secret`)
- `HEALTHCHECK_SECRET` (recommended; protects detailed `/api/health` via `x-health-secret`)
- `DATABASE_TEST_URL` (optional; used by integration tests)
- `SIGNUP_MODE` (`invite_only` or `open`; defaults to `invite_only`)
- `SKIP_EMAIL_VERIFICATION` (`0` by default; set to `1` only for temporary local/dev bypass)
- `IMPORT_TRANSACTION_TIMEOUT_MS` (optional; defaults to `120000` ms for large import batches)
- `TRIAL_DAYS` (optional; defaults to `14` for self-serve organizations)
- `PLAN_PRICE_STARTER_KGS`, `PLAN_PRICE_BUSINESS_KGS`, `PLAN_PRICE_ENTERPRISE_KGS` (optional pricing used in platform revenue analytics)
- `PLATFORM_OWNER_EMAILS` (comma-separated emails allowed to access `/platform`)
- `EMAIL_PROVIDER` (`log` for local/test, `resend` for production delivery)
- `ALLOW_LOG_EMAIL_IN_PRODUCTION` (`0` by default; set to `1` only for temporary production fallback before SMTP/Resend is configured)
- `EMAIL_FROM` (required when `EMAIL_PROVIDER=resend`)
- `RESEND_API_KEY` (required when `EMAIL_PROVIDER=resend`)
- `SEED_PLATFORM_OWNER_EMAIL` (optional, local seed only)
- `SEED_PLATFORM_OWNER_PASSWORD` (optional, local seed only)
- `SEED_PLATFORM_OWNER_NAME` (optional, local seed only)
- `IMAGE_STORAGE_PROVIDER` (`local` or `r2`; use `r2` for Cloudflare R2 product images)
- `R2_ACCOUNT_ID` (required when `IMAGE_STORAGE_PROVIDER=r2`)
- `R2_ACCESS_KEY_ID` (required when `IMAGE_STORAGE_PROVIDER=r2`)
- `R2_SECRET_ACCESS_KEY` (required when `IMAGE_STORAGE_PROVIDER=r2`)
- `R2_BUCKET_NAME` (required when `IMAGE_STORAGE_PROVIDER=r2`, e.g. `bazaar`)
- `R2_PUBLIC_BASE_URL` (required when `IMAGE_STORAGE_PROVIDER=r2`; public/custom domain or `*.r2.dev`)
- `R2_ENDPOINT` (optional override; defaults to `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`)
- `PRODUCT_IMAGE_MAX_BYTES` (optional max image payload; default `5242880`)

### 5) Create DB schema + seed
```bash
pnpm prisma:migrate
pnpm prisma:seed
```

For a full reset (drop + migrate + seed):
```bash
pnpm db:reset
```

To reset demo user passwords if they already exist:
```bash
SEED_RESET_PASSWORDS=1 pnpm prisma:seed
```

### 6) Run the app
```bash
pnpm dev
```

Open `http://localhost:3000`.

### Demo users
- `admin@example.com / Admin123!`
- `manager@example.com / Manager123!`
- `staff@example.com / Staff123!`
- `owner@example.com / Owner123!` (platform owner in seed)

### Platform owner access
- Add platform owner email to `PLATFORM_OWNER_EMAILS` (for local default: `owner@example.com`).
- Sign in with the seeded platform owner credentials.
- Open `/platform` to manage all organizations and subscription billing values.
- Platform owner panel includes: organization list, plan/status updates, trial/period dates, usage counters, and estimated MRR rollup.

## Subscription Plans & Feature Gates
The app enforces subscription rules server-side (not UI-only) and checks both limits and features before executing protected operations.

| Plan | Limits | Enabled feature modules |
| --- | --- | --- |
| `STARTER` | `1` store, `3` active users, `1000` products | Core inventory/catalog/PO flows only |
| `BUSINESS` | `5` stores, `15` active users, `50000` products | `imports`, `exports`, `analytics`, `compliance` |
| `ENTERPRISE` | `20` stores, `60` active users, `200000` products | `imports`, `exports`, `analytics`, `compliance`, `supportToolkit` |

- Billing state model: `ACTIVE`, `PAST_DUE`, `CANCELED` with `trialEndsAt` and `currentPeriodEndsAt`.
- Hard checks are applied on create/invite/import flows (stores, users, products) and on feature routers (exports, analytics, imports, compliance).
- `/billing` shows current tier, usage, limits, features, trial status, and monthly price in KGS.

## Access Control & Users
- Role-based access: ADMIN, MANAGER, STAFF with protected routes.
- Admin-only user management at `/settings/users`: create/update users, set roles/locales, activate/deactivate, reset passwords.

## Signup, Verification & Invites
- `/signup` supports `invite_only` (request access) or `open` (self-signup) based on `SIGNUP_MODE`.
- By default, email verification is required before login; verification/reset/invite links are delivered via configured email provider.
- Temporary dev bypass: set `SKIP_EMAIL_VERIFICATION=1` to allow signup/invite login without verification emails.
- In `open` mode, verified users complete `/register-business/[token]` to set organization and first store.
- Admins can create invite links from `/settings/users` to onboard staff safely.
- `/billing` shows trial status, plan limits, and usage.
- `invite` flow works in both modes; accepted invite places user into inviter organization and keeps tenant isolation.

## Onboarding Wizard
- Admin-only guided setup at `/onboarding` to reach first value fast.
- Steps cover store legal setup, users, catalog bootstrap, inventory defaults, procurement, and first receive/print flow.
- Progress is saved per organization; every step except store setup can be skipped.

## Stores
- Multi-store directory with unique store codes and per-store policy (allow negative stock).
- Optional expiry lot tracking per store.
- Store profiles include legal entity details (type, legal name, INN, address, phone).

## Dashboard
- Store selector with low-stock alerts, pending purchase orders, recent movements, and recent activity summaries (from audit logs).
- Real-time refresh via SSE events (dashboard, inventory, and purchase orders).

## Localization (ru/kg)
- Locales: `ru` (default) and `kg` (Kyrgyz). Locale persistence uses the `NEXT_LOCALE` cookie (HttpOnly).
- Canonical URLs do not include a locale prefix (e.g. `/inventory`).
- Legacy links with `/ru/*`, `/kg/*`, or `/ky/*` redirect to canonical paths and update the locale cookie.
- Message catalogs live in `messages/ru.json` and `messages/kg.json`.
- Add new copy by introducing a key in both files and reading it via `useTranslations("...")` / `getTranslations("...")`.
- User locale preference is stored in `User.preferredLocale` and synced on login.

## Help Center
- `/help` provides short, task-focused articles in `ru` and `kg`.
- Contextual `?` links on complex screens open the relevant article anchor.

## Admin Support & Metrics
- `/admin/support` (ADMIN): view-as-user sessions, support bundle export, and per-store feature flags.
- `/admin/jobs` (ADMIN): dead-letter job queue with retry/resolve.
- `/admin/metrics` (ADMIN): onboarding completion, time-to-first-value, WAU, adjustments, stockouts.

## Currency & Formatting (KGS)
- Use `src/lib/i18nFormat.ts` helpers for dates, numbers, and currency.
- All monetary values render in KGS via `formatCurrencyKGS(amount, locale)`.

## Catalog & CSV (Products)
- Fields: `sku`, `name`, `category`, `unit`, `description`, `photoUrl`
- Multiple barcodes per product; optional variants with JSON attributes
- Product image gallery (`ProductImage`) with ordered positions, used by product page/edit flows
- Base unit per product with optional packaging conversions for purchasing/receiving
- Global scan/search: quick lookup by name/SKU/barcode with barcode create-on-miss
- Search and category filters on `/products`; product archive/restore (soft delete)
- Product detail view includes movement history (store scoped)
- Variant deletion is blocked when a variant has inventory movements
- CSV import/export available on `/products` (import preview, updates existing SKUs)

### CSV format
```csv
sku,name,category,unit,description,photoUrl,barcodes
TEA-001,Black Tea,Beverages,box,Assorted black tea,https://example.com/tea.jpg,1234567890123|9876543210987
```

## Pricing, Costs & Tags
- Base price on product with per-store overrides (effective price + overridden badge).
- Bulk price updates by store (set / increase % / increase amount).
- Average cost tracking from receipts with markup/margin display on product details.
- Price tags PDF (A4 templates) from product list selections.

## Bundles (Kits) & Expiry Lots
- Bundle components per product; assemble bundles (consume components, receive bundle) in one transaction and idempotent.
- Expiry lots are optional per store; receiving can assign expiry date or keep “no expiry”.

## Variant Attributes
- Attribute definitions (`/settings/attributes`) with ru/kg labels, types, and options.
- Category templates map attributes to product categories.
- Variant generator builds a matrix of options for bulk variant creation.
- Variant editor renders friendly attribute controls (no raw JSON) with required validation.

## Migration Importers
- `/settings/import` for Excel/CSV imports with column mapping, preview, and validation.
- Error CSV download for invalid rows and localized feedback.
- 1C-friendly CSV template download.
- Import history includes per-batch summaries and safe rollback (admin-only).
- Rollback never deletes ledger entries: products are archived, barcodes removed, and compensating movements are created when needed.
- CloudShop/Excel image links are parsed (including `HYPERLINK(...)` formats), downloaded, and saved into managed image storage when possible.
- Import batch summary tracks image resolution outcomes (`downloaded`, `fallback`, `missing`) and stores them per batch.

## Product Image Storage (Local / Cloudflare R2)
- Storage mode is controlled by `IMAGE_STORAGE_PROVIDER` (`local` or `r2`).
- In `r2` mode, imported/uploaded product images are written to Cloudflare R2 and resolved via `R2_PUBLIC_BASE_URL`.
- Object key pattern: `retails/<organizationId>/products/<sha1>.<ext>`.
- In development, if `r2` variables are incomplete, storage falls back to local with warning.
- In production, missing required `r2` variables fail fast.

## Operational Analytics
- `/reports` includes stockouts, slow movers, and shrinkage summaries.
- Store + date-range filters with CSV export.

## Exports & Period Close
- `/reports/exports` supports background export jobs with status tracking, retry, and secured download endpoint.
- Supported formats: `csv` and `xlsx`.
- Export types include:
  - `INVENTORY_MOVEMENTS_LEDGER`
  - `INVENTORY_BALANCES_AT_DATE`
  - `PURCHASES_RECEIPTS`
  - `PRICE_LIST`
  - `SALES_SUMMARY`
  - `STOCK_MOVEMENTS`
  - `PURCHASES`
  - `INVENTORY_ON_HAND`
  - `PERIOD_CLOSE_REPORT`
  - `RECEIPTS_FOR_KKM`
- `/reports/close` creates monthly period-close snapshots with duplicate-period protection and audit logs.

## KG Compliance-Ready Modules
- Store-level compliance profile at `/stores/[id]/compliance` with progressive settings:
  - KKM (`OFF` / `EXPORT_ONLY` / `ADAPTER`)
  - ESF
  - ETTN
  - Marking
- Product-level optional compliance flags for marking/ETTN.
- Compliance status badges are shown in store lists.
- Compliance export columns are included when modules are enabled.

## Inventory Operations
- Receive stock, adjust stock with reason, and transfer stock between stores.
- Stock counts (inventory revisions) with scan-first workflow, apply -> adjustment movements, and variance report.
- Low-stock thresholds set per store/product (`minStock`) and surfaced on dashboard/inventory.
- Transfer creates paired `TRANSFER_OUT` and `TRANSFER_IN` movements in one transaction.
- Variant-aware operations with per-item movement history (user + notes).
- Optional expiry lots per store with expiring-soon panel (no FEFO picking yet).
- Reorder suggestions built from forecasts with optional "Why" breakdown in the UI.

## Suppliers & Purchase Orders
- Supplier directory with contact details and notes.
- Supplier deletion is guarded when referenced by products or purchase orders.
- PO workflow: `DRAFT -> SUBMITTED -> APPROVED -> PARTIALLY_RECEIVED -> RECEIVED` (plus `CANCELLED`).
- Line items support product/variant search, unit costs, add/edit/remove, and totals in KGS.
- Partial receipts track `receivedQty` per line; optional over-receive toggle (default off).
- Receiving is idempotent per receipt event and writes RECEIVE ledger movements.
- PDF export available per PO.
- Role-based PO actions by status (submit/approve/cancel/receive).

## Sales Orders (Customer Orders)
- Dedicated customer order flow at `/sales/orders` (separate from supplier purchase orders).
- Status workflow: `DRAFT -> CONFIRMED -> READY -> COMPLETED` (or `CANCELED`).
- Sales lines support both regular products and bundles.
- Line snapshots store both `unitPriceKgs` and `unitCostKgs` for stable historical profit analytics.
- Completing an order creates immutable `SALE` stock movements and updates inventory snapshots through the ledger.
- Completion is idempotent via request key to prevent double stock deduction.
- RBAC: ADMIN/MANAGER can complete/cancel; staff can work with non-final steps.
- Sales metrics page at `/sales/orders/metrics` provides revenue/cost/profit trends and top products/bundles.

## POS (Cash Register)
- POS routes:
  - `/pos` (entry)
  - `/pos/registers` (register setup)
  - `/pos/sell` (cashier sale flow)
  - `/pos/history` (sales history + returns)
  - `/pos/shifts` (shift controls, cash in/out, X/Z-style reports)
- Register + shift model:
  - Only one `OPEN` shift per register.
  - Shift close stores expected cash, counted cash, and discrepancy.
- POS sales are stored in `CustomerOrder` with POS context (`isPosSale`, `registerId`, `shiftId`).
- Split payments are persisted in immutable `SalePayment` entries.
- Returns are created from sales history and persisted via `SaleReturn` + `SaleReturnLine`.
- Completing POS sale/return writes immutable inventory ledger movements and is idempotent.
- Cash drawer movements (`PAY_IN` / `PAY_OUT`) are immutable and idempotent.
- KKM-ready hooks are supported via store compliance mode (`EXPORT_ONLY`/`ADAPTER`); no legal compliance claim.

## Replenishment -> PO Drafts
- Create draft POs from inventory planning, grouped by supplier.
- Missing supplier assignments are flagged before creation; quantities remain editable.
- Draft creation is idempotent via request keys.

## Scripts
- `pnpm db:up` - start Postgres via docker compose
- `pnpm db:down` - stop Postgres
- `pnpm db:reset` - drop + migrate + seed (local only)
- `pnpm dev` - local dev server
- `pnpm build` - build
- `pnpm start` - start production build
- `pnpm lint` - ESLint
- `pnpm typecheck` - TypeScript strict check
- `pnpm format` - Prettier
- `pnpm test` - Vitest
- `pnpm i18n:check` - validate translation catalogs
- `pnpm test:ci` - typecheck + lint + tests
- `pnpm prisma:generate` - generate Prisma client
- `pnpm prisma:migrate` - apply migrations
- `pnpm prisma:reset` - drop + reapply migrations (uses seed)
- `pnpm prisma:deploy` - apply migrations (production)
- `pnpm prisma:push` - push schema to DB (development only)
- `pnpm prisma:seed` - seed data
- `pnpm ops:preflight` - production preflight checks (env + DB + Redis + startup guards)
- `pnpm ops:email-check` - signup/verify/reset/invite email flow verification

## Testing

### Database-backed tests
Integration tests run against a real Postgres database. Use a dedicated test DB
(created automatically if missing).

Example:
```bash
pnpm db:up
export DATABASE_TEST_URL="postgresql://inventory:inventory@localhost:5432/inventory_test?schema=public"
RUN_DB_TESTS=1 pnpm test
```

## Production Runbook
- `docs/production-readiness.md` contains the release checklist and operator runbook.

CI-style run:
```bash
pnpm db:up
CI=1 DATABASE_TEST_URL="postgresql://inventory:inventory@localhost:5432/inventory_test?schema=public" pnpm test:ci
```

## Reliability Notes

### Inventory Ledger (immutable)
- Stock is tracked via immutable `StockMovement` entries.
- `InventorySnapshot.onHand` is **always derived** from the ledger (`SUM(qtyDelta)`).
- All inventory adjustments/receipts run inside a single DB transaction:
  - `StockMovement` is created.
  - `InventorySnapshot` is updated within the same transaction.
- Row-level locks (`SELECT ... FOR UPDATE`) prevent concurrent drift on `InventorySnapshot`.

### Negative Stock Constraints
- Store policy is stored on `Store.allowNegativeStock` and duplicated on `InventorySnapshot.allowNegativeStock`.
- A DB check constraint enforces: `allowNegativeStock OR onHand >= 0`.
- The migration adds the constraint; the seed script re-checks it for local dev.

### Idempotency
- `IdempotencyKey` table enforces replay safety.
- Required on:
  - Inventory adjustments
  - Inventory receives and transfers
  - PO receiving
- Duplicate requests return stored results instead of reapplying changes.
- Keys are scoped by route + user.

### Auditing
- Every mutation writes `AuditLog` with actor, action, entity, before/after, requestId.
- Request IDs are generated via middleware and propagated through logging, tRPC context, and audit logs.

### Purchase Order State Machine
- `DRAFT -> SUBMITTED -> APPROVED -> PARTIALLY_RECEIVED -> RECEIVED`
- `DRAFT -> CANCELLED`, `SUBMITTED -> CANCELLED`
- `receivedEventId` ensures receive is idempotent and applied once (per full receipt).

### Snapshot Recompute (Admin)
- Admin-only `inventory.recompute` rebuilds `InventorySnapshot` from the ledger and open POs.
- Useful for validation/correction if snapshots drift.

## Forecasting & Replenishment

### Forecasting (MVP)
- Uses daily sales (`StockMovement` type `SALE`) over last N days.
- Bootstrap resampling provides P50/P90 daily demand.
- Optional weekday weighting favors same-weekday history.

### Replenishment Formula
- `demandDuringLeadTime = P50 * leadTimeDays`
- `safetyStock = (P90 - P50) * leadTimeDays + safetyStockDays * P50`
- `reorderPoint = demandDuringLeadTime + safetyStock`
- `targetLevel = reorderPoint + reviewPeriodDays * P50`
- `suggestedOrderQty = max(0, targetLevel - (onHand + onOrder))`

Each item in `/inventory` can reveal the calculation breakdown via the "Why" details.

### Upgrade Path (documented, not implemented)
- ETS/ARIMA or probabilistic state space
- Hierarchical forecasting for multi-store
- Supplier lead time learning from historical receipts

## Observability
- **Structured logging** via pino with requestId.
- **Health check**: `GET /api/health` returns public liveness; detailed readiness requires `x-health-secret`.
- **Preflight check**: `GET /api/preflight` returns `200 ready` or `503 not_ready` and verifies startup checks, DB, and Redis (internal access only via `x-health-secret` or ADMIN auth).
- **Metrics**: `GET /api/metrics` requires `x-metrics-secret` when configured (Prometheus text format counters including SSE connections and event publish stats).

## Background Jobs
- `POST /api/jobs/run?job=cleanup-idempotency-keys` with header `x-job-secret` (requires `JOBS_SECRET`).
- Uses Redis locks when available; falls back to in-memory locks in dev.
- Dead-letter queue support with retry/resolve UI in `/admin/jobs`.

## Real-time (SSE)
- `GET /api/sse` (authenticated; org-scoped stream)
- Events:
  - `inventory.updated` (storeId, productId)
  - `purchaseOrder.updated` (poId, status)
  - `lowStock.triggered` (storeId, productId, onHand, minStock)
- Redis pub/sub when `REDIS_URL` is set; falls back to in-memory in dev with a warning.

## Search & Operator Productivity
- Global scanner/search input in app shell supports Enter-to-lookup by barcode/SKU/name with fast redirect or result panel.
- Command palette (`Cmd/Ctrl + K`) supports quick navigation and global search across products, stores, suppliers, and purchase orders.

## Known Limitations
- Forecasting is intentionally simple for transparency.
- Expiry lots do not include FEFO picking or depletion UI yet.
- Background jobs are manual-trigger via `/api/jobs/run` (no scheduler UI).
- No UI for snapshot recompute (API supports it).

## CI Release Gate
- `.github/workflows/ci.yml` includes `release-gate` job.
- It runs in `NODE_ENV=production` with Postgres + Redis services and executes:
  - `pnpm prisma:migrate`
  - `pnpm ops:preflight`
  - `pnpm build`
