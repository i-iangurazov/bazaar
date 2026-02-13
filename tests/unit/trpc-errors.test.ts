import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { AppError } from "@/server/services/errors";
import { toTRPCError } from "@/server/trpc/errors";

describe("toTRPCError", () => {
  it("maps AppError code and message", () => {
    const error = new AppError("forbidden", "FORBIDDEN", 403);
    const mapped = toTRPCError(error);

    expect(mapped).toBeInstanceOf(TRPCError);
    expect(mapped.code).toBe("FORBIDDEN");
    expect(mapped.message).toBe("forbidden");
  });

  it("maps infra timeout errors to serviceUnavailable", () => {
    const timeoutError = new Error("connect ETIMEDOUT") as Error & { code?: string };
    timeoutError.code = "ETIMEDOUT";

    const mapped = toTRPCError(timeoutError);

    expect(mapped).toBeInstanceOf(TRPCError);
    expect(mapped.code).toBe("INTERNAL_SERVER_ERROR");
    expect(mapped.message).toBe("serviceUnavailable");
  });

  it("maps unknown errors to genericMessage", () => {
    const mapped = toTRPCError(new Error("unknown boom"));

    expect(mapped).toBeInstanceOf(TRPCError);
    expect(mapped.code).toBe("INTERNAL_SERVER_ERROR");
    expect(mapped.message).toBe("genericMessage");
  });
});
