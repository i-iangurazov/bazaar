import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDownloadRemoteImage, mockNormalizeProductImageUrl } = vi.hoisted(() => ({
  mockDownloadRemoteImage: vi.fn(),
  mockNormalizeProductImageUrl: vi.fn((value: string) => value),
}));

vi.mock("@/server/services/productImageStorage", () => ({
  downloadRemoteImage: (value: string) => mockDownloadRemoteImage(value),
  normalizeProductImageUrl: (value: string) => mockNormalizeProductImageUrl(value),
}));

describe("product spec suggestions", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    mockNormalizeProductImageUrl.mockImplementation((value: string) => value);
  });

  it("requires Gemini configuration", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const { suggestProductSpecsFromImages } =
      await import("../../src/server/services/productSpecSuggestions");

    await expect(
      suggestProductSpecsFromImages({
        imageUrls: ["https://cdn.example.com/photo.jpg"],
        requestedSpecs: [{ kind: "type", labelRu: "Тип" }],
      }),
    ).rejects.toMatchObject({ message: "aiSpecsNotConfigured" });
  });

  it("returns normalized type and color suggestions from Gemini JSON", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
    mockDownloadRemoteImage.mockResolvedValue({
      buffer: Buffer.from([1, 2, 3, 4]),
      contentType: "image/png",
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '```json\n{"type":"настольная игра","color":"разноцветный"}\n```',
                  },
                ],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { suggestProductSpecsFromImages } =
      await import("../../src/server/services/productSpecSuggestions");

    await expect(
      suggestProductSpecsFromImages({
        imageUrls: ["https://cdn.example.com/photo.png"],
        requestedSpecs: [
          {
            kind: "type",
            labelRu: "Тип",
            options: ["Настольная игра", "Пазл"],
          },
          {
            kind: "color",
            labelRu: "Цвет",
            options: ["Разноцветный", "Синий"],
          },
        ],
      }),
    ).resolves.toEqual({
      suggestions: {
        type: "Настольная игра",
        color: "Разноцветный",
      },
    });

    const request = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as {
      contents: Array<{
        parts: Array<{ text?: string } | { inline_data?: { mime_type: string; data: string } }>;
      }>;
    };
    const promptPart = body.contents[0]?.parts.find(
      (part): part is { text: string } => typeof (part as { text?: string }).text === "string",
    );
    expect(promptPart?.text).toContain("Разрешенные поля ответа: type, color.");
    expect(promptPart?.text).toContain("Настольная игра, Пазл");
    expect(promptPart?.text).toContain("Разноцветный, Синий");
  });

  it("maps Gemini rate limits to application rate limit errors", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
    mockDownloadRemoteImage.mockResolvedValue({
      buffer: Buffer.from([9, 9, 9]),
      contentType: "image/png",
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Rate limit reached" } }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { suggestProductSpecsFromImages } =
      await import("../../src/server/services/productSpecSuggestions");

    await expect(
      suggestProductSpecsFromImages({
        imageUrls: ["https://cdn.example.com/photo.png"],
        requestedSpecs: [{ kind: "type", labelRu: "Тип" }],
      }),
    ).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      message: "rateLimited",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
