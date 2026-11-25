import { describe, expect, it, vi } from "vitest";

const info = vi.hoisted(() => vi.fn());
vi.mock("@/server/logging", () => ({ getLogger: () => ({ info }) }));

import { beginAiProviderAttempt, readAiProviderResponse, withAiProviderFeature } from "@/server/services/aiProviderTelemetry";

describe("AI provider usage telemetry", () => {
  it("records counters, latency, request ID and nested feature context without customer payloads", async () => {
    await withAiProviderFeature("marketplace_catalog", async () => {
      await Promise.resolve();
      withAiProviderFeature("catalog_description", () => {
        const record = beginAiProviderAttempt({ provider: "openai", model: "synthetic-model", pilot: true });
        const payload = {
          model: "synthetic-model-2026-01-01",
          text: "Do not log this private sample",
          usage: { input_tokens: 12, output_tokens: 3, input_tokens_details: { cached_tokens: 4 } },
          authorization: "synthetic-sensitive-secret",
        };
        record({ response: Response.json(payload, { headers: { "x-request-id": "req_valid" } }), body: payload });
      });
    });
    expect(info).toHaveBeenCalledWith(expect.objectContaining({
      event: "ai_provider_attempt", feature: "marketplace_catalog", pilot: true,
    }), expect.any(String));
    const record = info.mock.lastCall?.[0];
    expect(record).toMatchObject({
      reportedModel: "synthetic-model-2026-01-01", providerRequestId: "req_valid",
      latencyMs: expect.any(Number), outcome: "succeeded", inputTokens: 12, outputTokens: 3, cachedInputTokens: 4,
    });
    expect(JSON.stringify(record)).not.toMatch(/private sample|synthetic-sensitive-secret/);
  });

  it("does not consume the caller's successful response body even if telemetry exceeds its bound", async () => {
    const response = Response.json({ large: "x".repeat(600000) });
    expect(await readAiProviderResponse(response)).toEqual({});
    expect((await response.json()).large).toHaveLength(600000);
  });
});
