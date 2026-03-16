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

  it("requires OpenAI configuration", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const { suggestProductSpecsFromImages } =
      await import("../../src/server/services/productSpecSuggestions");

    await expect(
      suggestProductSpecsFromImages({
        imageUrls: ["https://cdn.example.com/photo.jpg"],
        requestedSpecs: [{ kind: "type", labelRu: "Тип" }],
      }),
    ).rejects.toMatchObject({ message: "aiSpecsNotConfigured" });
  });

  it("returns normalized type and color suggestions from OpenAI JSON", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    mockDownloadRemoteImage.mockResolvedValue({
      buffer: Buffer.from([1, 2, 3, 4]),
      contentType: "image/png",
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              status: "completed",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: '```json\n{"type":"настольная игра","color":"разноцветный"}\n```',
                },
              ],
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/responses");

    const request = fetchMock.mock.calls[0]?.[1];
    expect((request?.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");

    const body = JSON.parse(String(request?.body)) as {
      model: string;
      reasoning?: { effort?: string };
      input: Array<{
        content: Array<{ type: string; text?: string; image_url?: string }>;
      }>;
    };
    expect(body.model).toBe("gpt-5-mini");
    expect(body.reasoning?.effort).toBe("minimal");
    expect(body.input[1]?.content[1]?.type).toBe("input_image");
    expect(body.input[1]?.content[1]?.image_url).toMatch(/^data:image\/png;base64,/);

    const systemText = body.input[0]?.content[0]?.text ?? "";
    const userText = body.input[1]?.content[0]?.text ?? "";
    expect(systemText).toContain("Определи характеристики продаваемого товара");
    expect(systemText).toContain("Для поля color возвращай основной цвет самого товара");
    expect(userText).toContain("Разрешенные поля ответа: type, color.");
    expect(userText).toContain("Настольная игра, Пазл");
    expect(userText).toContain("Разноцветный, Синий");
    expect(userText).toContain("цвет самого товара");
  });

  it("maps OpenAI rate limits to application rate limit errors", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
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
