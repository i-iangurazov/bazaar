import { describe, expect, it } from "vitest";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import { initTRPC } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import superjson from "superjson";

import { buildQuickProductDuplicateInput } from "@/lib/productDuplication";
import { duplicateProductInputSchema } from "@/server/trpc/routers/products.schemas";

const t = initTRPC.create({ transformer: superjson });
const router = t.router({
  duplicate: t.procedure.input(duplicateProductInputSchema).mutation(({ input }) => input),
});

describe("product duplication batch transport", () => {
  it("preserves store and duplicate options through the real client/server batch envelope", async () => {
    const client = createTRPCProxyClient<typeof router>({
      transformer: superjson,
      links: [httpBatchLink({
        url: "http://localhost/api/trpc",
        fetch: (url, options) => fetchRequestHandler({
          endpoint: "/api/trpc", router,
          req: new Request(String(url), options as RequestInit),
          createContext: () => ({}),
        }),
      })],
    });
    const input = buildQuickProductDuplicateInput({
      productId: "product-1", storeId: "store-2", idempotencyKey: "duplicate-product-1",
    });
    expect(await client.duplicate.mutate(input)).toMatchObject(input);
  });

  it("reproduces the reported 400 when a batch URL is opened without its request input", async () => {
    const response = await fetchRequestHandler({
      endpoint: "/api/trpc", router,
      req: new Request("http://localhost/api/trpc/duplicate?batch=1"),
      createContext: () => ({}),
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('needs to be an object when doing a batch call');
  });
});
