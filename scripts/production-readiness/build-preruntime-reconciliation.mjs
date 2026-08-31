import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const trackerPath = "docs/production-readiness/readiness-current.json";
const defectRegisterPath = "tmp/bazaar-audit-final-2026-08-31/defect-register.json";
const exactMatrixPath = "tmp/bazaar-audit-final-2026-08-31/route-matrix-exact-132.csv";
const canonicalMatrixPath = "tmp/bazaar-audit-final-2026-08-31/route-matrix-canonical-116.csv";
const workflowMatrixPath = "tmp/bazaar-audit-final-2026-08-31/workflow-matrix.csv";
const outputPath =
  "docs/production-readiness/evidence/pre-runtime-reconciliation-ledger-2026-08-31.json";

const repoPath = (relativePath) => path.join(repositoryRoot, relativePath);
const readText = (relativePath) => readFile(repoPath(relativePath), "utf8");
const readJson = async (relativePath) => JSON.parse(await readText(relativePath));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const compareStrings = (left, right) => left.localeCompare(right, "en");
const requirementId = (suffix) => `BZR-REQ-${suffix}`;

const splitIds = (ids) => ids.trim().split(/\s+/).filter(Boolean).map(requirementId);

const gateDefinitions = {
  FINAL_STATIC: {
    kind: "AUTOMATED",
    state: "PENDING_FINAL_SOURCE_FREEZE",
    commands: ["pnpm exec vitest run", "pnpm typecheck", "pnpm lint", "pnpm i18n:check"],
    files: [
      "tests/unit/test-runtime-isolation.test.ts",
      "tests/unit/readiness-calculator.test.ts",
      "tests/unit/readiness-updater.test.ts",
    ],
    proves:
      "Final source integrity only; it cannot substitute for browser, database, manual, or external evidence.",
  },
  FINAL_DB: {
    kind: "AUTOMATED",
    state: "EARLIER_FULL_PASS_REQUIRES_REVIEW_AGAINST_FINAL_CUTOFF",
    commands: ["pnpm test:db:deterministic"],
    files: ["tests/global-setup.ts", "tests/helpers/testDatabaseSafety.ts"],
    proves:
      "The complete safety-gated isolated PostgreSQL lane after migrations; named domain gates identify the relevant assertions.",
  },
  PROD_BUILD: {
    kind: "AUTOMATED",
    state: "PENDING_FINAL_SOURCE_FREEZE",
    commands: ["pnpm build", "pnpm start"],
    files: [
      "next.config.mjs",
      "scripts/playwright-authenticated-production-server.mjs",
      "playwright.authenticated.config.ts",
    ],
    proves: "Production compilation and local production runtime only.",
  },
  ROUTE_RECONCILIATION: {
    kind: "AUTOMATED",
    state: "PENDING_FINAL_RUNTIME_RECONCILIATION",
    commands: ["pnpm exec vitest run tests/unit/route-inventory-reconciliation.test.ts"],
    files: [
      "tests/unit/route-inventory-reconciliation.test.ts",
      "tests/e2e/public-route-inventory.ts",
      "tests/e2e/authenticated/route-inventory.ts",
      exactMatrixPath,
      canonicalMatrixPath,
    ],
    proves:
      "The frozen 132 exact forms and 116 canonical patterns map to current concrete inventories without changing the denominator.",
  },
  PUBLIC_BROWSER: {
    kind: "AUTOMATED",
    state: "PENDING_FINAL_RUNTIME",
    commands: ["pnpm test:e2e:public"],
    files: ["tests/e2e/public-routes.spec.ts", "tests/e2e/public-route-inventory.ts"],
    proves:
      "Public direct routes, viewports, resources, localization, public forms, public accessibility, and console/network assertions.",
  },
  AUTH_ROUTES_BROWSER: {
    kind: "AUTOMATED",
    state: "PENDING_FINAL_PRODUCTION_RUNTIME",
    commands: ["pnpm test:e2e:authenticated"],
    files: [
      "tests/e2e/authenticated/authenticated-routes.spec.ts",
      "tests/e2e/authenticated/route-inventory.ts",
      "tests/e2e/authenticated/test-fixtures.ts",
    ],
    proves:
      "Authenticated direct-load, role, viewport, owned dynamic, malformed dynamic, missing dynamic, terminal-state, and audit assertions.",
  },
  AUTH_NAVIGATION_BROWSER: {
    kind: "AUTOMATED",
    state: "PENDING_FINAL_PRODUCTION_RUNTIME",
    commands: [
      "pnpm exec playwright test --config=playwright.authenticated.config.ts tests/e2e/authenticated/authenticated-acceptance-navigation.spec.ts",
    ],
    files: [
      "tests/e2e/authenticated/authenticated-acceptance-navigation.spec.ts",
      "tests/unit/app-shell-navigation-source.test.ts",
      "tests/unit/mobile-shell-source.test.ts",
      "tests/unit/middleware.test.ts",
      "tests/unit/page-breadcrumbs-source.test.ts",
      "tests/unit/inventory-receive-compatibility-source.test.ts",
    ],
    proves:
      "Real shell navigation, route title/H1, active state, Back, compatible query/history state, locale prefixes, and refreshed owned dynamic links.",
  },
  GUIDE_STATIC: {
    kind: "AUTOMATED",
    state: "PENDING_FINAL_SOURCE_FREEZE",
    commands: [
      "pnpm exec vitest run tests/unit/help-route-catalog.test.ts tests/unit/help-consequential-guidance.test.ts tests/unit/help-guide-search.test.ts tests/unit/help-pluralization.test.ts",
    ],
    files: [
      "tests/unit/help-route-catalog.test.ts",
      "tests/unit/help-consequential-guidance.test.ts",
      "tests/unit/help-guide-search.test.ts",
      "tests/unit/help-home-keyboard.test.tsx",
      "tests/unit/help-pluralization.test.ts",
      "tests/unit/developer-docs-public-url.test.ts",
    ],
    proves:
      "Guide route/content/search/shortcut/pluralization and consequential step-detail source contracts.",
  },
  DB_COST: {
    kind: "AUTOMATED",
    state: "EARLIER_FULL_PASS_REQUIRES_FINAL_ACCEPTANCE_BINDING",
    commands: ["pnpm test:db:deterministic"],
    files: [
      "tests/integration/product-cost-initial-stock.test.ts",
      "tests/integration/product-cost-lifecycle.test.ts",
      "tests/integration/product-cost-accounting-policies.test.ts",
      "tests/integration/product-cost-product-paths.test.ts",
      "tests/integration/product-cost-sales-returns.test.ts",
      "tests/integration/store-clone-valuation.test.ts",
      "tests/unit/product-cost-readiness.test.ts",
    ],
    proves:
      "Transactional weighted cost, initial stock, multiple receipts, adjustment policies, sales/returns, cloned-store value, and cost read-model consistency.",
  },
  DB_PRODUCTS_MASTER: {
    kind: "AUTOMATED",
    state: "EARLIER_FULL_PASS_REQUIRES_FINAL_ACCEPTANCE_BINDING",
    commands: ["pnpm test:db:deterministic"],
    files: [
      "tests/integration/products.test.ts",
      "tests/integration/bundles.test.ts",
      "tests/integration/imports.test.ts",
      "tests/integration/customers.test.ts",
      "tests/integration/master-data-lifecycle.test.ts",
      "tests/integration/product-optimistic-concurrency.test.ts",
    ],
    proves:
      "Product, bundle, import, customer, master-data, duplicate, and optimistic-concurrency persistence assertions.",
  },
  DB_INVENTORY: {
    kind: "AUTOMATED",
    state: "EARLIER_FULL_PASS_REQUIRES_FINAL_ACCEPTANCE_BINDING",
    commands: ["pnpm test:db:deterministic"],
    files: [
      "tests/integration/inventory.test.ts",
      "tests/integration/stock-counts.test.ts",
      "tests/unit/movement-print-document.test.tsx",
      "tests/unit/movement-document-value.test.ts",
    ],
    proves:
      "Inventory mutation, balanced transfer, count, signed movement, idempotency, and movement print/value assertions.",
  },
  DB_PROCUREMENT: {
    kind: "AUTOMATED",
    state: "EARLIER_FULL_PASS_REQUIRES_FINAL_ACCEPTANCE_BINDING",
    commands: ["pnpm test:db:deterministic"],
    files: [
      "tests/integration/purchase-orders.test.ts",
      "tests/integration/purchase-order-line-concurrency.test.ts",
      "tests/unit/purchase-order-money.test.ts",
    ],
    proves:
      "Purchase-order validation, money, transition, receipt-link, and concurrent line assertions.",
  },
  DB_POS: {
    kind: "AUTOMATED",
    state: "EARLIER_FULL_PASS_REQUIRES_FINAL_ACCEPTANCE_BINDING",
    commands: ["pnpm test:db:deterministic"],
    files: [
      "tests/integration/pos.test.ts",
      "tests/integration/pos-idempotent-events.test.ts",
      "tests/integration/pos-p0-verification.test.ts",
      "tests/unit/pos-sale-math.test.ts",
      "tests/unit/pos-cash-accounting.test.ts",
    ],
    proves:
      "POS sale, receipt, discount, quantity, split payment, return, debt, cash, shift, stock, money, and idempotency assertions.",
  },
  DB_ORDERS: {
    kind: "AUTOMATED",
    state: "EARLIER_FULL_PASS_REQUIRES_FINAL_ACCEPTANCE_BINDING",
    commands: ["pnpm test:db:deterministic"],
    files: [
      "tests/integration/sales-orders.test.ts",
      "tests/integration/b0-agent-3-orders-p0.test.ts",
      "tests/integration/sales-orders-pos-boundary.test.ts",
    ],
    proves:
      "Sales-order line, total, zero-line rejection, status, customer, inventory, cancellation, and idempotency assertions.",
  },
  DB_REPORTS_EXPORTS: {
    kind: "AUTOMATED",
    state: "EARLIER_FULL_PASS_REQUIRES_FINAL_ACCEPTANCE_BINDING",
    commands: ["pnpm test:db:deterministic"],
    files: [
      "tests/integration/reports.test.ts",
      "tests/integration/analytics.test.ts",
      "tests/integration/exports.test.ts",
      "tests/unit/receipt-registry-export.test.ts",
    ],
    proves:
      "Report/analytics source totals, date/store scopes, export values, encoding, and receipt-register export assertions.",
  },
  DB_AUTH_SECURITY: {
    kind: "AUTOMATED",
    state: "EARLIER_FULL_PASS_REQUIRES_FINAL_ACCEPTANCE_BINDING",
    commands: ["pnpm test:db:deterministic"],
    files: [
      "tests/integration/auth-tokens.test.ts",
      "tests/integration/tenancy.test.ts",
      "tests/integration/store-isolation.test.ts",
      "tests/integration/manager-permissions.test.ts",
      "tests/integration/users.test.ts",
    ],
    proves:
      "Token lifecycle, tenant/store isolation, role policy, and user persistence assertions.",
  },
  INVENTORY_MUTATIONS_BROWSER: {
    kind: "AUTOMATED",
    state: "PENDING_FINAL_PRODUCTION_RUNTIME",
    commands: [
      "pnpm exec playwright test --config=playwright.authenticated.config.ts tests/e2e/authenticated/authenticated-acceptance-inventory-mutations.spec.ts",
    ],
    files: [
      "tests/e2e/authenticated/authenticated-acceptance-inventory-mutations.spec.ts",
      "tests/e2e/authenticated/inventory-mutations-contract.ts",
      "tests/unit/authenticated-inventory-mutations-contract.test.ts",
    ],
    proves:
      "Product and inventory create/edit/adjust/receive/transfer/write-off/count/mobile mutations with exact database and rapid-submit controls.",
  },
  TRANSFER_BROWSER: {
    kind: "AUTOMATED",
    state: "PENDING_FINAL_PRODUCTION_RUNTIME",
    commands: [
      "pnpm exec playwright test --config=playwright.authenticated.config.ts tests/e2e/authenticated/authenticated-acceptance-transfer.spec.ts",
    ],
    files: ["tests/e2e/authenticated/authenticated-acceptance-transfer.spec.ts"],
    proves:
      "Rendered transfer detail and print contain balanced source/destination legs after reload.",
  },
  MASTER_PROCUREMENT_BROWSER: {
    kind: "AUTOMATED",
    state: "PENDING_FINAL_PRODUCTION_RUNTIME",
    commands: [
      "pnpm exec playwright test --config=playwright.authenticated.config.ts tests/e2e/authenticated/authenticated-acceptance-master-data-procurement.spec.ts",
    ],
    files: [
      "tests/e2e/authenticated/authenticated-acceptance-master-data-procurement.spec.ts",
      "tests/e2e/authenticated/master-data-procurement-contract.ts",
      "tests/unit/authenticated-master-data-procurement-contract.test.ts",
    ],
    proves:
      "Product list, categories, units, attributes, supplier, mobile product, purchase order, receipt, PDF, and database reconciliation.",
  },
  ADVANCED_PRODUCTS_BROWSER: {
    kind: "AUTOMATED",
    state: "PENDING_FINAL_PRODUCTION_RUNTIME",
    commands: [
      "pnpm exec playwright test --config=playwright.authenticated.config.ts tests/e2e/authenticated/authenticated-acceptance-advanced-products.spec.ts",
    ],
    files: [
      "tests/e2e/authenticated/authenticated-acceptance-advanced-products.spec.ts",
      "tests/unit/authenticated-advanced-product-contract.test.ts",
    ],
    proves:
      "Bundle, product image validation/persistence, invalid import non-mutation, and stale-editor conflict acceptance.",
  },
  POS_MOBILE_BROWSER: {
    kind: "AUTOMATED",
    state: "PENDING_FINAL_PRODUCTION_RUNTIME",
    commands: [
      "pnpm exec playwright test --config=playwright.authenticated.config.ts tests/e2e/authenticated/authenticated-acceptance-pos-mobile.spec.ts",
    ],
    files: [
      "tests/e2e/authenticated/authenticated-acceptance-pos-mobile.spec.ts",
      "tests/unit/authenticated-pos-mobile-contract.test.ts",
    ],
    proves:
      "Mobile cart/customer/quantity/discount/split-payment/completion/ledger plus populated receipt overflow/action acceptance.",
  },
  POS_OPERATIONS_BROWSER: {
    kind: "AUTOMATED",
    state: "PENDING_FINAL_PRODUCTION_RUNTIME",
    commands: [
      "pnpm exec playwright test --config=playwright.authenticated.config.ts tests/e2e/authenticated/authenticated-acceptance-pos-operations.spec.ts",
    ],
    files: [
      "tests/e2e/authenticated/authenticated-acceptance-pos-operations.spec.ts",
      "tests/unit/authenticated-pos-operations-contract.test.ts",
    ],
    proves:
      "Return, debt, cash movement, shift reconciliation, rapid-submit settlement, and foreign-tenant denial.",
  },
  SALES_ORDERS_BROWSER: {
    kind: "AUTOMATED",
    state: "PENDING_FINAL_PRODUCTION_RUNTIME",
    commands: [
      "pnpm exec playwright test --config=playwright.authenticated.config.ts tests/e2e/authenticated/authenticated-acceptance-sales-orders.spec.ts",
    ],
    files: [
      "tests/e2e/authenticated/authenticated-acceptance-sales-orders.spec.ts",
      "tests/unit/sales-order-double-submit-source.test.ts",
      "tests/unit/sales-order-lifecycle.test.ts",
    ],
    proves:
      "Invalid/rapid submit, valid line-bearing order, and cancelled-order UI/API fail-closed acceptance.",
  },
  COST_REPORTS_BROWSER: {
    kind: "AUTOMATED",
    state: "PENDING_FINAL_PRODUCTION_RUNTIME",
    commands: [
      "pnpm exec playwright test --config=playwright.authenticated.config.ts tests/e2e/authenticated/authenticated-acceptance-cost-reports.spec.ts",
    ],
    files: [
      "tests/e2e/authenticated/authenticated-acceptance-cost-reports.spec.ts",
      "tests/unit/authenticated-accounting-contract.test.ts",
    ],
    proves:
      "Exact weighted-cost UI/movement/product CSV and posted write-off UI/reload/CSV/XLSX reconciliation.",
  },
  REPORT_OPERATIONS_BROWSER: {
    kind: "AUTOMATED",
    state: "PENDING_FINAL_PRODUCTION_RUNTIME",
    commands: [
      "pnpm exec playwright test --config=playwright.authenticated.config.ts tests/e2e/authenticated/authenticated-acceptance-report-operations.spec.ts",
    ],
    files: ["tests/e2e/authenticated/authenticated-acceptance-report-operations.spec.ts"],
    proves:
      "Report range/store filters, empty range, localized report/export values, and production timing budgets.",
  },
  AUTH_SESSION_BROWSER: {
    kind: "AUTOMATED",
    state: "PENDING_FINAL_PRODUCTION_RUNTIME",
    commands: [
      "pnpm exec playwright test --config=playwright.authenticated.config.ts tests/e2e/authenticated/authenticated-acceptance-auth-session.spec.ts",
    ],
    files: [
      "tests/e2e/authenticated/authenticated-acceptance-auth-session.spec.ts",
      "tests/unit/public-auth-submit-guards-source.test.ts",
    ],
    proves:
      "Generic invalid login, masked fields, Enter, repeated submit, protected origin, authenticated login redirect, logout/Back/tabs, tampered/expired/lost session, and in-page denial.",
  },
  AUTH_LIFECYCLE_BROWSER: {
    kind: "AUTOMATED",
    state: "PENDING_FINAL_PRODUCTION_RUNTIME",
    commands: [
      "pnpm exec playwright test --config=playwright.authenticated.config.ts tests/e2e/authenticated/authenticated-acceptance-auth-lifecycle.spec.ts",
    ],
    files: [
      "tests/e2e/authenticated/authenticated-acceptance-auth-lifecycle.spec.ts",
      "tests/unit/authenticated-auth-lifecycle-contract.test.ts",
      "tests/integration/auth-tokens.test.ts",
    ],
    proves:
      "Valid password reset, verification, invite, open signup, business registration, one-time consumption, rollback, and no-external-provider acceptance.",
  },
  EMPLOYEE_INVITATION_BROWSER: {
    kind: "AUTOMATED",
    state: "PENDING_FINAL_PRODUCTION_RUNTIME",
    commands: [
      "pnpm exec playwright test --config=playwright.authenticated.config.ts tests/e2e/authenticated/authenticated-acceptance-employee-invitation.spec.ts",
    ],
    files: [
      "tests/e2e/authenticated/authenticated-acceptance-employee-invitation.spec.ts",
      "tests/unit/authenticated-employee-invitation-contract.test.ts",
    ],
    proves:
      "Admin creates one scoped invite; employee accepts, signs in, remains role/store-bound; expired/malformed/reused cases and cleanup are asserted without external email.",
  },
  FORM_RELIABILITY_BROWSER: {
    kind: "AUTOMATED",
    state: "PENDING_FINAL_PRODUCTION_RUNTIME",
    commands: [
      "pnpm exec playwright test --config=playwright.authenticated.config.ts tests/e2e/authenticated/authenticated-acceptance-form-reliability.spec.ts",
    ],
    files: [
      "tests/e2e/authenticated/authenticated-acceptance-form-reliability.spec.ts",
      "tests/unit/form-reliability-source.test.ts",
      "tests/unit/supplier-form.test.ts",
    ],
    proves:
      "Customer/supplier/PO required, Unicode/contact, numeric/rounding, dirty-cancel, no-mutation, terminal error, retry, and empty-state acceptance.",
  },
  RBAC_ISOLATION_BROWSER: {
    kind: "AUTOMATED",
    state: "PENDING_FINAL_PRODUCTION_RUNTIME",
    commands: [
      "pnpm exec playwright test --config=playwright.authenticated.config.ts tests/e2e/authenticated/authenticated-acceptance-rbac-isolation.spec.ts",
    ],
    files: [
      "tests/e2e/authenticated/authenticated-acceptance-rbac-isolation.spec.ts",
      "tests/unit/authenticated-rbac-isolation-source.test.ts",
    ],
    proves:
      "In-page CRUD, export/print, legitimate second tenant, scoped responses, multi-store switching/history, and matching owner data boundaries.",
  },
  CATALOG_PUBLICATION_BROWSER: {
    kind: "AUTOMATED",
    state: "PENDING_FINAL_PRODUCTION_RUNTIME",
    commands: [
      "pnpm exec playwright test --config=playwright.authenticated.config.ts tests/e2e/authenticated/authenticated-acceptance-catalog-publication.spec.ts",
    ],
    files: [
      "tests/e2e/authenticated/authenticated-acceptance-catalog-publication.spec.ts",
      "tests/unit/authenticated-catalog-publication-contract.test.ts",
    ],
    proves:
      "Disposable local owned-catalog publish/public visibility/ownership/foreign denial/unpublish/audit acceptance with cleanup.",
  },
  OPERATIONS_SETTINGS_BROWSER: {
    kind: "AUTOMATED",
    state: "PENDING_FINAL_PRODUCTION_RUNTIME",
    commands: [
      "pnpm exec playwright test --config=playwright.authenticated.config.ts tests/e2e/authenticated/authenticated-acceptance-operations-settings.spec.ts",
    ],
    files: [
      "tests/e2e/authenticated/authenticated-acceptance-operations-settings.spec.ts",
      "tests/unit/authenticated-operations-settings-source.test.ts",
    ],
    proves:
      "Reversible profile/onboarding mutations, integration setup/secret/state/error guidance, compliance/hardware current data, data minimization, and role restrictions.",
  },
  MOBILE_ACTIONS_BROWSER: {
    kind: "AUTOMATED",
    state: "PENDING_FINAL_PRODUCTION_RUNTIME",
    commands: [
      "pnpm exec playwright test --config=playwright.authenticated.config.ts tests/e2e/authenticated/authenticated-acceptance-mobile-actions.spec.ts",
    ],
    files: ["tests/e2e/authenticated/authenticated-acceptance-mobile-actions.spec.ts"],
    proves:
      "Mobile customer edit/restore, settings save, and report date/store actions with persistence and overflow assertions.",
  },
  ACCESSIBILITY_LOCALIZATION_BROWSER: {
    kind: "AUTOMATED",
    state: "PENDING_FINAL_PRODUCTION_RUNTIME",
    commands: [
      "pnpm exec playwright test --config=playwright.authenticated.config.ts tests/e2e/authenticated/authenticated-acceptance-accessibility.spec.ts",
    ],
    files: [
      "tests/e2e/authenticated/authenticated-acceptance-accessibility.spec.ts",
      "tests/unit/form-control-accessibility.test.tsx",
      "tests/unit/page-header-accessibility.test.tsx",
      "tests/unit/modal-description.test.tsx",
      "tests/unit/email-marketing-workspace-localization.test.ts",
      "tests/unit/guidance-overlay-accessibility.test.tsx",
    ],
    proves:
      "Representative keyboard/focus/modal/field-error/names plus complete EN/RU/KG email-workspace copy and long-label containment.",
  },
  I18N_STATIC: {
    kind: "AUTOMATED",
    state: "PENDING_FINAL_SOURCE_FREEZE",
    commands: ["pnpm i18n:check"],
    files: [
      "scripts/i18n-check.ts",
      "tests/unit/help-pluralization.test.ts",
      "tests/unit/currency.test.ts",
      "tests/unit/currency-ui-source.test.ts",
    ],
    proves:
      "Message-key parity, locale-safe source constraints, pluralization, and currency-format source contracts; it does not prove every rendered screen.",
  },
  PERFORMANCE_LAYOUT_BROWSER: {
    kind: "AUTOMATED",
    state: "PENDING_FINAL_PRODUCTION_RUNTIME",
    commands: [
      "pnpm exec playwright test --config=playwright.authenticated.config.ts tests/e2e/authenticated/authenticated-acceptance-performance-layout.spec.ts",
    ],
    files: [
      "tests/e2e/authenticated/authenticated-acceptance-performance-layout.spec.ts",
      "tests/integration/inventory-large-document-performance.test.ts",
      "tests/unit/perf-profile.test.ts",
    ],
    proves:
      "Production navigation/search budgets, CLS, and populated movement-table containment/action reachability.",
  },
  PUBLIC_HTML_BUDGET: {
    kind: "AUTOMATED",
    state: "EARLIER_PRODUCTION_MEASUREMENTS_REQUIRE_FINAL_BUILD_RECHECK",
    commands: ["pnpm readiness:public-html"],
    files: [
      "scripts/production-readiness/check-public-html-budget.mjs",
      "tests/unit/public-message-payload.test.ts",
    ],
    proves:
      "Measured production HTML bytes against the defined threshold; it does not provide field Web Vitals.",
  },
  MOBILE_VALIDATE: {
    kind: "AUTOMATED",
    state: "EARLIER_PASS_REQUIRES_RELEASE_IDENTITY_COMPLETION",
    commands: ["pnpm mobile:validate", "pnpm mobile:test"],
    files: [
      "tests/unit/native-deep-links.test.ts",
      "tests/unit/native-runtime-contract.test.ts",
      "tests/unit/native-scanner.test.ts",
    ],
    proves:
      "Native source/configuration and runtime contracts only; not production association identity or physical-device verification.",
  },
  LEGAL_COUNSEL: {
    kind: "LEGAL_MANUAL",
    state: "UNAVAILABLE",
    commands: [],
    files: ["docs/production-readiness/EXTERNAL_BLOCKERS.md"],
    proves:
      "Counsel-approved operator/controller facts and locale parity; application authors cannot invent them.",
  },
  MANUAL_CONTRAST: {
    kind: "MANUAL",
    state: "UNAVAILABLE",
    commands: [],
    files: ["docs/production-readiness/EXTERNAL_BLOCKERS.md"],
    proves: "Recorded manual contrast review for all affected rendered states.",
  },
  MANUAL_ZOOM: {
    kind: "MANUAL",
    state: "UNAVAILABLE",
    commands: [],
    files: ["docs/production-readiness/EXTERNAL_BLOCKERS.md"],
    proves: "Recorded 200% zoom and narrow-viewport accessibility review.",
  },
  MANUAL_SCREEN_READER: {
    kind: "MANUAL",
    state: "UNAVAILABLE",
    commands: [],
    files: ["docs/production-readiness/EXTERNAL_BLOCKERS.md"],
    proves: "Formal recorded screen-reader workflow session.",
  },
  EXTERNAL_FISCAL: {
    kind: "EXTERNAL",
    state: "UNAVAILABLE",
    commands: [],
    files: ["docs/production-readiness/EXTERNAL_BLOCKERS.md"],
    proves:
      "Authorized non-production fiscal/KKM pairing, send, retry, recovery, tax, and receipt reconciliation.",
  },
  EXTERNAL_EMAIL_DELIVERY: {
    kind: "EXTERNAL",
    state: "UNAVAILABLE",
    commands: [],
    files: ["docs/production-readiness/EXTERNAL_BLOCKERS.md"],
    proves: "Authorized real provider sandbox and inbox delivery evidence.",
  },
  EXTERNAL_LIVE_INTEGRATION: {
    kind: "EXTERNAL",
    state: "UNAVAILABLE",
    commands: [],
    files: ["docs/production-readiness/EXTERNAL_BLOCKERS.md"],
    proves: "Authorized provider sandbox connect/sync/disconnect/retry evidence.",
  },
  EXTERNAL_BILLING: {
    kind: "EXTERNAL",
    state: "UNAVAILABLE",
    commands: [],
    files: ["docs/production-readiness/EXTERNAL_BLOCKERS.md"],
    proves:
      "Authorized billing sandbox mutation, webhook, retry, idempotency, authorization, and reconciliation.",
  },
  NATIVE_RELEASE_IDENTITY: {
    kind: "EXTERNAL_NATIVE",
    state: "UNAVAILABLE",
    commands: [],
    files: ["docs/production-readiness/EXTERNAL_BLOCKERS.md"],
    proves:
      "Production Apple IDs/team and Android signing fingerprints plus physical-device association validation.",
  },
  PRODUCT_DECISION_D009: {
    kind: "PRODUCT_DECISION",
    state: "UNAPPROVED",
    commands: [],
    files: [
      "docs/production-readiness/DECISIONS.md",
      "docs/production-readiness/EXTERNAL_BLOCKERS.md",
    ],
    proves: "Explicit approval of the accounting policy for positive unpriced adjustments.",
  },
};

