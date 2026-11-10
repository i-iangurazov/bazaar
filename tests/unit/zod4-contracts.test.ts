import { initTRPC, type inferRouterInputs, type inferRouterOutputs } from "@trpc/server";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { optionalPriceInputSchema } from "@/lib/priceInput";
import { createLocalizedZodErrorMap } from "@/lib/zodErrorMap";
import { stockReceivingCommerceSchema } from "@/lib/stockReceivingCommerce";
import { subscriptionSelectionSchema } from "@/lib/billing/subscriptionPricing";
import { workflowValuesSchema } from "@/lib/baam/workflows";
import { baamToolSchema } from "@/server/services/baamToolContract";
import { describeWorkflowField } from "@/server/services/baamWorkflowCatalog";

const t = initTRPC.create();
const router = t.router({
  receive: t.procedure.input(stockReceivingCommerceSchema).mutation(({ input }) => input),
  selectPlan: t.procedure.input(subscriptionSelectionSchema).query(({ input }) => input),
});
type Inputs = inferRouterInputs<typeof router>;
type Outputs = inferRouterOutputs<typeof router>;
const receiving = { storeId: "store", lines: [{ productId: "product", quantity: 0.125, unitCost: 0 }] };

// This is an SDK compatibility proof, not a mocked tRPC parser: the installed
// v10 router must infer raw inputs, parse Zod 4 and return the validated output.
describe("Zod 4 preserves Bazaar's boundary contracts", () => {
  it("keeps tRPC 10 input/output inference and validation without a router major migration", async () => {
    expectTypeOf<Inputs["selectPlan"]>().toMatchTypeOf<{ plan: "STARTER" | "BUSINESS" | "ENTERPRISE"; months?: 1 | 6 | 12 }>();
    expectTypeOf<Outputs["selectPlan"]["months"]>().toEqualTypeOf<1 | 6 | 12>();
    const caller = router.createCaller({});
    expect(await caller.receive(receiving)).toEqual(receiving);
    expect(await caller.selectPlan({ plan: "BUSINESS" })).toEqual({ plan: "BUSINESS", months: 1, extras: { stores: 0, productPacks: 0, userPacks: 0 } });
    await expect(caller.receive({ ...receiving, lines: [{ ...receiving.lines[0], quantity: 0.0001 }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.selectPlan({ plan: "BUSINESS", months: 2 as 1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("keeps zero selling prices distinct from omitted prices and rejects imprecise money", () => {
    const preserved = stockReceivingCommerceSchema.parse(receiving);
    expect(preserved.lines[0]).not.toHaveProperty("salePriceKgs");
    expect(stockReceivingCommerceSchema.parse({ ...receiving, lines: [{ ...receiving.lines[0], salePriceKgs: 0 }] }).lines[0].salePriceKgs).toBe(0);
    for (const value of [-1, 0.001, Infinity, NaN, "10", null]) {
      expect(stockReceivingCommerceSchema.safeParse({ ...receiving, lines: [{ ...receiving.lines[0], unitCost: value }] }).success, String(value)).toBe(false);
    }
    expect(stockReceivingCommerceSchema.safeParse({ ...receiving, lines: Array.from({ length: 501 }, () => receiving.lines[0]) }).success).toBe(false);
  });

  it("keeps cleared drafts absent and parses comma/period prices without silent rounding", () => {
    const price = optionalPriceInputSchema("invalid", "negative");
    for (const value of [null, undefined, "", "  "]) expect(price.parse(value)).toBeUndefined();
    expect(price.parse("0,00")).toBe(0);
    expect(price.parse("68,50")).toBe(68.5);
    expect(price.parse("68.50")).toBe(68.5);
    for (const value of ["68,501", "1e3", "10x", NaN]) expect(price.safeParse(value).success).toBe(false);
  });

  it("retains mutable default isolation and bounded optional records", () => {
    const one = subscriptionSelectionSchema.parse({ plan: "BUSINESS" });
    one.extras.stores = 2;
    expect(subscriptionSelectionSchema.parse({ plan: "BUSINESS" }).extras.stores).toBe(0);
    expect(workflowValuesSchema.parse({ lines: [{ productId: "p", qty: 0.125 }] })).toEqual({ lines: [{ productId: "p", qty: 0.125 }] });
    expect(workflowValuesSchema.safeParse(JSON.parse('{"__proto__":{"admin":true}}')).success).toBe(false);
    expect(workflowValuesSchema.safeParse(JSON.parse('{"lines":[{"__proto__":{"admin":true}}]}')).success).toBe(false);
    expect(workflowValuesSchema.safeParse({ lines: [{ constructor: "blocked" }] }).success).toBe(false);
    expect(workflowValuesSchema.safeParse({ lines: Array.from({ length: 41 }, () => "p") }).success).toBe(false);
    expect(workflowValuesSchema.safeParse({ field: "a".repeat(6001) }).success).toBe(false);
  });

  it.each([
    ["ru", "Поле обязательно.", "Введите число.", "Введите корректный email.", "Выберите минимум 2."],
    ["kg", "Талаа милдеттүү.", "Санды киргизиңиз.", "Туура email киргизиңиз.", "Кеминде 2 тандаңыз."],
    ["en", "This field is required.", "Enter a number.", "Enter a valid email.", "Select at least 2."],
  ])("keeps default and explicit validation messages localized in %s", (locale, required, number, email, array) => {
    const error = createLocalizedZodErrorMap(locale);
    const message = (schema: z.ZodType, input: unknown) => schema.safeParse(input, { error }).error?.issues[0]?.message;
    expect(message(z.string(), undefined)).toBe(required);
    expect(message(z.number(), "text")).toBe(number);
    expect(message(z.string().email(), "broken")).toBe(email);
    expect(message(z.array(z.string()).min(2), [])).toBe(array);
    expect(message(z.number().min(1, "custom-business-message"), 0)).toBe("custom-business-message");
  });

  it("keeps AI contracts closed, nullable for omitted fields, bounded and based on input transforms", () => {
    const schema = z.object({
      name: z.string().min(2).transform((value) => value.trim()),
      lines: z.array(z.object({ qty: z.number().multipleOf(0.001).positive(), price: z.number().min(0).optional() })).min(1).max(40),
      store: z.string().optional(),
    });
    const json = baamToolSchema(schema);
    expect(json).not.toHaveProperty("$schema");
    expect(JSON.stringify(json)).not.toContain('"$ref"');
    expect(json.required).toEqual(["name", "lines", "store"]);
    expect(json.additionalProperties).toBe(false);
    expect(json.properties?.name).toMatchObject({ type: "string", minLength: 2 });
    expect(json.properties?.lines).toMatchObject({ minItems: 1, maxItems: 40, items: { required: ["qty", "price"], additionalProperties: false } });
    expect(json.properties?.store).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] });
  });

  it("keeps workflow editor array limits, integer controls, enums and date inputs", () => {
    expect(describeWorkflowField("items", z.array(z.string()).min(2).max(7), "ru")).toMatchObject({ kind: "array", min: 2, max: 7 });
    expect(describeWorkflowField("count", z.number().int().min(1).max(20), "en")).toMatchObject({ kind: "number", integer: true, min: 1, max: 20 });
    expect(describeWorkflowField("cost", z.number().min(0), "en")).toMatchObject({ kind: "number", min: 0, max: undefined });
    expect(describeWorkflowField("delta", z.number(), "en")).toMatchObject({ min: undefined, max: undefined });
    expect(describeWorkflowField("date", z.string().datetime().optional(), "en")).toMatchObject({ kind: "date", required: false });
    expect(describeWorkflowField("status", z.nativeEnum({ OPEN: "OPEN", CLOSED: "CLOSED" }), "en")).toMatchObject({ kind: "select", options: [{ value: "OPEN" }, { value: "CLOSED" }] });
  });
});
