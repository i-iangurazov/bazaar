import { Role } from "@prisma/client";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import superjson from "superjson";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/services/errors";
import { inventoryRouter } from "@/server/trpc/routers/inventory";
import type { Context } from "@/server/trpc/trpc";

const posServiceMocks = vi.hoisted(() => ({
  editCompletedPosSale: vi.fn(),
  editCompletedSaleReturn: vi.fn(),
  getPosSale: vi.fn(),
  getSaleReturn: vi.fn(),
}));

vi.mock("@/server/services/pos", () => posServiceMocks);

type ErrorBody = {
  error: {
    json: {
      message: string;
      data: { code: string; httpStatus: number; path: string; requestId: string };
    };
  };
};

const createContext = (requestId: string) => {
  const storeFindFirst = vi.fn().mockResolvedValue(null);
  const context = {
    prisma: {
      store: { findFirst: storeFindFirst },
    },
    user: {
      id: "primary-admin",
      email: "primary-admin@example.test",
      role: Role.ADMIN,
      organizationId: "primary-organization",
      isPlatformOwner: false,
      isOrgOwner: false,
    },
    impersonator: null,
    impersonationSessionId: null,
    ip: null,
    requestId,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
    },
  } as unknown as Context;

  return { context, storeFindFirst };
};

const requestProcedure = async (path: string, value: unknown, context: Context) => {
  const input = superjson.serialize(value);
  const request = new Request(
    `http://localhost/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`,
  );
  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: inventoryRouter,
    createContext: async () => context,
  });

  return { response, body: (await response.json()) as ErrorBody };
};

const expectForbiddenResponse = (
  response: Response,
  body: ErrorBody,
  path: string,
  requestId: string,
) => {
  expect(response.status).toBe(403);
  expect(body.error.json).toMatchObject({
    message: "storeAccessDenied",
    data: {
      code: "FORBIDDEN",
      httpStatus: 403,
      path,
      requestId,
    },
  });
};

const directStoreGuardCases = [
  { path: "list", input: { storeId: "foreign-store", page: 1, pageSize: 25 } },
  { path: "listIds", input: { storeId: "foreign-store" } },
  { path: "searchProducts", input: { storeId: "foreign-store" } },
  { path: "movements", input: { storeId: "foreign-store", productId: "product-1" } },
] as const;

describe("inventory router error mapping", () => {
  beforeEach(() => {
    posServiceMocks.editCompletedPosSale.mockReset();
    posServiceMocks.editCompletedSaleReturn.mockReset();
    posServiceMocks.getPosSale.mockReset();
    posServiceMocks.getSaleReturn.mockReset();
  });

  it.each(directStoreGuardCases)(
    "serializes a foreign-store $path denial as FORBIDDEN HTTP 403",
    async ({ path, input }) => {
      const requestId = `inventory-${path}-foreign-store`;
      const { context, storeFindFirst } = createContext(requestId);
      const { response, body } = await requestProcedure(path, input, context);

      expectForbiddenResponse(response, body, path, requestId);
      expect(storeFindFirst).toHaveBeenCalledWith({
        where: { id: "foreign-store", organizationId: "primary-organization" },
        select: { id: true },
      });
    },
  );

  it("maps the editable return document's route-level store guard", async () => {
    posServiceMocks.getSaleReturn.mockResolvedValue({ storeId: "foreign-store" });
    const requestId = "inventory-editable-return-foreign-store";
    const { context, storeFindFirst } = createContext(requestId);
    const path = "editableProductMovementDocument";
    const { response, body } = await requestProcedure(
      path,
      { documentKey: "RETURN:SaleReturn:return-1" },
      context,
    );

    expectForbiddenResponse(response, body, path, requestId);
    expect(posServiceMocks.getSaleReturn).toHaveBeenCalledWith({
      organizationId: "primary-organization",
      saleReturnId: "return-1",
    });
    expect(storeFindFirst).toHaveBeenCalledWith({
      where: { id: "foreign-store", organizationId: "primary-organization" },
      select: { id: true },
    });
  });

  it("maps an editable sale document's service-level store guard", async () => {
    posServiceMocks.getPosSale.mockRejectedValue(
      new AppError("storeAccessDenied", "FORBIDDEN", 403),
    );
    const requestId = "inventory-editable-sale-foreign-store";
    const { context, storeFindFirst } = createContext(requestId);
    const path = "editableProductMovementDocument";
    const { response, body } = await requestProcedure(
      path,
      { documentKey: "SALE:CustomerOrder:sale-1" },
      context,
    );

    expectForbiddenResponse(response, body, path, requestId);
    expect(posServiceMocks.getPosSale).toHaveBeenCalledWith({
      organizationId: "primary-organization",
      saleId: "sale-1",
      user: context.user,
    });
    expect(storeFindFirst).not.toHaveBeenCalled();
  });
});
