import { describe, expect, it, vi } from "vitest";
vi.mock("@/server/db/prisma", () => ({ prisma: {} }));
vi.mock("@/server/services/planLimits", () => ({
  getOrganizationPlan: vi.fn(async () => ({ billingCatalogVersion: "2026-10", lifetimeAccess: false })),
}));
import { reserveAiCallBudget, withAiOperationBudget } from "@/server/billing/aiOperationBudget";
import { aiExpenseMinor, imageExpenseMinor } from "@/server/billing/providerExpense";

const scope = <T>(run: () => Promise<T>, org = "one", units = 1) =>
  withAiOperationBudget({ organizationId: org, enabled: true, units }, run);

describe("AI request expenditure boundaries", () => {
  it("leaves old contracts and calls outside a metered operation unchanged", async () => {
    const body = { input: "hello", max_output_tokens: 20000 };
    expect(reserveAiCallBudget(body)).toMatchObject({ active: false, body });
    await withAiOperationBudget({ organizationId: "legacy" }, async () => {
      expect(reserveAiCallBudget(body).active).toBe(false);
    });
  });
  it("shares the ceiling between nested tools and caps unreported retries", async () => {
    await scope(async () => {
      const first = reserveAiCallBudget({ input: "one", max_output_tokens: 4000 });
      first.finish(); first.finish({ output_tokens: 0 });
      await scope(async () => {
        const second = reserveAiCallBudget({ input: "two", max_output_tokens: 4000 });
        expect(second.body.max_output_tokens).toBe(2000);
        second.finish();
      });
      expect(() => reserveAiCallBudget({ input: "third" })).toThrow("billingAiRequestTooLarge");
    });
  });
  it("uses actual output to release pending capacity but bounds provider call count", async () => {
    await scope(async () => {
      for (let i = 0; i < 8; i++) {
        reserveAiCallBudget({ input: "short", max_output_tokens: 6000 })
          .finish({ input_tokens: 10, output_tokens: 10 });
      }
      expect(() => reserveAiCallBudget({ input: "ninth" })).toThrow("billingAiRequestTooLarge");
    });
  });
  it("does not oversubscribe concurrent pending responses", async () => {
    await scope(async () => {
      const one = reserveAiCallBudget({ input: "one", max_output_tokens: 4000 });
      const two = reserveAiCallBudget({ input: "two", max_output_tokens: 4000 });
      expect(two.body.max_output_tokens).toBe(2000);
      expect(() => reserveAiCallBudget({ input: "three" })).toThrow("billingAiRequestTooLarge");
      one.finish({ input_tokens: 5, output_tokens: 5 });
      expect(reserveAiCallBudget({ input: "four", max_output_tokens: 6000 }).body.max_output_tokens).toBe(3995);
      two.finish();
    });
  });
  it("isolates concurrent organizations and supports explicitly metered card batches", async () => {
    await Promise.all([scope(async () => {
      reserveAiCallBudget({ input: "one", max_output_tokens: 6000 }).finish();
      await Promise.resolve();
      expect(() => reserveAiCallBudget({ input: "done" })).toThrow();
    }), scope(async () => {
      await Promise.resolve();
      expect(reserveAiCallBudget({ input: "other", max_output_tokens: 9000 }).body.max_output_tokens).toBe(9000);
    }, "other", 2)]);
  });
  it("rejects oversized input before an external call and validates batch units", async () => {
    await scope(async () => {
      expect(() => reserveAiCallBudget({ input: "x".repeat(100000) })).toThrow("billingAiRequestTooLarge");
    });
    await expect(scope(async () => null, "one", 501)).rejects.toThrow("validationError");
  });
  it("accepts all four supported image attachments together with bounded system context", async () => {
    await scope(async () => {
      const call = reserveAiCallBudget({ input: [
        { type: "input_text", text: "x".repeat(20000) },
        ...Array.from({ length: 4 }, () => ({ type: "input_image", image_url: "synthetic" })),
      ] });
      expect(call.active).toBe(true);
      call.finish();
    });
  });
  it("rounds internal conservative token estimates upward without customer billing", () => {
    expect(aiExpenseMinor(1000000, 1000000)).toBe(15000);
    expect(aiExpenseMinor(1000000, 1000000, "deepseek-pro")).toBe(52800);
    expect(aiExpenseMinor(1, 0)).toBe(1);
    expect(imageExpenseMinor({ input_tokens: 1000, output_tokens: 1000 }, false, "gpt-image-2.5")).toBe(380);
    expect(imageExpenseMinor(null, false, "unknown")).toBe(2500);
    expect(imageExpenseMinor(null, true, "unknown")).toBe(7500);
  });
});