const plans = new Map();
const assign = (ids, target, gateIds, gap) => {
  for (const id of splitIds(ids)) {
    if (plans.has(id)) throw new Error(`Duplicate requirement plan: ${id}`);
    plans.set(id, { target, gateIds, gap });
  }
};

assign(
  "0002 0005 0010 0011 0134 0143 0150 0151 0152 0218 0220",
  "PASS",
  ["ROUTE_RECONCILIATION", "PUBLIC_BROWSER", "AUTH_ROUTES_BROWSER", "PROD_BUILD"],
  "Final reconciled public/authenticated production browser results have not run at this source cutoff.",
);
assign(
  "0003 0004 0007 0008",
  "PASS",
  ["AUTH_NAVIGATION_BROWSER", "PUBLIC_BROWSER", "ROUTE_RECONCILIATION"],
  "The exact navigation/history assertions exist but their final production browser run is pending.",
);
assign(
  "0013 0222 0230",
  "PASS",
  ["PUBLIC_BROWSER", "PROD_BUILD"],
  "Public HTTP/resource/keyboard acceptance is pending against the final build.",
);
assign(
  "0015 0018 0019 0207",
  "PASS",
  ["GUIDE_STATIC", "I18N_STATIC", "PUBLIC_BROWSER"],
  "Named Guide/localization contracts exist; final source and public-browser results are pending.",
);
assign(
  "0022 0027 0124",
  "PASS",
  ["ADVANCED_PRODUCTS_BROWSER", "DB_PRODUCTS_MASTER", "FINAL_STATIC"],
  "The advanced-product acceptance spec has not completed its final production run.",
);
assign(
  "0023 0024 0025 0035 0036 0155 0156",
  "PASS",
  ["MASTER_PROCUREMENT_BROWSER", "DB_PRODUCTS_MASTER", "DB_PROCUREMENT"],
  "The master-data/procurement acceptance spec has not completed its final production run.",
);
assign(
  "0026",
  "PASS",
  ["ADVANCED_PRODUCTS_BROWSER", "DB_PRODUCTS_MASTER"],
  "Invalid import reporting and no-mutation acceptance is pending final production runtime.",
);
assign(
  "0032 0057 0066 0067 0133 0157",
  "PASS",
  ["INVENTORY_MUTATIONS_BROWSER", "DB_INVENTORY", "DB_PRODUCTS_MASTER"],
  "Exact mutation and database assertions exist; the final production browser run is pending.",
);
assign(
  "0033 0034 0062",
  "PASS",
  ["TRANSFER_BROWSER", "DB_INVENTORY", "FINAL_STATIC"],
  "Balanced detail/print assertions exist but final production browser execution is pending.",
);
assign(
  "0037 0075 0076 0077 0078 0158 0171",
  "PASS",
  ["POS_MOBILE_BROWSER", "DB_POS"],
  "POS mobile/receipt acceptance and exact database assertions await final production runtime.",
);
assign(
  "0040 0041 0071 0073 0074",
  "PASS",
  ["SALES_ORDERS_BROWSER", "DB_ORDERS", "AUTH_ROUTES_BROWSER"],
  "Sales-order browser/database acceptance is pending the final production run.",
);
assign(
  "0046 0047 0110 0111",
  "PASS",
  ["AUTH_ROUTES_BROWSER", "RBAC_ISOLATION_BROWSER", "DB_AUTH_SECURITY"],
  "Positive owner and ordinary-role denial results are pending final production runtime.",
);
assign(
  "0049 0050 0051 0052 0053 0056 0068 0128 0129",
  "PASS",
  ["FORM_RELIABILITY_BROWSER", "DB_PRODUCTS_MASTER", "DB_PROCUREMENT"],
  "Exact form boundary/non-mutation/retry assertions exist but final browser execution is pending.",
);
assign(
  "0059 0060 0084 0085 0166 0169",
  "PASS",
  [
    "COST_REPORTS_BROWSER",
    "REPORT_OPERATIONS_BROWSER",
    "DB_COST",
    "DB_REPORTS_EXPORTS",
    "PRODUCT_DECISION_D009",
  ],
  "Automated cost/report evidence remains pending; full accounting certification also requires decision D-009.",
);
assign(
  "0069 0070",
  "PASS",
  ["MASTER_PROCUREMENT_BROWSER", "DB_PROCUREMENT", "DB_INVENTORY"],
  "PO transition/receipt/supplier/inventory linkage awaits final production runtime.",
);
assign(
  "0079 0080 0081 0082",
  "PASS",
  ["POS_OPERATIONS_BROWSER", "DB_POS"],
  "POS operations acceptance exists but its final production browser/database result is pending.",
);
assign(
  "0086 0138 0206 0208 0209 0210",
  "PASS",
  [
    "I18N_STATIC",
    "ACCESSIBILITY_LOCALIZATION_BROWSER",
    "REPORT_OPERATIONS_BROWSER",
    "PUBLIC_BROWSER",
  ],
  "Locale parity and representative rendered assertions exist; final static/browser results are pending.",
);
assign(
  "0087",
  "PASS",
  ["FINAL_DB", "AUTH_ROUTES_BROWSER", "INVENTORY_MUTATIONS_BROWSER", "CATALOG_PUBLICATION_BROWSER"],
  "Fixture cleanup and rollback must be verified after the complete final mutation run.",
);
assign(
  "0089 0091 0092 0093 0094 0096 0097 0098 0122 0127",
  "PASS",
  ["AUTH_SESSION_BROWSER", "PUBLIC_BROWSER", "DB_AUTH_SECURITY"],
  "Exact auth/session acceptance exists but final production runtime is pending.",
);
assign(
  "0106 0107 0108 0112 0113 0115 0184 0186",
  "PASS",
  ["RBAC_ISOLATION_BROWSER", "DB_AUTH_SECURITY"],
  "Direct in-page/API/tenant/store boundary acceptance awaits final production runtime.",
);
assign(
  "0116 0117",
  "PASS",
  ["AUTH_LIFECYCLE_BROWSER", "EMPLOYEE_INVITATION_BROWSER", "PUBLIC_BROWSER", "DB_AUTH_SECURITY"],
  "Valid and negative token/invitation lifecycles await final browser and database results.",
);
assign(
  "0119",
  "PASS",
  ["AUTH_LIFECYCLE_BROWSER", "DB_AUTH_SECURITY"],
  "Local open-signup/business-registration lifecycle is pending; real delivery remains separately blocked in 0118.",
);
assign(
  "0120 0181",
  "PASS",
  ["CATALOG_PUBLICATION_BROWSER", "PUBLIC_BROWSER", "DB_AUTH_SECURITY"],
  "Disposable local owned-catalog publication/unpublication acceptance is pending final production runtime.",
);
assign(
  "0123 0149",
  "PASS",
  [
    "INVENTORY_MUTATIONS_BROWSER",
    "SALES_ORDERS_BROWSER",
    "POS_OPERATIONS_BROWSER",
    "DB_INVENTORY",
    "DB_POS",
    "DB_ORDERS",
  ],
  "Rapid-submit/idempotency assertions exist across critical mutations but the final combined run is pending.",
);
assign(
  "0130 0213",
  "PASS",
  ["PERFORMANCE_LAYOUT_BROWSER", "FINAL_DB"],
  "Large-list/document usability and timing acceptance is pending against the final production build.",
);
assign(
  "0137 0144",
  "PASS",
  ["PERFORMANCE_LAYOUT_BROWSER", "POS_MOBILE_BROWSER", "AUTH_ROUTES_BROWSER"],
  "Data-loaded internal-scroll/root-overflow/action assertions await final runtime.",
);
assign(
  "0145",
  "PASS",
  ["MASTER_PROCUREMENT_BROWSER", "REPORT_OPERATIONS_BROWSER", "PERFORMANCE_LAYOUT_BROWSER"],
  "Representative real search/filter controls await final production runtime.",
);
assign(
  "0146 0147 0189 0190 0191 0192 0193 0194 0195 0197 0198",
  "PASS",
  [
    "ACCESSIBILITY_LOCALIZATION_BROWSER",
    "PUBLIC_BROWSER",
    "AUTH_NAVIGATION_BROWSER",
    "AUTH_ROUTES_BROWSER",
  ],
  "Automated keyboard/focus/name/form/heading/status acceptance exists but final browser runtime is pending.",
);
assign(
  "0160 0161 0162",
  "PASS",
  ["MOBILE_ACTIONS_BROWSER", "AUTH_NAVIGATION_BROWSER", "MASTER_PROCUREMENT_BROWSER"],
  "Critical mobile actions await final production runtime.",
);
assign(
  "0164 0165 0167 0170 0216 0217",
  "PASS",
  ["REPORT_OPERATIONS_BROWSER", "DB_REPORTS_EXPORTS", "PROD_BUILD"],
  "Exact report/filter/empty/export/localization/timing acceptance awaits final runtime.",
);
assign(
  "0174 0175 0176 0177 0179 0183 0185 0187",
  "PASS",
  ["OPERATIONS_SETTINGS_BROWSER", "RBAC_ISOLATION_BROWSER", "DB_AUTH_SECURITY"],
  "Safe local configuration/current-data/guidance/restriction acceptance awaits final production runtime; no live provider claim is inferred.",
);
assign(
  "0188",
  "PASS",
  ["EMPLOYEE_INVITATION_BROWSER", "DB_AUTH_SECURITY"],
  "Employee invitation/role/store/sign-in/cleanup acceptance is pending final runtime.",
);
assign(
  "0211 0212 0214 0219",
  "PASS",
  ["PERFORMANCE_LAYOUT_BROWSER", "PROD_BUILD"],
  "Defined production navigation/search/CLS budgets await final runtime.",
);
assign(
  "0229",
  "PASS",
  ["PUBLIC_HTML_BUDGET", "PROD_BUILD", "PUBLIC_BROWSER"],
  "Earlier byte measurements must be repeated after the final build; field evidence remains relevant to PUBLIC-015, not silently inferred here.",
);

