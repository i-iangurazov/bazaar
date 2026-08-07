import { beforeEach, describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("@/server/logging", () => ({ getLogger: () => logger }));

import { mapBazaarApiError } from "@/app/api/bazaar/v1/error-response";
import { AppError } from "@/server/services/errors";

describe("Bazaar API error responses", () => {
  beforeEach(() => logger.error.mockClear());

  it("preserves safe client errors and their status", () => {
    expect(mapBazaarApiError(new AppError("productNotFound", "NOT_FOUND", 404), "test")).toEqual({
      message: "productNotFound",
      status: 404,
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each([
    new Error("password authentication failed for database bazaar"),
    new AppError("provider-secret-token", "INTERNAL_SERVER_ERROR", 502),
    { providerError: "raw-provider-body" },
  ])("maps internal failures to one safe public response", (error) => {
    const result = mapBazaarApiError(error, "orders.create");

    expect(result).toEqual({ message: "genericMessage", status: 500 });
    expect(JSON.stringify(result)).not.toContain("password");
    expect(JSON.stringify(result)).not.toContain("provider");
    expect(logger.error).toHaveBeenCalledWith(
      { endpoint: "orders.create", error },
      "Bazaar API request failed",
    );
  });
});
