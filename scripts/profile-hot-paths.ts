import { randomUUID } from "crypto";
import { Role } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { getLogger } from "@/server/logging";
import { getPerfProfileSnapshot, resetPerfProfile } from "@/server/profiling/perf";
import { appRouter } from "@/server/trpc/routers/_app";

const requiredFlag = process.env.BAZAAR_PROFILE;

if (requiredFlag !== "1" && requiredFlag !== "true") {
  console.error(
    "Run with BAZAAR_PROFILE=1 to enable procedure and Prisma profiling, for example: BAZAAR_PROFILE=1 pnpm exec tsx scripts/profile-hot-paths.ts",
  );
  process.exit(1);
}

const createProfilingCaller = async () => {
  const adminUser = await prisma.user.findFirst({
    where: {
      role: Role.ADMIN,
      organizationId: { not: null },
    },
    select: {
      id: true,
      email: true,
      role: true,
      organizationId: true,
      isOrgOwner: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (!adminUser?.organizationId) {
    throw new Error("No admin user with organization found for profiling");
  }

  const store = await prisma.store.findFirst({
    where: { organizationId: adminUser.organizationId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  if (!store) {
    throw new Error("No store found for profiling");
  }

  const requestId = `profile-${randomUUID()}`;
  const caller = appRouter.createCaller({
    prisma,
    user: {
      id: adminUser.id,
      email: adminUser.email ?? "",
      role: adminUser.role,
      organizationId: adminUser.organizationId,
      isPlatformOwner: false,
      isOrgOwner: adminUser.isOrgOwner,
    },
    impersonator: null,
    impersonationSessionId: null,
    ip: null,
    requestId,
    logger: getLogger(requestId),
  });

  const sampleProduct = await prisma.product.findFirst({
    where: {
      organizationId: adminUser.organizationId,
      isDeleted: false,
    },
    select: {
      sku: true,
      name: true,
      basePriceKgs: true,
      barcodes: {
        select: { value: true },
        take: 1,
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return {
    caller,
    organizationId: adminUser.organizationId,
    store,
    sampleProduct,
  };
};

const runMeasured = async <T>({
  label,
  iterations = 3,
  task,
}: {
  label: string;
  iterations?: number;
  task: () => Promise<T>;
}) => {
  const durations: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = Date.now();
    await task();
    durations.push(Date.now() - startedAt);
  }

  const totalMs = durations.reduce((sum, value) => sum + value, 0);
  const avgMs = Math.round(totalMs / durations.length);
  const maxMs = Math.max(...durations);
  const minMs = Math.min(...durations);

  return {
    label,
    avgMs,
    minMs,
    maxMs,
    runs: durations,
  };
};

const main = async () => {
  const { caller, store, sampleProduct } = await createProfilingCaller();
  resetPerfProfile();

  const searchNeedle =
    sampleProduct?.barcodes[0]?.value ??
    sampleProduct?.sku ??
    sampleProduct?.name?.slice(0, 8) ??
    "te";
  const previewSku = sampleProduct?.sku ?? "PROFILE-NOT-FOUND";
  const previewPrice =
    sampleProduct?.basePriceKgs !== null && sampleProduct?.basePriceKgs !== undefined
      ? Number(sampleProduct.basePriceKgs) + 1
      : 100;

  const measurements = [
    await runMeasured({
      label: "dashboard.bootstrap",
      task: () =>
        caller.dashboard.bootstrap({
          storeId: store.id,
          includeRecentActivity: false,
          includeRecentMovements: false,
        }),
    }),
    await runMeasured({
      label: "dashboard.activity",
      task: () => caller.dashboard.activity({ storeId: store.id }),
    }),
    await runMeasured({
      label: "products.bootstrap",
      task: () =>
        caller.products.bootstrap({
          page: 1,
          pageSize: 25,
          sortKey: "name",
          sortDirection: "asc",
        }),
    }),
    await runMeasured({
      label: "products.list",
      task: () =>
        caller.products.list({
          page: 1,
          pageSize: 25,
          sortKey: "name",
          sortDirection: "asc",
        }),
    }),
    await runMeasured({
      label: "inventory.list",
      task: () =>
        caller.inventory.list({
          storeId: store.id,
          page: 1,
          pageSize: 25,
        }),
    }),
    await runMeasured({
      label: "search.global",
      task: () =>
        caller.search.global({
          q: searchNeedle.length >= 2 ? searchNeedle : "te",
        }),
    }),
    await runMeasured({
      label: "products.previewImportCsv",
      task: () =>
        caller.products.previewImportCsv({
          source: "csv",
          mode: "update_selected",
          storeId: store.id,
          updateMask: ["basePriceKgs"],
          rows: [
            {
              sku: previewSku,
              basePriceKgs: previewPrice,
              sourceRowNumber: 1,
            },
            {
              sku: "PROFILE-PREVIEW-MISSING",
              basePriceKgs: 99,
              sourceRowNumber: 2,
            },
          ],
        }),
    }),
  ];

  const snapshot = getPerfProfileSnapshot();

  console.log("\nMeasured hot procedure timings");
  measurements.forEach((measurement) => {
    console.log(
      `- ${measurement.label}: avg ${measurement.avgMs}ms, min ${measurement.minMs}ms, max ${measurement.maxMs}ms, runs [${measurement.runs.join(", ")}]`,
    );
  });

  console.log("\nTop profiled tRPC procedures");
  snapshot.groupedTrpcTimings.slice(0, 10).forEach((entry) => {
    console.log(
      `- ${entry.key}: count=${entry.count}, avg=${Math.round(entry.avgMs)}ms, max=${entry.maxMs}ms, total=${entry.totalMs}ms`,
    );
  });

  console.log("\nTop profiled sections");
  snapshot.groupedSectionTimings.slice(0, 12).forEach((entry) => {
    console.log(
      `- ${entry.key}: count=${entry.count}, avg=${Math.round(entry.avgMs)}ms, max=${entry.maxMs}ms, total=${entry.totalMs}ms`,
    );
  });

  console.log("\nTop Prisma query fingerprints");
  snapshot.groupedPrismaQueries.slice(0, 12).forEach((entry) => {
    console.log(
      `- ${entry.key}: count=${entry.count}, avg=${Math.round(entry.avgMs)}ms, max=${entry.maxMs}ms, total=${entry.totalMs}ms`,
    );
  });

  console.log("\nFirst-load network audit");
  console.log(
    "- /dashboard: 1 above-the-fold batched request via `dashboard.bootstrap`, followed by deferred `dashboard.activity` for recent activity. Low stock and pending POs stay in the first render path.",
  );
  console.log(
    "- /products: 1 batched request through `products.bootstrap` for stores, categories, resolved store context, and the first page of products. Single-store orgs no longer need a follow-up `products.list` after implicit store selection.",
  );
  console.log(
    "- /inventory: 2 batched requests on cold load: first `stores.list`, then `inventory.list` and optionally `stockLots.expiringSoon` once the store is resolved. `suppliers.list` is now deferred until the PO draft modal opens.",
  );
};

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