assign(
  "0009",
  "PARTIAL",
  ["PUBLIC_BROWSER", "AUTH_ROUTES_BROWSER", "FORM_RELIABILITY_BROWSER"],
  "The matrices cover terminal pages and representative validation/error/empty states, not every safe loading, empty, success, validation, permission, and error family across applicable workflows.",
);
assign(
  "0017",
  "PARTIAL",
  ["GUIDE_STATIC", "PUBLIC_BROWSER", "AUTH_NAVIGATION_BROWSER"],
  "Source-level consequential guidance exists, but every Guide article has not been checked step-by-step against the final live UI and each applicable role.",
);
assign(
  "0039",
  "PARTIAL",
  ["DB_PRODUCTS_MASTER", "FORM_RELIABILITY_BROWSER", "MOBILE_ACTIONS_BROWSER"],
  "Database customer creation plus browser validation/edit coverage does not yet prove a complete browser create-and-inspect lifecycle for a disposable test customer.",
);
assign(
  "0048",
  "PARTIAL",
  ["AUTH_ROUTES_BROWSER", "FINAL_STATIC"],
  "A dependency-specific KKM browser case at 1440/1024/390 still must identify every expected response state/action and prove no unexplained 403; the generic route terminal audit is insufficient.",
);
assign(
  "0054",
  "PARTIAL",
  ["FORM_RELIABILITY_BROWSER", "REPORT_OPERATIONS_BROWSER"],
  "Report range coverage does not prove invalid, past, and future date boundaries on every important date-bearing form.",
);
assign(
  "0055",
  "PARTIAL",
  ["ADVANCED_PRODUCTS_BROWSER", "DB_PRODUCTS_MASTER"],
  "Product-image validation is covered, but every upload/import control has not been tested for rejected type and size boundaries with zero persistence.",
);
assign(
  "0072",
  "PARTIAL",
  ["SALES_ORDERS_BROWSER", "DB_ORDERS"],
  "Valid/invalid line creation is covered, but a complete rendered add-line, remove-line, and re-total lifecycle has not been bound to final evidence.",
);
assign(
  "0131",
  "PARTIAL",
  ["FORM_RELIABILITY_BROWSER", "AUTH_NAVIGATION_BROWSER"],
  "Dirty modal close/cancel is covered; navigation-away, refresh, and browser-close preservation or explicit warning is not proven across important forms.",
);
assign(
  "0136",
  "PARTIAL",
  ["PUBLIC_BROWSER", "AUTH_ROUTES_BROWSER", "PERFORMANCE_LAYOUT_BROWSER"],
  "Automated containment does not establish a complete cross-route visual alignment and spacing review at all audited viewports.",
);
assign(
  "0139",
  "PARTIAL",
  ["FORM_RELIABILITY_BROWSER", "SALES_ORDERS_BROWSER", "POS_MOBILE_BROWSER"],
  "Representative disabled/active controls are asserted, but the application-wide button label, state, and resulting-action inventory is incomplete.",
);
assign(
  "0140",
  "PARTIAL",
  ["INVENTORY_MUTATIONS_BROWSER", "SALES_ORDERS_BROWSER", "RBAC_ISOLATION_BROWSER"],
  "Several consequential operations fail closed, but all destructive actions have not been inventoried and checked for the appropriate confirmation and warning copy.",
);
assign(
  "0141",
  "PARTIAL",
  ["FORM_RELIABILITY_BROWSER", "AUTH_ROUTES_BROWSER"],
  "Representative success/error recovery is covered, but an application-wide notification/toast audit for clarity, conflicts, duplication, and timing is missing.",
);
assign(
  "0142",
  "PARTIAL",
  ["FORM_RELIABILITY_BROWSER", "REPORT_OPERATIONS_BROWSER", "AUTH_ROUTES_BROWSER"],
  "Customer/report and route empty states are covered, but every important empty state has not been checked for an actionable next step.",
);
assign(
  "0159",
  "PARTIAL",
  ["AUTH_ROUTES_BROWSER", "SALES_ORDERS_BROWSER"],
  "Responsive order routes and desktop order mutation acceptance do not prove a critical mobile order lookup/create/edit/status action lifecycle.",
);
assign(
  "0163",
  "PARTIAL",
  ["MOBILE_ACTIONS_BROWSER", "POS_MOBILE_BROWSER", "ACCESSIBILITY_LOCALIZATION_BROWSER"],
  "Individual mobile settings/report/receipt/long-label cases do not cover the full tables, dropdowns, dates, scanners, print controls, and long-label responsive matrix.",
);
assign(
  "0205",
  "PARTIAL",
  ["I18N_STATIC", "PUBLIC_BROWSER", "ACCESSIBILITY_LOCALIZATION_BROWSER"],
  "Message-key parity and the localized email workspace are covered, but every rendered application screen has not been audited for untranslated keys or mixed-language copy.",
);

