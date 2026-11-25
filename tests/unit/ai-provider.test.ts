import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), fetch: vi.fn(), expense: vi.fn(), settle: vi.fn() }));
vi.mock("@/server/config/runtime", () => ({ assertExternalProviderCallAllowed: mocks.guard }));
// Provider routing/budget tests assume the initiating person already opted in;
// consent refusal/revocation is exercised independently at the network boundary.
vi.mock("@/server/services/aiPrivacy", () => ({ assertAiConsent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/server/billing/providerExpense", () => ({
  reserveProviderExpense: mocks.expense, settleProviderExpense: mocks.settle,
  aiExpenseMinor: (input: number, output: number) => input + output,
}));
import { resolveTextAiConfig, fetchAiResponse, aiOutputText } from "@/server/services/aiProvider";
import { withAiOperationBudget } from "@/server/billing/aiOperationBudget";
import { OPENAI_TEXT_PILOT_MODEL } from "@/server/billing/openAiTextPilot";
import { assertAiConsent } from "@/server/services/aiPrivacy";
import { withAiProviderFeature, type AiProviderFeature } from "@/server/services/aiProviderTelemetry";

beforeEach(() => {
  vi.resetAllMocks();
  for (const key of [
    "AI_PROVIDER",
    "DEEPSEEK_API_KEY",
    "DEEPSEEK_MODEL",
    "DEEPSEEK_BAAM_MODEL",
    "DEEPSEEK_VISION_MODEL",
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "OPENAI_TEXT_PILOT_ENABLED",
  ])
    vi.stubEnv(key, "");
  vi.stubGlobal("fetch", mocks.fetch);
});

function configureTextPilot() {
  for (const [key, value] of Object.entries({
    DEEPSEEK_API_KEY: "deepseek-synthetic",
    OPENAI_TEXT_PILOT_ENABLED: "1",
    OPENAI_TEXT_PILOT_API_KEY: "sk-proj-synthetic",
    OPENAI_TEXT_PILOT_PROJECT_ID: "proj_synthetic",
    OPENAI_TEXT_PILOT_ORGANIZATION_ID: "pilot-org",
    OPENAI_TEXT_PILOT_FEATURE: "baam_text",
    OPENAI_TEXT_PILOT_EXPIRES_AT: new Date(Date.now() + 600000).toISOString(),
    OPENAI_TEXT_PILOT_DAILY_LIMIT_USD_CENTS: "75",
  })) vi.stubEnv(key, value);
  vi.mocked(assertAiConsent).mockResolvedValue({ userId: "synthetic", organizationId: "pilot-org" });
  mocks.expense.mockResolvedValue({ lease: null, reserved: 100 });
}

const pilotAttempt = (body: Record<string, unknown>, organizationId = "pilot-org", feature: AiProviderFeature = "baam_text") =>
  withAiProviderFeature(feature, () => withAiOperationBudget({ organizationId, enabled: true }, () =>
    fetchAiResponse(resolveTextAiConfig()!, body, new AbortController().signal)));

