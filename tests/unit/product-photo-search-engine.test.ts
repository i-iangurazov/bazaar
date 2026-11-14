import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkPhotoSearchEngine, embedProductPhoto, matchProductPhoto, queryProductPhoto, validPhotoEmbedding } from "@/server/services/productPhotoSearchEngine";
import { productPhotoSearchModel as modelVersion, productPhotoSearchMinScore } from "@/lib/productPhotoSearch";
const v = [1, ...Array<number>(511).fill(0)];
beforeEach(() => { vi.stubEnv("PRODUCT_PHOTO_SEARCH_URL", "http://127.0.0.1:3160"); vi.stubEnv("PRODUCT_PHOTO_SEARCH_TOKEN", "private-service-test-token-with-32-characters"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("private PP-ShiTu contract", () => {
  it("validates dimensions, finite values, normalization and model identity", async () => {
    expect(validPhotoEmbedding(v)).toBe(true);
    for (const invalid of [[], v.slice(1), Array(512).fill(0), [NaN, ...v.slice(1)]]) expect(validPhotoEmbedding(invalid)).toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ modelVersion: "different", embedding: v })));
    await expect(embedProductPhoto(Buffer.from("jpeg"))).rejects.toMatchObject({ message: "photoSearchUnavailable" });
  });
  it("packs float32 vectors and groups product photos without sending tenant IDs, URLs or prices", async () => {
    const transport = vi.fn().mockResolvedValue(Response.json({ modelVersion, matches: [{ index: 1, score: 0.9 }] })); vi.stubGlobal("fetch", transport);
    expect(await matchProductPhoto(Buffer.from("jpeg"), [{ productId: "secret-product", embedding: v }, { productId: "secret-product", embedding: v }])).toEqual([{ index: 1, score: 0.9 }]);
    const [url, init] = transport.mock.calls[0]; expect(String(url)).toBe("http://127.0.0.1:3160/search"); expect(init.redirect).toBe("error");
    const body = JSON.parse(init.body); expect(body.groups).toEqual([0,0]); expect(init.body).not.toContain("secret-product");
    expect(body.minScore).toBe(productPhotoSearchMinScore);
    expect(Buffer.from(body.vectorsBase64, "base64").readFloatLE(0)).toBe(1);
  });
  it("forbids insecure non-local endpoints and never forwards redirect credentials", async () => {
    vi.stubGlobal("fetch", vi.fn());
    for (const url of ["http://remote.example", "https://user:password@example.invalid", "https://example.invalid?token=hidden"]) {
      vi.stubEnv("PRODUCT_PHOTO_SEARCH_URL", url); await expect(checkPhotoSearchEngine()).rejects.toMatchObject({ message: "photoSearchNotConfigured" });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("bounds upstream data and supports cancellation, busy and empty galleries", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x".repeat(65537))));
    await expect(checkPhotoSearchEngine()).rejects.toMatchObject({ status: 503 });
    vi.mocked(fetch).mockResolvedValueOnce(new Response("", { status: 429 }));
    await expect(embedProductPhoto(Buffer.from("x"))).rejects.toMatchObject({ status: 429 });
    const controller = new AbortController(); controller.abort();
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => { expect(init?.signal?.aborted).toBe(true); throw new Error("abort"); });
    await expect(embedProductPhoto(Buffer.from("x"), controller.signal)).rejects.toMatchObject({ status: 504 });
    expect(await matchProductPhoto(Buffer.from("x"), [])).toEqual([]);
  });
  it("forwards a validated region without tenant metadata and rejects ignored or invalid region responses", async () => {
    const region = { x: 0.2, y: 0.1, width: 0.5, height: 0.8 };
    const data = { modelVersion, matches: [{ index: 0, score: 0.8 }], analysis: { regionSource: "manual", region, ocrStatus: "ready", lines: [] } };
    const transport = vi.fn().mockResolvedValue(Response.json(data)); vi.stubGlobal("fetch", transport);
    const result = await queryProductPhoto(Buffer.from("jpeg"), [{ productId: "private", embedding: v }], undefined, { region });
    expect(result.analysis.region).toEqual(region); expect(JSON.parse(transport.mock.calls[0][1].body).region).toEqual(region);
    for (const analysis of [{ ...data.analysis, regionSource: "full" }, { ...data.analysis, region: { ...region, width: 2 } },
      { ...data.analysis, lines: [{ text: "label", confidence: 1.1, box: region }] }, { ...data.analysis, lines: Array(25).fill({ text: "x", confidence: 1, box: region }) }]) {
      transport.mockResolvedValueOnce(Response.json({ ...data, analysis }));
      await expect(queryProductPhoto(Buffer.from("jpeg"), [{ productId: "private", embedding: v }], undefined, { region })).rejects.toMatchObject({ status: 503 });
    }
    transport.mockResolvedValueOnce(Response.json({ modelVersion, matches: [] }));
    await expect(queryProductPhoto(Buffer.from("jpeg"), [{ productId: "private", embedding: v }], undefined, { region })).rejects.toMatchObject({ status: 503 });
  });
});