const boundaryPlans = {
  [requirementId("0014")]: {
    target: "BLOCKED",
    gateIds: ["LEGAL_COUNSEL"],
    gap: "Operational legal facts require counsel approval and cannot be invented from source inspection.",
  },
  [requirementId("0083")]: {
    target: "BLOCKED",
    gateIds: ["EXTERNAL_FISCAL"],
    gap: "No authorized fiscal/KKM sandbox or tax/receipt target is available.",
  },
  [requirementId("0118")]: {
    target: "BLOCKED",
    gateIds: ["EXTERNAL_EMAIL_DELIVERY"],
    gap: "Log-provider acceptance does not prove real inbox delivery.",
  },
  [requirementId("0180")]: {
    target: "BLOCKED",
    gateIds: ["EXTERNAL_LIVE_INTEGRATION"],
    gap: "Local configuration tests do not authorize or prove a live provider connection.",
  },
  [requirementId("0182")]: {
    target: "BLOCKED",
    gateIds: ["EXTERNAL_BILLING"],
    gap: "No authorized billing sandbox/payment method/webhook target is available.",
  },
  [requirementId("0196")]: {
    target: "PARTIAL",
    gateIds: ["PUBLIC_BROWSER", "MANUAL_CONTRAST"],
    gap: "Automated computed ratios do not complete the required manual review across affected states.",
  },
  [requirementId("0199")]: {
    target: "BLOCKED",
    gateIds: ["MANUAL_ZOOM"],
    gap: "A recorded 200% zoom/narrow-viewport session is not available at this cutoff.",
  },
  [requirementId("0200")]: {
    target: "BLOCKED",
    gateIds: ["MANUAL_SCREEN_READER"],
    gap: "A formal recorded screen-reader workflow session is not available.",
  },
  [requirementId("0226")]: {
    target: "BLOCKED",
    gateIds: ["MOBILE_VALIDATE", "NATIVE_RELEASE_IDENTITY"],
    gap: "Apple production team/application identifiers and physical-device association proof are unavailable.",
  },
  [requirementId("0227")]: {
    target: "BLOCKED",
    gateIds: ["MOBILE_VALIDATE", "NATIVE_RELEASE_IDENTITY"],
    gap: "Android production signing fingerprints and physical-device association proof are unavailable.",
  },
};

