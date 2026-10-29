import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), fetch: vi.fn() }));
vi.mock("@/server/config/runtime", () => ({ assertExternalProviderCallAllowed: mocks.guard }));
import { resolveTextAiConfig, fetchAiResponse, aiOutputText } from "@/server/services/aiProvider";

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
  ])
    vi.stubEnv(key, "");
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("AI provider routing and credentials", () => {
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
  it("honours provider isolation before any network operation", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "deepseek-synthetic");
    mocks.guard.mockImplementation(() => {
      throw new Error("externalProviderDisabled");
    });
    expect(() => fetchAiResponse(resolveTextAiConfig()!, {}, new AbortController().signal)).toThrow(
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
