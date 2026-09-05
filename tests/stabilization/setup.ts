import { afterAll, beforeAll, vi } from "vitest";
import { assertStabilizationDatabase } from "../../scripts/stabilization/environment";
import { prisma } from "@/server/db/prisma";

assertStabilizationDatabase();

// Providers are always isolated; unexpected fetches fail rather than reaching real services.
vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External fetch forbidden in stabilization tests"); }));

// No excluded workflow module is loaded or exercised through an in-scope caller.
vi.mock("@/server/services/inventory", () => ({
  applyStockMovement: () => { throw new Error("Inventory operation excluded from stabilization"); },
}));

beforeAll(async () => {
  const [identity] = await prisma.$queryRaw<{ database: string; username: string }[]>`
    SELECT current_database() AS database, current_user AS username
  `;
  if (identity.database !== "bazaar_hardening_ci" || identity.username !== "bazaar_test") {
    throw new Error("Connected database identity is not disposable stabilization.");
  }
});

afterAll(async () => { await prisma.$disconnect(); });