const defectPlans = {
  "BZR-PRD-001": {
    state: "PENDING_FINAL_RUNTIME_AND_PRODUCT_DECISION",
    gateIds: ["DB_COST", "COST_REPORTS_BROWSER", "DB_REPORTS_EXPORTS", "PRODUCT_DECISION_D009"],
    closureGate:
      "Exact 80.46/80.90 initial/multi-receipt/rounding cases and every UI, movement, report, margin, purchase-cost, CSV/XLSX consumer reconcile; decision D-009 is approved.",
  },
  "PUBLIC-001": {
    state: "PENDING_FINAL_RUNTIME",
    gateIds: ["PUBLIC_BROWSER", "PROD_BUILD"],
    closureGate:
      "Keyboard/mobile footer legal controls reach durable /privacy in every locale/viewport and sitemap/resource production checks pass.",
  },
  "REPORTS-001": {
    state: "PENDING_FINAL_RUNTIME",
    gateIds: ["DB_REPORTS_EXPORTS", "COST_REPORTS_BROWSER"],
    closureGate:
      "Posted write-off is immediate and reload-stable for inclusive timezone/store scope; UI, CSV, and XLSX reconcile by movement ID, quantity, value, store, and timestamp.",
  },
  "PUBLIC-002": {
    state: "BLOCKED_LEGAL",
    gateIds: ["LEGAL_COUNSEL"],
    closureGate:
      "Counsel approves operator identity, contact, retention/deletion, rights/complaints, effective date, and locale parity.",
  },
  "PUBLIC-003": {
    state: "PENDING_FINAL_RUNTIME",
    gateIds: ["GUIDE_STATIC", "PUBLIC_BROWSER", "AUTH_NAVIGATION_BROWSER"],
    closureGate:
      "Orders/customer create/edit/status/cancel/history Guide pages render and each instruction is bound to the live role-appropriate UI.",
  },
  "PUBLIC-004": {
    state: "PENDING_FINAL_RUNTIME",
    gateIds: ["GUIDE_STATIC", "PUBLIC_BROWSER"],
    closureGate:
      "Meta+K and Control+K focus search, visible focus meets the measured ratio, and keyboard activation passes.",
  },
  "PUBLIC-005": {
    state: "PENDING_FINAL_RUNTIME",
    gateIds: [
      "PUBLIC_BROWSER",
      "AUTH_LIFECYCLE_BROWSER",
      "EMPLOYEE_INVITATION_BROWSER",
      "DB_AUTH_SECURITY",
    ],
    closureGate:
      "Unknown, malformed, expired, reused, and wrong-purpose tokens are non-actionable before data collection and direct server mutations fail closed; valid controls pass.",
  },
  "PUBLIC-006": {
    state: "PENDING_FINAL_RUNTIME",
    gateIds: ["PUBLIC_BROWSER", "ACCESSIBILITY_LOCALIZATION_BROWSER"],
    closureGate:
      "Every affected public label/error/select has stable names and resolvable descriptions, aria-invalid, and announced submit errors in the rendered browser.",
  },
  "PUBLIC-007": {
    state: "PENDING_FINAL_RUNTIME",
    gateIds: ["PUBLIC_BROWSER", "AUTH_ROUTES_BROWSER", "AUTH_NAVIGATION_BROWSER"],
    closureGate:
      "Every affected auth/error route renders localized route-specific title and exactly one meaningful H1.",
  },
  "PUBLIC-008": {
    state: "BLOCKED_MANUAL_AFTER_AUTOMATION",
    gateIds: ["PUBLIC_BROWSER", "MANUAL_CONTRAST"],
    closureGate:
      "All affected rendered states meet measured WCAG AA ratios in automation and the recorded manual review.",
  },
  "PUBLIC-009": {
    state: "BLOCKED_NATIVE_IDENTITY",
    gateIds: ["MOBILE_VALIDATE", "NATIVE_RELEASE_IDENTITY"],
    closureGate:
      "Production identifiers/fingerprints/paths are populated and verified on physical devices, or product explicitly documents association as unsupported.",
  },
  "PUBLIC-010": {
    state: "PENDING_FINAL_RUNTIME",
    gateIds: ["PUBLIC_BROWSER", "CATALOG_PUBLICATION_BROWSER", "PROD_BUILD"],
    closureGate:
      "Unknown catalog slugs return a real HTTP 404 document while preserving localized friendly title/H1; a valid owned slug remains reachable.",
  },
  "PUBLIC-011": {
    state: "PENDING_FINAL_RUNTIME_AND_PARITY_REVIEW",
    gateIds: ["GUIDE_STATIC", "PUBLIC_BROWSER", "AUTH_NAVIGATION_BROWSER"],
    closureGate:
      "All consequential Guide workflows expose current step-specific captures or concrete controls/locations and are checked against applicable roles/live UI.",
  },
  "LAYOUT-001": {
    state: "PENDING_FINAL_RUNTIME",
    gateIds: ["PERFORMANCE_LAYOUT_BROWSER"],
    closureGate:
      "Populated movement tables at 768/1024/1440 have root overflow <=1px, internal table scrolling, fixed shell/sidebar, and reachable actions.",
  },
  "INVENTORY-001": {
    state: "PENDING_FINAL_RUNTIME",
    gateIds: ["DB_INVENTORY", "TRANSFER_BROWSER"],
    closureGate:
      "Every transfer detail and print/export view shows exactly one balanced source and destination leg and store balances/totals reconcile after reload.",
  },
  "LAYOUT-002": {
    state: "PENDING_FINAL_RUNTIME",
    gateIds: ["POS_MOBILE_BROWSER"],
    closureGate:
      "Both populated receipt routes at 1024 have root overflow <=1px, internal table scrolling, and reachable actions.",
  },
  "ORDERS-001": {
    state: "PENDING_FINAL_RUNTIME",
    gateIds: ["DB_ORDERS", "SALES_ORDERS_BROWSER"],
    closureGate:
      "Client and server reject zero-line/non-positive orders without record or sequence allocation; one valid positive line control succeeds once.",
  },
  "ORDERS-002": {
    state: "PENDING_FINAL_RUNTIME",
    gateIds: ["DB_ORDERS", "SALES_ORDERS_BROWSER"],
    closureGate:
      "Cancelled-order UI disables all tracking/confirmation/line controls and direct mutations create no tracking/status/audit/message side effects.",
  },
  "KKM-002": {
    state: "OPEN_TARGETED_RUNTIME_GAP",
    gateIds: ["AUTH_ROUTES_BROWSER", "FINAL_STATIC"],
    closureGate:
      "Add/execute a dependency-specific ADMIN browser assertion at 1440/1024/390 that maps every expected state to an explicit action and proves no unexplained 403; generic route smoke is insufficient.",
  },
  "DYNAMIC-001": {
    state: "PENDING_FINAL_RUNTIME",
    gateIds: ["AUTH_ROUTES_BROWSER"],
    closureGate:
      "Owned, malformed, and syntactically-valid-missing cases for all 11 dynamic patterns reach finite safe states; mutation controls stay absent and valid controls render.",
  },
  "COMPAT-001": {
    state: "PENDING_FINAL_RUNTIME",
    gateIds: ["AUTH_NAVIGATION_BROWSER"],
    closureGate:
      "/inventory?action=receive opens receiving at all viewports and final URL/control state survives refresh and Back/Forward.",
  },
  "PUBLIC-012": {
    state: "PENDING_FINAL_SOURCE_FREEZE",
    gateIds: ["GUIDE_STATIC", "PUBLIC_BROWSER"],
    closureGate: "Exact production developer URL renders and placeholder regressions remain green.",
  },
  "PUBLIC-013": {
    state: "PENDING_FINAL_RUNTIME",
    gateIds: ["PUBLIC_BROWSER", "PROD_BUILD"],
    closureGate:
      "/favicon.ico returns 200 with correct content type/body, public cache policy, and validator header against the production build.",
  },
  "PUBLIC-014": {
    state: "PENDING_FINAL_SOURCE_FREEZE",
    gateIds: ["GUIDE_STATIC", "I18N_STATIC", "PUBLIC_BROWSER"],
    closureGate:
      "RU/KG/EN locale-aware article counts and rendered values pass after the final source freeze.",
  },
  "PUBLIC-015": {
    state: "PENDING_FINAL_BUILD_AND_FIELD_EVIDENCE",
    gateIds: ["PUBLIC_HTML_BUDGET", "PERFORMANCE_LAYOUT_BROWSER", "PROD_BUILD"],
    closureGate:
      "Approved transfer budget passes on the final production build under mobile throttling and representative field Web Vitals are attached; byte tests alone are insufficient.",
  },
  "AUTH-A11Y-001": {
    state: "PENDING_FINAL_RUNTIME",
    gateIds: ["ACCESSIBILITY_LOCALIZATION_BROWSER", "FINAL_STATIC"],
    closureGate:
      "Affected dialogs expose title and meaningful description linkage in the accessibility tree and emit no warning.",
  },
};

