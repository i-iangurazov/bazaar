import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { classifyDatabaseOperationFailure } from "@/server/services/databaseOperationFailure";
import { AppError } from "@/server/services/errors";

describe("classifyDatabaseOperationFailure", () => {
  it("marks domain and known Prisma transaction failures retryable", () => {
    const domainFailure = classifyDatabaseOperationFailure(
      new AppError("inventorySelectionInvalid", "FORBIDDEN", 403),
      "inventoryBulkSetOnHandFailed",
    );
    const knownDatabaseFailure = classifyDatabaseOperationFailure(
      new Prisma.PrismaClientKnownRequestError("unique constraint", {
        code: "P2002",
        clientVersion: Prisma.prismaVersion.client,
      }),
      "productsCreateFailed",
    );

    expect(domainFailure).toEqual({
      classification: "SAFE_BEFORE_EFFECTS",
      responseCode: "inventoryBulkSetOnHandFailed",
      responseStatus: 500,
    });
    expect(knownDatabaseFailure.classification).toBe("SAFE_BEFORE_EFFECTS");
  });

  it("keeps unknown runtime failures ambiguous", () => {
    expect(
      classifyDatabaseOperationFailure(new Error("connection outcome unknown"), "operationFailed"),
    ).toEqual({
      classification: "AMBIGUOUS",
      responseCode: "operationFailed",
      responseStatus: 500,
    });
  });
});
