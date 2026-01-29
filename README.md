# Northstar Inventory Platform

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
- **xlsx** (Excel import)
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
- `JOBS_SECRET` (required to run `/api/jobs/run`)
- `DATABASE_TEST_URL` (optional; used by integration tests)
- `SIGNUP_MODE` (`invite_only` or `open`; defaults to `invite_only`)

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

## Access Control & Users
- Role-based access: ADMIN, MANAGER, STAFF with protected routes.
- Admin-only user management at `/settings/users`: create/update users, set roles/locales, activate/deactivate, reset passwords.

## Signup, Verification & Invites
- `/signup` supports `invite_only` (request access) or `open` (self-signup) based on `SIGNUP_MODE`.
- Email verification is required before login; verification and reset links are sent via the mailer stub.
- Admins can create invite links from `/settings/users` to onboard staff safely.
- `/billing` shows trial status, plan limits, and usage.

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

## Operational Analytics
- `/reports` includes stockouts, slow movers, and shrinkage summaries.
- Store + date-range filters with CSV export.

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
- **Health check**: `GET /api/health` (DB + migrations state).
- **Metrics**: `GET /api/metrics` (Prometheus text format counters including SSE connections and event publish stats).

## Background Jobs
- `POST /api/jobs/run?job=cleanup-idempotency-keys` (requires `JOBS_SECRET`).
- Uses Redis locks when available; falls back to in-memory locks in dev.

## Real-time (SSE)
- `GET /api/sse`
- Events:
  - `inventory.updated` (storeId, productId)
  - `purchaseOrder.updated` (poId, status)
  - `lowStock.triggered` (storeId, productId, onHand, minStock)
- Redis pub/sub when `REDIS_URL` is set; falls back to in-memory in dev with a warning.

## Known Limitations
- Forecasting is intentionally simple for transparency.
- Expiry lots do not include FEFO picking or depletion UI yet.
- Price tags render barcode text only (no barcode image).
- Background jobs are manual-trigger via `/api/jobs/run` (no scheduler UI).
- No UI for snapshot recompute (API supports it).