const categoryFallbackGates = {
  "Core functional correctness": ["FINAL_STATIC", "PUBLIC_BROWSER", "AUTH_ROUTES_BROWSER"],
  "End-to-end workflows and data integrity": ["FINAL_DB", "AUTH_ROUTES_BROWSER"],
  "Authorization, security and tenant isolation": ["DB_AUTH_SECURITY", "AUTH_ROUTES_BROWSER"],
  "Reliability and error handling": ["FINAL_STATIC", "AUTH_ROUTES_BROWSER"],
  "UX and responsive behavior": ["PUBLIC_BROWSER", "AUTH_ROUTES_BROWSER"],
  "Reporting, integrations and operational readiness": [
    "DB_REPORTS_EXPORTS",
    "AUTH_ROUTES_BROWSER",
  ],
  "Accessibility and localization": [
    "ACCESSIBILITY_LOCALIZATION_BROWSER",
    "PUBLIC_BROWSER",
    "I18N_STATIC",
  ],
  "Performance, PWA and infrastructure": [
    "PROD_BUILD",
    "PUBLIC_BROWSER",
    "PERFORMANCE_LAYOUT_BROWSER",
  ],
};

const requirementProofState = (requirement, plan, boundary) => {
  if (boundary) return "BOUNDARY_NOT_PROVEN";
  if (requirement.currentStatus === "PASS" && !plan) {
    return "LIVE_TRACKER_PASS_REQUIRES_FINAL_REGRESSION_REVIEW";
  }
  if (plan?.target === "PASS") return "CANDIDATE_PASS_PENDING_ALL_NAMED_GATES";
  if (plan?.target === "PARTIAL") return "PARTIAL_COVERAGE_ONLY_NOT_PASS_PROVEN";
  return "NO_EXACT_PASS_MAP_RETAIN_LIVE_NONPASS";
};

