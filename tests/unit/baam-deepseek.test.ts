import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/server/db/prisma", () => ({ prisma: {} }));
vi.mock("@/server/config/runtime", async (original) => ({
  ...(await original<typeof import("@/server/config/runtime")>()),
  assertExternalProviderCallAllowed: vi.fn(),
}));
import { understandBaamIntent, parseBaamFastIntent } from "@/server/services/baamWorkflowIntent";
import { parseLocalBaamProductPlan } from "@/server/services/baamProductPlan";
const args = {
  text: "Synthetic question",
  locale: "ru",
  history: [],
  signal: new AbortController().signal,
  record: () => {},
};
const plan = (extra = {}) => ({
  kind: "answer",
  action: null,
  confidence: "high",
  fields: [],
  query: null,
  dateFrom: null,
  dateTo: null,
  period: null,
  recordKind: null,
  reply: "Полезный ответ",
  ...extra,
});
const call = (extra = {}) => ({
  type: "function_call",
  name: "understand_request",
  arguments: JSON.stringify(plan(extra)),
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AI_PROVIDER", "deepseek");
  vi.stubEnv("DEEPSEEK_API_KEY", "synthetic");
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("DeepSeek Baam intent contract", () => {
  it("caps a three-digit product count at the documented result limit without reading only its last digits", () => {
    expect(parseLocalBaamProductPlan("Show top 100 products this month")).toMatchObject({ limit: 50 });
  });
  it("requires an explicit confirmation of an active form and never treats yes or a negation as approval", () => {
    const active = { kind: "stock_receive", parameters: {} };
    expect(parseBaamFastIntent("Подтверждаю выполнение", undefined, active)?.kind).toBe("confirm");
    expect(parseBaamFastIntent("Confirm execution", undefined, active)?.kind).toBe("confirm");
    expect(parseBaamFastIntent("Аткарууну ырастайм", undefined, active)?.kind).toBe("confirm");
    expect(parseBaamFastIntent("Да", undefined, active)?.kind).not.toBe("confirm");
    expect(parseBaamFastIntent("Не подтверждай выполнение", undefined, active)?.kind).not.toBe(
      "confirm",
    );
    expect(parseBaamFastIntent("Подтверждаю выполнение")?.kind).not.toBe("confirm");
  });
  it("accepts a useful general answer without proposing a mutation", async () => {
    mocks.fetch.mockResolvedValue(Response.json({ status: "completed", output: [call()] }));
    expect(await understandBaamIntent(args)).toMatchObject({
      kind: "answer",
      reply: "Полезный ответ",
      parameters: {},
    });
  });
  it("rejects multiple calls even though DeepSeek ignores parallel_tool_calls=false", async () => {
    mocks.fetch.mockResolvedValue(
      Response.json({
        status: "completed",
        output: [call(), call({ kind: "action", action: "stock_write_off" })],
      }),
    );
    await expect(understandBaamIntent(args)).rejects.toThrow("baamProviderInvalidResponse");
  });
  it("retries invalid JSON once before preparing any business operation", async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        Response.json({
          status: "completed",
          output: [{ ...call(), arguments: '{"kind": answer}' }],
        }),
      )
      .mockResolvedValueOnce(Response.json({ status: "completed", output: [call()] }));
    expect(await understandBaamIntent(args)).toMatchObject({ kind: "answer", parameters: {} });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it("reports a recoverable provider format error after the bounded retry", async () => {
    mocks.fetch.mockImplementation(() =>
      Promise.resolve(
        Response.json({ status: "completed", output: [{ ...call(), arguments: "invalid" }] }),
      ),
    );
    await expect(understandBaamIntent(args)).rejects.toThrow("baamProviderInvalidResponse");
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it("rejects an incomplete response and an unknown function", async () => {
    for (const body of [
      { status: "incomplete", output: [call()] },
      { status: "completed", output: [{ ...call(), name: "execute_sql" }] },
    ]) {
      mocks.fetch.mockResolvedValueOnce(Response.json(body));
      await expect(understandBaamIntent(args)).rejects.toThrow("baamProviderInvalidResponse");
    }
  });
  it("passes a photo as image input with separate untrusted context", async () => {
    mocks.fetch.mockResolvedValue(Response.json({ status: "completed", output: [call()] }));
    await understandBaamIntent({ ...args, images: ["data:image/jpeg;base64,synthetic"] });
    const payload = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(payload.input.at(-1).content[1]).toEqual({
      type: "input_image",
      image_url: "data:image/jpeg;base64,synthetic",
    });
    expect(payload.instructions).toContain("Merely attaching a photo is not consent");
  });
  it.each([
    ["Покажи топ-7 товаров", 7],
    ["Покажи 6 самых продаваемых товаров", 6],
    ["Бул айдагы эң көп сатылган 6 товарды көрсөт", 6],
    ["Show 8 best selling products", 8],
  ])("preserves the requested count: %s", (text, limit) => {
    expect(parseLocalBaamProductPlan(String(text))).toMatchObject({ limit });
  });
  it.each([
    ["Покажи топ семь товаров", 7],
    ["Бул айдагы эң көп сатылган жети товарды көрсөт", 7],
    ["Show top six products", 6],
    ["Покажи топ-25 товаров", 25],
    ["Покажи топ двадцать пять товаров", 25],
    ["Show top twenty-five products", 25],
    ["Бул айдагы эң көп сатылган жыйырма беш товарды көрсөт", 25],
  ])("handles voice counts: %s", (text, limit) => {
    expect(parseLocalBaamProductPlan(String(text))).toMatchObject({ limit });
  });
});
