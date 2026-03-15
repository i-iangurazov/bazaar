import { beforeEach, describe, expect, it, vi } from "vitest";

const LONG_RU_DESCRIPTION =
  "Аккуратное описание товара для каталога: видна упаковка, читается формат изделия, заметны основные визуальные детали и назначение. Текст подходит для карточки и уверенно превышает минимальную длину.";

const LONG_KG_DESCRIPTION =
  "Бул товар боюнча сүрөттөмө каталог үчүн жетиштүү узун: таңгактын көрүнүшү, формасы, колдонуу багыты жана сүрөттөн байкалган негизги өзгөчөлүктөрү так берилди. Текст минималдуу талаптан кыйла узун.";

const { mockDownloadRemoteImage, mockNormalizeProductImageUrl } = vi.hoisted(() => ({
  mockDownloadRemoteImage: vi.fn(),
  mockNormalizeProductImageUrl: vi.fn((value: string) => value),
}));

vi.mock("@/server/services/productImageStorage", () => ({
  downloadRemoteImage: (value: string) => mockDownloadRemoteImage(value),
  normalizeProductImageUrl: (value: string) => mockNormalizeProductImageUrl(value),
}));

describe("product description generation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    mockNormalizeProductImageUrl.mockImplementation((value: string) => value);
  });

  it("requires OpenAI configuration", async () => {
    vi.stubEnv("AI_DESCRIPTION_PROVIDER", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    const { generateProductDescriptionFromImages } =
      await import("../../src/server/services/productDescriptions");

    await expect(
      generateProductDescriptionFromImages({
        locale: "ru",
        imageUrls: ["https://cdn.example.com/photo.jpg"],
      }),
    ).rejects.toMatchObject({ message: "aiDescriptionNotConfigured" });
  });

  it("sends product images as data urls and returns cleaned text", async () => {
    vi.stubEnv("AI_DESCRIPTION_PROVIDER", "openai");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    mockDownloadRemoteImage.mockResolvedValue({
      buffer: Buffer.from([1, 2, 3, 4]),
      contentType: "image/jpeg",
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output_text: `  "${LONG_RU_DESCRIPTION}"  `,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { generateProductDescriptionFromImages } =
      await import("../../src/server/services/productDescriptions");
    const result = await generateProductDescriptionFromImages({
      name: "Test Product",
      category: "Snacks",
      locale: "ru",
      imageUrls: ["https://cdn.example.com/photo.jpg"],
    });

    expect(result).toEqual({
      description: LONG_RU_DESCRIPTION,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/responses");

    const request = fetchMock.mock.calls[0]?.[1];
    expect(request?.method).toBe("POST");
    expect((request?.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");

    const body = JSON.parse(String(request?.body)) as {
      model: string;
      input: Array<{ content: Array<{ type: string; image_url?: string; text?: string }> }>;
    };
    expect(body.model).toBe("gpt-4.1-mini");
    expect(body.input[1]?.content[0]?.type).toBe("input_text");
    expect(body.input[1]?.content[1]?.type).toBe("input_image");
    expect(body.input[1]?.content[1]?.image_url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("maps provider rate limits to application rate limit errors", async () => {
    vi.stubEnv("AI_DESCRIPTION_PROVIDER", "openai");
    vi.stubEnv("GEMINI_API_KEY", "");
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

    const { generateProductDescriptionFromImages } =
      await import("../../src/server/services/productDescriptions");

    await expect(
      generateProductDescriptionFromImages({
        locale: "kg",
        imageUrls: ["https://cdn.example.com/photo.png"],
      }),
    ).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      message: "rateLimited",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries a transient 429 and returns the next successful response", async () => {
    vi.stubEnv("AI_DESCRIPTION_PROVIDER", "openai");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    mockDownloadRemoteImage.mockResolvedValue({
      buffer: Buffer.from([7, 7, 7]),
      contentType: "image/png",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "Rate limit reached" } }), {
          status: 429,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output_text: LONG_KG_DESCRIPTION,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { generateProductDescriptionFromImages } =
      await import("../../src/server/services/productDescriptions");

    await expect(
      generateProductDescriptionFromImages({
        locale: "kg",
        imageUrls: ["https://cdn.example.com/photo.png"],
      }),
    ).resolves.toEqual({
      description: LONG_KG_DESCRIPTION,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses Gemini when GEMINI_API_KEY is configured", async () => {
    vi.stubEnv("AI_DESCRIPTION_PROVIDER", "gemini");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
    mockDownloadRemoteImage.mockResolvedValue({
      buffer: Buffer.from([5, 6, 7, 8]),
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
                    text: LONG_RU_DESCRIPTION,
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

    const { generateProductDescriptionFromImages } =
      await import("../../src/server/services/productDescriptions");

    await expect(
      generateProductDescriptionFromImages({
        locale: "ru",
        imageUrls: ["https://cdn.example.com/photo.png"],
      }),
    ).resolves.toEqual({
      description: LONG_RU_DESCRIPTION,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "generativelanguage.googleapis.com/v1beta/models/",
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(":generateContent");
    const request = fetchMock.mock.calls[0]?.[1];
    expect((request?.headers as Record<string, string>)["x-goog-api-key"]).toBe("gemini-test-key");
    const body = JSON.parse(String(request?.body)) as {
      contents: Array<{
        parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }>;
      }>;
    };
    expect("contents" in body).toBe(true);
    expect("generationConfig" in (body as Record<string, unknown>)).toBe(true);
  });

  it("includes the minimum length requirement in the Gemini prompt", async () => {
    vi.stubEnv("AI_DESCRIPTION_PROVIDER", "gemini");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
    mockDownloadRemoteImage.mockResolvedValue({
      buffer: Buffer.from([5, 6, 7, 8]),
      contentType: "image/png",
    });
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: LONG_RU_DESCRIPTION,
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

    const { generateProductDescriptionFromImages } =
      await import("../../src/server/services/productDescriptions");

    await expect(
      generateProductDescriptionFromImages({
        locale: "ru",
        imageUrls: ["https://cdn.example.com/photo.png"],
      }),
    ).resolves.toEqual({
      description: LONG_RU_DESCRIPTION,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as {
      contents: Array<{
        parts: Array<{ text?: string } | { inline_data?: { mime_type: string; data: string } }>;
      }>;
    };
    const promptPart = body.contents[0]?.parts.find(
      (part): part is { text: string } => typeof (part as { text?: string }).text === "string",
    );
    expect(promptPart?.text).toContain("Длина ответа должна быть не меньше 150 символов.");
    expect(promptPart?.text).toContain(
      "Не используй название, категорию или другие метаданные вне самой картинки.",
    );
    expect(promptPart?.text).not.toContain("Название:");
    expect(promptPart?.text).not.toContain("Категория:");
    expect(promptPart?.text).not.toContain("Тип:");
  });

  it("retries short Gemini descriptions with a stricter image-only prompt", async () => {
    vi.stubEnv("AI_DESCRIPTION_PROVIDER", "gemini");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
    mockDownloadRemoteImage.mockResolvedValue({
      buffer: Buffer.from([5, 6, 7, 8]),
      contentType: "image/png",
    });
    const improvedDescription =
      "Яркая коробка с настольной игрой оформлена в выразительной подаче: заметны крупное название, контрастные цветовые акценты и графика на лицевой стороне. Упаковка выглядит как готовый розничный товар, а оформление создает понятный образ для карточки и помогает быстро представить товар в каталоге.";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: 'Настольная игра "Тви"',
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
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: improvedDescription,
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

    const { generateProductDescriptionFromImages } =
      await import("../../src/server/services/productDescriptions");

    const result = await generateProductDescriptionFromImages({
      locale: "ru",
      imageUrls: ["https://cdn.example.com/photo.png"],
    });
    expect(result).toEqual({ description: improvedDescription });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryRequest = fetchMock.mock.calls[1]?.[1];
    const retryBody = JSON.parse(String(retryRequest?.body)) as {
      contents: Array<{
        parts: Array<{ text?: string } | { inline_data?: { mime_type: string; data: string } }>;
      }>;
    };
    const retryPrompt = retryBody.contents[0]?.parts.find(
      (part): part is { text: string } => typeof (part as { text?: string }).text === "string",
    )?.text;
    expect(retryPrompt).toContain("Предыдущий ответ не подходит:");
    expect(retryPrompt).toContain('Настольная игра "Тви"');
    expect(retryPrompt).toContain("Не пиши фразы вроде «на изображении видно», «товар показан»");
    expect(retryPrompt).toContain("Описывай сам товар, а не то, что нарисовано на коробке");
    expect(retryPrompt).toContain("Не используй название, категорию и любые внешние метаданные.");
  });

  it("rewrites long caption-like descriptions into product-focused copy", async () => {
    vi.stubEnv("AI_DESCRIPTION_PROVIDER", "gemini");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
    mockDownloadRemoteImage.mockResolvedValue({
      buffer: Buffer.from([5, 6, 7, 8]),
      contentType: "image/png",
    });
    const captionLikeDescription =
      'Настольная игра "Твистер" в яркой картонной упаковке. На коробке изображены силуэты людей, выполняющих движения на поле с цветными кругами. Название игры написано крупными буквами, а упаковка имеет стандартную прямоугольную форму.';
    const improvedDescription =
      "Твистер выглядит как активная настольная игра для компании: яркое оформление, динамичные силуэты и поле с цветными кругами сразу задают подвижный игровой формат. Коробка оформлена заметно и понятно, поэтому товар воспринимается как веселый вариант для семейного досуга или компании друзей.";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: captionLikeDescription }],
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: improvedDescription }],
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

    const { generateProductDescriptionFromImages } =
      await import("../../src/server/services/productDescriptions");

    const result = await generateProductDescriptionFromImages({
      locale: "ru",
      imageUrls: ["https://cdn.example.com/photo.png"],
    });
    expect(result).toEqual({ description: improvedDescription });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("builds a final description from extracted visual facts when rewrites stay weak", async () => {
    vi.stubEnv("AI_DESCRIPTION_PROVIDER", "gemini");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
    mockDownloadRemoteImage.mockResolvedValue({
      buffer: Buffer.from([5, 6, 7, 8]),
      contentType: "image/png",
    });
    const composedFromFacts =
      "Яркая коробка настольной игры выделяется контрастными цветами, крупным названием и заметной иллюстрацией на лицевой стороне. Оформление выглядит аккуратно и сразу передает формат товара, поэтому карточка получает понятный и живой визуальный образ без лишних домыслов.";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: 'Настольная игра "Тви"' }],
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "Яркая коробка настольной игры." }],
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: "яркая коробка || контрастные цветовые акценты || крупное название на лицевой стороне || настольный формат || иллюстрация на упаковке || аккуратное оформление",
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
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: composedFromFacts }],
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

    const { generateProductDescriptionFromImages } =
      await import("../../src/server/services/productDescriptions");

    const result = await generateProductDescriptionFromImages({
      locale: "ru",
      imageUrls: ["https://cdn.example.com/photo.png"],
    });
    expect(result).toEqual({ description: composedFromFacts });
    expect(result.description.length).toBeGreaterThanOrEqual(150);
    expect(result.description).not.toContain("на изображении");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("fails when none of the provided images can be processed", async () => {
    vi.stubEnv("AI_DESCRIPTION_PROVIDER", "openai");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    mockDownloadRemoteImage.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { generateProductDescriptionFromImages } =
      await import("../../src/server/services/productDescriptions");

    await expect(
      generateProductDescriptionFromImages({
        locale: "ru",
        imageUrls: ["https://cdn.example.com/photo.jpg"],
      }),
    ).rejects.toMatchObject({ message: "aiDescriptionNoUsableImages" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