const buildLedger = async () => {
  const [trackerText, defectsText, exactMatrixText, canonicalMatrixText, workflowMatrixText] =
    await Promise.all([
      readText(trackerPath),
      readText(defectRegisterPath),
      readText(exactMatrixPath),
      readText(canonicalMatrixPath),
      readText(workflowMatrixPath),
    ]);
  const tracker = JSON.parse(trackerText);
  const defectRegister = JSON.parse(defectsText);

  const requirements = tracker.requirements.map((requirement) => {
    const boundary = boundaryPlans[requirement.id] ?? null;
    const plan = boundary ?? plans.get(requirement.id) ?? null;
    const gateIds = plan?.gateIds ??
      categoryFallbackGates[requirement.category] ?? ["FINAL_STATIC"];
    const disposition = boundary
      ? "BOUNDARY_RETAIN_NONPASS"
      : requirement.currentStatus === "PASS" && !plan
        ? "RETAIN_LIVE_PASS_REVERIFY"
        : plan?.target === "PASS"
          ? "CANDIDATE_PASS_AFTER_ALL_GATES"
          : plan?.target === "PARTIAL"
            ? "PARTIAL_ONLY_DO_NOT_PROMOTE_TO_PASS"
            : "HOLD_LIVE_NONPASS_NO_EXACT_PASS_MAP";
    const candidateStatusIfAllGatesPass = boundary
      ? boundary.target
      : requirement.currentStatus === "PASS" && !plan
        ? "PASS"
        : (plan?.target ?? requirement.currentStatus);
    const automatedEvidenceFiles = [
      ...new Set(
        gateIds.flatMap((gateId) =>
          gateDefinitions[gateId]?.kind === "AUTOMATED" ? gateDefinitions[gateId].files : [],
        ),
      ),
    ].sort(compareStrings);

    return {
      id: requirement.id,
      fingerprint: requirement.fingerprint,
      category: requirement.category,
      requirement: requirement.requirement,
      liveStatus: requirement.currentStatus,
      liveExecuted: requirement.currentExecuted,
      applicationOwned: requirement.applicationOwned,
      relatedDefectIds: requirement.relatedDefectIds,
      disposition,
      candidateStatusIfAllGatesPass,
      proofAtDraftCutoff: requirementProofState(requirement, plan, boundary),
      gateIds,
      automatedEvidenceFiles,
      gapOrBoundary:
        plan?.gap ??
        (requirement.currentStatus === "PASS"
          ? "Retain the live PASS only after regression review; this draft does not re-score it."
          : "No exact acceptance-to-test map covers the full wording; retain the live non-PASS status."),
    };
  });

  const defects = defectRegister.defects.map((defect) => {
    const plan = defectPlans[defect.id];
    if (!plan) throw new Error(`Missing defect plan: ${defect.id}`);
    return {
      id: defect.id,
      severity: defect.severity,
      title: defect.title,
      liveStatus: "OPEN",
      draftClosureState: plan.state,
      gateIds: plan.gateIds,
      automatedEvidenceFiles: [
        ...new Set(
          plan.gateIds.flatMap((gateId) =>
            gateDefinitions[gateId]?.kind === "AUTOMATED" ? gateDefinitions[gateId].files : [],
          ),
        ),
      ].sort(compareStrings),
      exactClosureGate: plan.closureGate,
      acceptanceFromFrozenRegister: defect.acceptance,
    };
  });

  const countsByDisposition = requirements.reduce((counts, requirement) => {
    counts[requirement.disposition] = (counts[requirement.disposition] ?? 0) + 1;
    return counts;
  }, {});

  return {
    schemaVersion: 1,
    artifactStatus: "PRE_RUNTIME_DRAFT_DO_NOT_APPLY",
    generatedForCutoff: "2026-08-31",
    purpose:
      "Evidence planning only. This file is not an updater manifest, does not change readiness-current.json or the defect register, and reports no improved score.",
    failClosedRules: [
      "Source inspection and test discovery are not PASS evidence.",
      "Candidate PASS means PASS only if every named gate completes successfully against the final source cutoff and covers the exact requirement wording.",
      "A broad suite result must be paired with the named assertion file; aggregate counts alone are insufficient.",
      "External, legal, native identity, manual accessibility, and product-decision gates cannot be inferred from local automation.",
      "The frozen route denominators remain 132 exact supplied forms and 116 canonical patterns even though current route inventory may contain additional routes.",
    ],
    sourceSnapshots: {
      tracker: { path: trackerPath, sha256: sha256(trackerText), requirements: 230 },
      defectRegister: { path: defectRegisterPath, sha256: sha256(defectsText), defects: 26 },
      routeExactMatrix: {
        path: exactMatrixPath,
        sha256: sha256(exactMatrixText),
        rows: exactMatrixText.trimEnd().split("\n").length - 1,
      },
      routeCanonicalMatrix: {
        path: canonicalMatrixPath,
        sha256: sha256(canonicalMatrixText),
        rows: canonicalMatrixText.trimEnd().split("\n").length - 1,
      },
      workflowMatrix: {
        path: workflowMatrixPath,
        sha256: sha256(workflowMatrixText),
        rows: workflowMatrixText.trimEnd().split("\n").length - 1,
      },
    },
    summary: {
      requirements: requirements.length,
      defects: defects.length,
      countsByDisposition,
      scoreReported: false,
      officialFilesMutated: false,
    },
    evidenceGates: gateDefinitions,
    immutableBoundaries: [
      {
        id: "LEGAL_COUNSEL",
        requirementIds: [requirementId("0014")],
        defectIds: ["PUBLIC-002"],
      },
      {
        id: "EXTERNAL_PROVIDERS",
        requirementIds: [
          requirementId("0083"),
          requirementId("0118"),
          requirementId("0180"),
          requirementId("0182"),
        ],
        defectIds: [],
      },
      {
        id: "MANUAL_ACCESSIBILITY",
        requirementIds: [requirementId("0196"), requirementId("0199"), requirementId("0200")],
        defectIds: ["PUBLIC-008"],
      },
      {
        id: "NATIVE_RELEASE_IDENTITY",
        requirementIds: [requirementId("0226"), requirementId("0227")],
        defectIds: ["PUBLIC-009"],
      },
      {
        id: "PRODUCT_DECISION_D009",
        requirementIds: [
          requirementId("0060"),
          requirementId("0084"),
          requirementId("0085"),
          requirementId("0166"),
          requirementId("0169"),
        ],
        defectIds: ["BZR-PRD-001"],
      },
    ],
    supportingMetricsPlan: {
      status: "RECOMPUTE_AFTER_FINAL_RUNTIME_DO_NOT_COPY_CANDIDATE_COUNTS",
      updaterContract:
        "supportingMetrics must be { value: <all five metric families>, evidence: <non-empty typed evidence[]> }; update-readiness.mjs requires exact route totals of 132 and 116.",
      frozenDenominators: {
        exactRouteForms: 132,
        canonicalRoutePatterns: 116,
        workflows: 85,
      },
      baselineShapeValueForReferenceOnly: tracker.supportingMetrics,
      requiredEvidenceFiles: [
        exactMatrixPath,
        canonicalMatrixPath,
        workflowMatrixPath,
        "tests/unit/route-inventory-reconciliation.test.ts",
        "tests/e2e/public-routes.spec.ts",
        "tests/e2e/authenticated/authenticated-routes.spec.ts",
        "tests/e2e/authenticated/authenticated-acceptance-navigation.spec.ts",
      ],
      finalizationRules: [
        "routes.exact PASS+PARTIAL+FAIL+BLOCKED must equal 132 and routes.canonical must equal 116",
        "workflows PASS+PARTIAL+FAIL+BLOCKED must equal total and executed must equal PASS+PARTIAL+FAIL",
        "role names must account for every expected role, be disjoint, and match credentialed count",
        "desktop/tablet/mobile exact-form totals must each remain 132",
        "localization locale/prefix lists and assertion totals must be evidence-derived",
        "use typed file evidence for the frozen matrices and typed command evidence with exact exit code and result counts",
      ],
    },
    requirements,
    defects,
  };
};