describe("experimental OpenAI text routing", () => {
  it("reserves the approved project's standard-tier expense before one dispatch", async () => {
    configureTextPilot();
    mocks.fetch.mockImplementation(async () => {
      expect(mocks.expense).toHaveBeenCalledWith(expect.objectContaining({
        organizationId: "pilot-org", pilot: { dailyLimitCents: 75, estimatedCents: expect.any(Number) },
      }));
      return Response.json({ service_tier: "default", usage: { input_tokens: 1000, output_tokens: 1000 } });
    });
    const response = await pilotAttempt({ input: "Synthetic", service_tier: "priority", store: true });
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init.headers).toMatchObject({ Authorization: "Bearer sk-proj-synthetic", "OpenAI-Project": "proj_synthetic" });
    expect(JSON.parse(init.body)).toMatchObject({ model: OPENAI_TEXT_PILOT_MODEL, store: false, service_tier: "default" });
    expect(await response.json()).toMatchObject({ usage: { output_tokens: 1000 } });
    expect(mocks.settle).toHaveBeenCalledWith(expect.any(Object), 53, 1);
  });

  it("keeps other organizations, scopes, media and provider tools on the previous route", async () => {
    configureTextPilot();
    mocks.fetch.mockImplementation(async () => Response.json({ output: [] }));
    await pilotAttempt({ input: "Synthetic" }, "different-org");
    await pilotAttempt({ input: "Synthetic" }, "pilot-org", "marketplace_catalog");
    await pilotAttempt({ input: [{ role: "user", content: [{ type: "input_image", image_url: "synthetic" }] }] });
    await pilotAttempt({ input: "Synthetic", tools: [{ type: "web_search" }] });
    vi.stubEnv("OPENAI_TEXT_PILOT_ENABLED", "0");
    await pilotAttempt({ input: "Synthetic" });
    expect(mocks.fetch.mock.calls.map(([url]) => url)).toEqual(Array(5).fill("https://api.deepseek.com/responses"));
  });

  it("does not dispatch without a budget reservation and never falls back after a transport failure", async () => {
    configureTextPilot();
    mocks.expense.mockRejectedValueOnce(new Error("billingAiProviderBudgetReached"));
    await expect(pilotAttempt({ input: "Synthetic" })).rejects.toThrow("billingAiProviderBudgetReached");
    expect(mocks.fetch).not.toHaveBeenCalled();
    mocks.fetch.mockRejectedValueOnce(new Error("Synthetic network failure"));
    await expect(pilotAttempt({ input: "Synthetic" })).rejects.toThrow("Synthetic network failure");
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.settle).toHaveBeenLastCalledWith(expect.any(Object));
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("AI provider routing and credentials", () => {
  it("reserves a paid DeepSeek attempt before fetching and settles the actual usage receipt", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "synthetic-metered");
    mocks.expense.mockResolvedValue({ lease: { id: "synthetic" }, reserved: 2000 });
    mocks.fetch.mockImplementation(async () => {
      expect(mocks.expense).toHaveBeenCalledOnce();
      return Response.json({ usage: { input_tokens: 10, output_tokens: 20 }, output: [] });
    });
    await withAiOperationBudget({ organizationId: "org", enabled: true }, async () => {
      const response = await fetchAiResponse(resolveTextAiConfig()!, { input: "test" }, new AbortController().signal);
      expect((await response.json()).usage.output_tokens).toBe(20);
    });
    expect(mocks.settle).toHaveBeenCalledWith(expect.any(Object), 30);
  });
  it("prevents an expensive OpenAI text fallback on new paid contracts before any provider work", async () => {
    vi.stubEnv("OPENAI_API_KEY", "synthetic-fallback");
    await withAiOperationBudget({ organizationId: "org", enabled: true }, async () => {
      await expect(fetchAiResponse(resolveTextAiConfig()!, { input: "test" }, new AbortController().signal))
        .rejects.toThrow("billingAiProviderUnavailable");
    });
    expect(mocks.expense).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("settles a definite provider rejection at zero but holds an uncertain transport attempt", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "synthetic-metered");
    mocks.expense.mockResolvedValue({ lease: null, reserved: 2000 });
    mocks.fetch.mockResolvedValueOnce(Response.json({ error: "synthetic" }, { status: 400 }));
    await withAiOperationBudget({ organizationId: "org", enabled: true }, async () => {
      await fetchAiResponse(resolveTextAiConfig()!, { input: "test" }, new AbortController().signal);
    });
    expect(mocks.settle).toHaveBeenLastCalledWith(expect.any(Object), 0);
    mocks.fetch.mockRejectedValueOnce(new Error("Synthetic disconnected response"));
    await withAiOperationBudget({ organizationId: "org", enabled: true }, async () => {
      await expect(fetchAiResponse(resolveTextAiConfig()!, { input: "test" }, new AbortController().signal)).rejects.toThrow("Synthetic disconnected");
    });
    expect(mocks.settle).toHaveBeenLastCalledWith(expect.any(Object));
  });
  it("keeps a conservative expense for an HTTP408 with an uncertain outcome", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "synthetic-metered");
    mocks.expense.mockResolvedValue({ lease: null, reserved: 2000 });
    mocks.fetch.mockResolvedValueOnce(Response.json({ error: "timeout" }, { status: 408 }));
    await withAiOperationBudget({ organizationId: "org", enabled: true }, async () => {
      await fetchAiResponse(resolveTextAiConfig()!, { input: "test" }, new AbortController().signal);
    });
    expect(mocks.settle).toHaveBeenLastCalledWith(expect.any(Object), undefined);
  });
  it("returns unused vendor and response allowances when an already-aborted request never dispatches", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "synthetic-metered");
    mocks.expense.mockResolvedValue({ lease: null, reserved: 2000 });
    mocks.fetch.mockResolvedValue(Response.json({ usage: { input_tokens: 1, output_tokens: 1 }, output: [] }));
    const cancelled = new AbortController();
    cancelled.abort();
    await withAiOperationBudget({ organizationId: "org", enabled: true }, async () => {
      // Three unsent 2k-token requests must not consume the shared 6k response
      // allowance or prevent the next intentionally dispatched request.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await expect(fetchAiResponse(resolveTextAiConfig()!, { input: "cancelled" }, cancelled.signal))
          .rejects.toMatchObject({ name: "AbortError" });
        expect(mocks.settle).toHaveBeenLastCalledWith(expect.any(Object), 0);
      }
      expect(mocks.fetch).not.toHaveBeenCalled();
      await fetchAiResponse(resolveTextAiConfig()!, { input: "allowed" }, new AbortController().signal);
    });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.expense).toHaveBeenCalledTimes(4);
    expect(mocks.settle).toHaveBeenLastCalledWith(expect.any(Object), 2);
  });
  it("strips provider credentials from QA while preserving explicit HTTPS and browser controls", () => {
    const env = baamTestEnvironment({
      NODE_ENV: "test",
      OPENAI_API_KEY: "synthetic-openai",
      DEEPSEEK_API_KEY: "synthetic-deepseek",
      AI_PROVIDER: "deepseek",
      BAAM_MODEL: "synthetic-model",
      BAAM_TEST_HTTPS: "1",
      BAAM_BROWSER_CHANNEL: "chrome",
      BAAM_LIVE_PROVIDER: "0",
    });
    expect(env.OPENAI_API_KEY).toBe("");
    expect(env.DEEPSEEK_API_KEY).toBe("");
    expect(env.AI_PROVIDER).toBe("");
    expect(env.BAAM_MODEL).toBe("");
    expect(env.BAAM_TEST_HTTPS).toBe("1");
    expect(env.BAAM_BROWSER_CHANNEL).toBe("chrome");
    expect(env.BAAM_LIVE_PROVIDER).toBe("0");
  });
  it("keeps existing OpenAI installations working until DeepSeek is configured", () => {
    expect(resolveTextAiConfig()).toBeNull();
    vi.stubEnv("OPENAI_API_KEY", "openai-synthetic");
    expect(resolveTextAiConfig()).toMatchObject({
      provider: "openai",
      apiKey: "openai-synthetic",
      model: "gpt-5-mini",
    });
  });
  it("prefers DeepSeek and does not inherit an incompatible legacy GPT model", () => {
    vi.stubEnv("OPENAI_API_KEY", "openai-synthetic");
    vi.stubEnv("OPENAI_MODEL", "gpt-5-mini");
    vi.stubEnv("DEEPSEEK_API_KEY", "deepseek-synthetic");
    expect(resolveTextAiConfig("vision", "gpt-5-mini")).toMatchObject({
      provider: "deepseek",
      model: "deepseek-flash",
      apiKey: "deepseek-synthetic",
    });
  });
  it("does not silently fall back to another paid provider after an explicit selection", () => {
    vi.stubEnv("AI_PROVIDER", "deepseek");
    vi.stubEnv("OPENAI_API_KEY", "openai-synthetic");
    expect(resolveTextAiConfig()).toBeNull();
    vi.stubEnv("AI_PROVIDER", "not-a-provider");
    expect(resolveTextAiConfig()).toBeNull();
  });
  it("sends a DeepSeek key exclusively to the fixed DeepSeek destination and disables thinking for extraction", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "deepseek-synthetic");
    mocks.fetch.mockResolvedValue(Response.json({ status: "completed", output: [] }));
    await fetchAiResponse(
      resolveTextAiConfig()!,
      { model: "wrong", store: true, reasoning: { effort: "high" }, input: "Synthetic" },
      new AbortController().signal,
    );
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/responses");
    expect(init.redirect).toBe("error");
    expect(init.headers.Authorization).toBe("Bearer deepseek-synthetic");
    expect(JSON.parse(init.body)).toMatchObject({
      model: "deepseek-flash",
      store: false,
      reasoning: { effort: "none" },
    });
    expect(mocks.guard).toHaveBeenCalledWith("deepseek");
  });
  it("honours provider isolation before any network operation", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "deepseek-synthetic");
    mocks.guard.mockImplementation(() => {
      throw new Error("externalProviderDisabled");
    });
    await expect(fetchAiResponse(resolveTextAiConfig()!, {}, new AbortController().signal)).rejects.toThrow(
      "externalProviderDisabled",
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("never exposes reasoning, tool arguments or incomplete answers", () => {
    expect(
      aiOutputText({
        status: "incomplete",
        output: [{ type: "message", content: [{ type: "output_text", text: "partial" }] }],
      }),
    ).toBe("");
    expect(
      aiOutputText({
        status: "completed",
        output: [
          { type: "reasoning", content: [{ type: "output_text", text: "private" }] },
          { type: "message", content: [{ type: "output_text", text: "answer" }] },
        ],
      }),
    ).toBe("answer");
  });
});
import { baamTestEnvironment } from "../../scripts/baam/environment";
