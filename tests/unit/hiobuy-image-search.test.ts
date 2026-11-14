import { afterEach, describe, expect, it, vi } from "vitest";
import {
  demoImageSearchResult,
  normalizeHiobuyImageSearch,
  searchHiobuyByImage,
} from "@/server/services/hiobuyImageSearch";

const item = {
  id: "123",
  channel: "1688",
  source_url: "https://detail.1688.com/offer/123.html",
  title: { original: "陶瓷杯", translated: "Cup" },
  image: "//cbu01.alicdn.com/cup.jpg",
  price: { display_amount: 12.5, promotion_amount: 0, display_currency: "CNY" },
  seller: { name: "Shop" },
};
const payload = (items: unknown[] = [item]) => ({ channel: "1688", total: items.length, items });
afterEach(() => vi.useRealTimers());

describe("HioBuy image search adapter", () => {
  it("uses the documented standard list, CNY yuan, translated titles and zero promotion prices", () => {
    expect(normalizeHiobuyImageSearch(payload()).items).toEqual([
      {
        id: "123",
        title: "Cup",
        originalTitle: "陶瓷杯",
        price: 0,
        currency: "CNY",
        seller: "Shop",
        imageUrl: "https://cbu01.alicdn.com/cup.jpg",
        sourceUrl: item.source_url,
      },
    ]);
    expect(
      normalizeHiobuyImageSearch(
        payload([{ ...item, title: { original: "原文", translated: null }, price: null }]),
      ).items[0],
    ).toMatchObject({ title: "原文", price: null });
  });
  it("removes unsafe links and images, duplicates, foreign channels and malformed prices", () => {
    const result = normalizeHiobuyImageSearch(
      payload([
        {
          ...item,
          source_url: "https://detail.1688.com.evil.invalid/",
          image: "http://127.0.0.1:5432/private",
        },
        item,
        { ...item, id: "foreign", channel: "taobao" },
        { ...item, id: "negative", price: { display_amount: -1 } },
      ]),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ sourceUrl: null, imageUrl: null });
    for (const url of [
      "javascript:alert(1)",
      "https://secret@1688.com/",
      "https://1688.com:444/",
      "https://evil.invalid/",
    ])
      expect(
        normalizeHiobuyImageSearch(payload([{ ...item, source_url: url }])).items[0].sourceUrl,
      ).toBeNull();
  });
  it("distinguishes an empty search from an incompatible payload and bounds result count", () => {
    expect(normalizeHiobuyImageSearch(payload([])).items).toEqual([]);
    for (const bad of [{}, { data: payload() }, payload([{}]), { ...payload(), channel: "taobao" }])
      expect(() => normalizeHiobuyImageSearch(bad)).toThrow("imageSearchInvalidResponse");
    expect(
      normalizeHiobuyImageSearch(
        payload(Array.from({ length: 30 }, (_, i) => ({ ...item, id: String(i) }))),
      ).items,
    ).toHaveLength(20);
  });
  it("sends a server-only key and base64 to a fixed HTTPS endpoint without redirects or retry", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(payload()));
    const result = await searchHiobuyByImage(
      { jpeg: Buffer.from("image"), apiKey: "synthetic-secret", locale: "kg" },
      fetch,
    );
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.hiobuy.com/v1/products/search-by-image");
    expect(init).toMatchObject({
      redirect: "error",
      cache: "no-store",
      headers: { Authorization: "Bearer synthetic-secret" },
    });
    expect(JSON.parse(init.body)).toEqual({
      channel: "1688",
      image_base64: Buffer.from("image").toString("base64"),
      page: 1,
      page_size: 20,
      language: "en",
      response_format: "standard",
    });
    expect(JSON.stringify(result)).not.toContain("synthetic-secret");
  });
  it.each([
    [401, "INVALID_API_KEY", "imageSearchProviderAccess", 503],
    [403, "CHANNEL_NOT_AUTHORIZED", "imageSearchProviderAccess", 503],
    [403, "PAID_SUBSCRIPTION_REQUIRED", "imageSearchProviderAccess", 503],
    [429, "QUOTA_EXCEEDED", "imageSearchQuotaExceeded", 429],
    [429, "PLATFORM_QUOTA_EXCEEDED", "imageSearchRateLimited", 429],
    [400, "VALIDATION_ERROR", "imageSearchImageRejected", 422],
    [503, "UPSTREAM_ERROR", "imageSearchProviderFailed", 502],
    [200, "UPSTREAM_ERROR", "imageSearchProviderFailed", 502],
  ])("sanitizes HTTP %i / %s", async (status, code, message, expectedStatus) => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ error: { code, message: "secret-provider-details" } }, { status }),
      );
    await expect(
      searchHiobuyByImage({ jpeg: Buffer.from("x"), apiKey: "secret", locale: "ru" }, fetch),
    ).rejects.toMatchObject({ message, status: expectedStatus });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("handles non-JSON failures, oversized responses and connection errors without exposing diagnostics", async () => {
    for (const response of [
      new Response("<html>secret</html>"),
      new Response(" ".repeat(2 * 1024 * 1024 + 1)),
    ])
      await expect(
        searchHiobuyByImage(
          { jpeg: Buffer.from("x"), apiKey: "secret", locale: "en" },
          vi.fn().mockResolvedValue(response),
        ),
      ).rejects.toMatchObject({ message: "imageSearchInvalidResponse" });
    await expect(
      searchHiobuyByImage(
        { jpeg: Buffer.from("x"), apiKey: "secret", locale: "en" },
        vi.fn().mockResolvedValue(new Response("error", { status: 429 })),
      ),
    ).rejects.toMatchObject({ message: "imageSearchRateLimited" });
    await expect(
      searchHiobuyByImage(
        { jpeg: Buffer.from("x"), apiKey: "secret", locale: "en" },
        vi.fn().mockRejectedValue(new Error("secret")),
      ),
    ).rejects.toMatchObject({ message: "imageSearchProviderFailed" });
  });
  it("times out once and releases the timer; also bounds a stalled response body", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockImplementation(
        (_url, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
          ),
      );
    const pending = searchHiobuyByImage(
      { jpeg: Buffer.from("x"), apiKey: "secret", locale: "en" },
      fetch,
    );
    const assertion = expect(pending).rejects.toMatchObject({
      message: "imageSearchTimeout",
      status: 504,
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    const stalled = vi.fn().mockImplementation(
      async (_url, init: RequestInit) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init.signal?.addEventListener("abort", () =>
                controller.error(new Error("aborted body")),
              );
            },
          }),
        ),
    );
    const body = searchHiobuyByImage(
      { jpeg: Buffer.from("x"), apiKey: "secret", locale: "en" },
      stalled,
    );
    const bodyAssertion = expect(body).rejects.toMatchObject({ message: "imageSearchTimeout" });
    await vi.advanceTimersByTimeAsync(20_000);
    await bodyAssertion;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("marks every fixture response as demo and never fabricates an original offer link", () => {
    const demo = demoImageSearchResult();
    expect(demo.mode).toBe("demo");
    expect(demo.items.every((item) => item.id.startsWith("demo-") && item.sourceUrl === null)).toBe(
      true,
    );
  });
});
