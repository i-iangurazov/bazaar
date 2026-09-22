import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { prisma } from "../../src/server/db/prisma";
import { createTestCaller } from "../../tests/helpers/context";
import { listProductCategoriesFromDb } from "../../src/server/services/productCategories";
const u = new URL(process.env.DATABASE_URL ?? "");
if (u.hostname !== "127.0.0.1" || u.port !== "55432") throw new Error("Local QA only");
const f = JSON.parse(readFileSync("/private/tmp/bazaar-qa-fixture.json", "utf8"));
const user = await prisma.user.findFirstOrThrow({
  where: { organizationId: f.orgId, role: "ADMIN" },
});
const caller = createTestCaller({ ...user, organizationId: f.orgId });
const cases: Record<string, () => Promise<unknown>> = {
  categories: () => listProductCategoriesFromDb(prisma, f.orgId),
  bootstrap: () => caller.products.bootstrap({ storeId: f.storeId, pageSize: 1 }),
  list: () => caller.products.list({ storeId: f.storeId, pageSize: 24, page: 1 }),
  form: () =>
    Promise.all([
      caller.products.getById({ productId: f.productId }),
      caller.products.storePricing({ productId: f.productId }),
    ]),
  registers: () => caller.pos.registers.list(),
  shift: () => caller.pos.shifts.current({ registerId: f.registerId }),
  search: () => caller.products.list({ storeId: f.storeId, search: "Кисточка 00", pageSize: 24 }),
  barcode: () => caller.products.lookupScan({ q: "0123456789012" }),
};
const result: Record<string, unknown> = {
  catalog: await prisma.product.count({ where: { organizationId: f.orgId } }),
};
for (const [name, run] of Object.entries(cases)) {
  const times = [];
  for (let i = 0; i < 7; i++) {
    const t = performance.now();
    await run();
    times.push(Math.round((performance.now() - t) * 10) / 10);
  }
  const repeated = times.slice(1).sort((a, b) => a - b);
  result[name] = { first: times[0], median: (repeated[2] + repeated[3]) / 2, max: Math.max(...repeated), runs: times };
}
writeFileSync(
  `/private/tmp/bazaar-profile-${process.argv[2] ?? "before"}.json`,
  JSON.stringify(result, null, 2),
);
console.log(result);
await prisma.$disconnect();