const validateLedger = async (ledger) => {
  const tracker = await readJson(trackerPath);
  const defectRegister = await readJson(defectRegisterPath);
  if (ledger.artifactStatus !== "PRE_RUNTIME_DRAFT_DO_NOT_APPLY") {
    throw new Error("Ledger is not marked PRE_RUNTIME_DRAFT_DO_NOT_APPLY");
  }
  const expectedRequirementIds = tracker.requirements.map(({ id }) => id).sort(compareStrings);
  const actualRequirementIds = ledger.requirements.map(({ id }) => id).sort(compareStrings);
  if (new Set(actualRequirementIds).size !== 230 || actualRequirementIds.length !== 230) {
    throw new Error(
      `Requirement accounting is not exactly 230 unique rows: ${actualRequirementIds.length}`,
    );
  }
  if (JSON.stringify(expectedRequirementIds) !== JSON.stringify(actualRequirementIds)) {
    throw new Error("Requirement ID set differs from the frozen tracker");
  }
  const expectedDefectIds = defectRegister.defects.map(({ id }) => id).sort(compareStrings);
  const actualDefectIds = ledger.defects.map(({ id }) => id).sort(compareStrings);
  if (new Set(actualDefectIds).size !== 26 || actualDefectIds.length !== 26) {
    throw new Error(`Defect accounting is not exactly 26 unique rows: ${actualDefectIds.length}`);
  }
  if (JSON.stringify(expectedDefectIds) !== JSON.stringify(actualDefectIds)) {
    throw new Error("Defect ID set differs from the frozen register");
  }
  if (
    ledger.sourceSnapshots.routeExactMatrix.rows !== 132 ||
    ledger.sourceSnapshots.routeCanonicalMatrix.rows !== 116 ||
    ledger.sourceSnapshots.workflowMatrix.rows !== 85
  ) {
    throw new Error(
      "Frozen matrix row counts drifted from 132 exact / 116 canonical / 85 workflows",
    );
  }
  const allRows = [...ledger.requirements, ...ledger.defects];
  for (const row of allRows) {
    if (!Array.isArray(row.gateIds) || row.gateIds.length === 0) {
      throw new Error(`${row.id} has no evidence gate`);
    }
    for (const gateId of row.gateIds) {
      if (!ledger.evidenceGates[gateId])
        throw new Error(`${row.id} references unknown gate ${gateId}`);
    }
  }
  for (const requirement of ledger.requirements) {
    if (
      requirement.disposition === "CANDIDATE_PASS_AFTER_ALL_GATES" &&
      requirement.automatedEvidenceFiles.length === 0
    ) {
      throw new Error(`${requirement.id} is a candidate PASS without specific automated files`);
    }
    const trackerRequirement = tracker.requirements.find(({ id }) => id === requirement.id);
    if (requirement.fingerprint !== trackerRequirement.fingerprint) {
      throw new Error(`${requirement.id} fingerprint differs from the frozen tracker`);
    }
  }
  const referencedFiles = new Set([
    ...Object.values(ledger.evidenceGates).flatMap(({ files }) => files),
    ...ledger.supportingMetricsPlan.requiredEvidenceFiles,
  ]);
  for (const relativePath of referencedFiles) {
    await access(repoPath(relativePath));
  }
  const exact = ledger.supportingMetricsPlan.baselineShapeValueForReferenceOnly.routes.exact;
  const canonical =
    ledger.supportingMetricsPlan.baselineShapeValueForReferenceOnly.routes.canonical;
  if (exact.total !== 132 || canonical.total !== 116) {
    throw new Error("Supporting metric reference does not preserve frozen route denominators");
  }
  if (ledger.summary.scoreReported !== false || ledger.summary.officialFilesMutated !== false) {
    throw new Error("Draft must report no score and no official mutation");
  }
};

const expected = await buildLedger();
await validateLedger(expected);

if (process.argv.includes("--write")) {
  await writeFile(repoPath(outputPath), `${JSON.stringify(expected, null, 2)}\n`, "utf8");
  console.log(
    `Wrote PRE-RUNTIME draft: ${outputPath} (${expected.requirements.length} requirements, ${expected.defects.length} defects)`,
  );
} else {
  const actual = await readJson(outputPath);
  await validateLedger(actual);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      "Draft ledger is stale; rerun this script with --write after reviewing source changes",
    );
  }
  console.log(
    `Validated PRE-RUNTIME draft: 230/230 requirements, 26/26 defects, 132 exact routes, 116 canonical routes, 85 workflows; no score or official mutation`,
  );
}
