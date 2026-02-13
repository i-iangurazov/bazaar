import { router } from "@/server/trpc/trpc";
import { inventoryRouter } from "@/server/trpc/routers/inventory";
import { productsRouter } from "@/server/trpc/routers/products";
import { storesRouter } from "@/server/trpc/routers/stores";
import { purchaseOrdersRouter } from "@/server/trpc/routers/purchaseOrders";
import { salesOrdersRouter } from "@/server/trpc/routers/salesOrders";
import { dashboardRouter } from "@/server/trpc/routers/dashboard";
import { forecastRouter } from "@/server/trpc/routers/forecast";
import { usersRouter } from "@/server/trpc/routers/users";
import { suppliersRouter } from "@/server/trpc/routers/suppliers";
import { stockCountsRouter } from "@/server/trpc/routers/stockCounts";
import { storePricesRouter } from "@/server/trpc/routers/storePrices";
import { stockLotsRouter } from "@/server/trpc/routers/stockLots";
import { bundlesRouter } from "@/server/trpc/routers/bundles";
import { attributesRouter } from "@/server/trpc/routers/attributes";
import { categoryTemplatesRouter } from "@/server/trpc/routers/categoryTemplates";
import { unitsRouter } from "@/server/trpc/routers/units";
import { reportsRouter } from "@/server/trpc/routers/reports";
import { complianceRouter } from "@/server/trpc/routers/compliance";
import { exportsRouter } from "@/server/trpc/routers/exports";
import { periodCloseRouter } from "@/server/trpc/routers/periodClose";
import { importsRouter } from "@/server/trpc/routers/imports";
import { onboardingRouter } from "@/server/trpc/routers/onboarding";
import { adminJobsRouter } from "@/server/trpc/routers/adminJobs";
import { adminSupportRouter } from "@/server/trpc/routers/adminSupport";
import { adminMetricsRouter } from "@/server/trpc/routers/adminMetrics";
import { impersonationRouter } from "@/server/trpc/routers/impersonation";
import { publicAuthRouter } from "@/server/trpc/routers/publicAuth";
import { invitesRouter } from "@/server/trpc/routers/invites";
import { billingRouter } from "@/server/trpc/routers/billing";
import { searchRouter } from "@/server/trpc/routers/search";
import { analyticsRouter } from "@/server/trpc/routers/analytics";
import { platformOwnerRouter } from "@/server/trpc/routers/platformOwner";
import { diagnosticsRouter } from "@/server/trpc/routers/diagnostics";
import { guidanceRouter } from "@/server/trpc/routers/guidance";
import { userSettingsRouter } from "@/server/trpc/routers/userSettings";
import { orgSettingsRouter } from "@/server/trpc/routers/orgSettings";
import { posRouter } from "@/server/trpc/routers/pos";

export const appRouter = router({
  inventory: inventoryRouter,
  products: productsRouter,
  stores: storesRouter,
  purchaseOrders: purchaseOrdersRouter,
  salesOrders: salesOrdersRouter,
  dashboard: dashboardRouter,
  forecast: forecastRouter,
  users: usersRouter,
  suppliers: suppliersRouter,
  stockCounts: stockCountsRouter,
  storePrices: storePricesRouter,
  stockLots: stockLotsRouter,
  bundles: bundlesRouter,
  attributes: attributesRouter,
  categoryTemplates: categoryTemplatesRouter,
  units: unitsRouter,
  reports: reportsRouter,
  compliance: complianceRouter,
  exports: exportsRouter,
  periodClose: periodCloseRouter,
  imports: importsRouter,
  onboarding: onboardingRouter,
  adminJobs: adminJobsRouter,
  adminSupport: adminSupportRouter,
  adminMetrics: adminMetricsRouter,
  impersonation: impersonationRouter,
  publicAuth: publicAuthRouter,
  invites: invitesRouter,
  billing: billingRouter,
  search: searchRouter,
  analytics: analyticsRouter,
  platformOwner: platformOwnerRouter,
  diagnostics: diagnosticsRouter,
  guidance: guidanceRouter,
  userSettings: userSettingsRouter,
  orgSettings: orgSettingsRouter,
  pos: posRouter,
});

export type AppRouter = typeof appRouter;
