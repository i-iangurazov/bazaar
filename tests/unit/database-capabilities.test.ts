import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { assertUnicodeCaseInsensitiveSearch } from "@/server/db/databaseCapabilities";

const capabilityClient = (supported: boolean) =>
  ({
    $queryRaw: vi.fn().mockResolvedValue([{ supported }]),
  }) as unknown as PrismaClient;

describe("database capabilities", () => {
  it("accepts Unicode-aware case-insensitive search", async () => {
    await expect(
      assertUnicodeCaseInsensitiveSearch(capabilityClient(true)),
    ).resolves.toBeUndefined();
  });

  it("fails closed when the database cannot case-fold Cyrillic", async () => {
    await expect(assertUnicodeCaseInsensitiveSearch(capabilityClient(false))).rejects.toThrow(
      "Database collation does not provide Unicode-aware case folding",
    );
  });
});
