import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { productPhotoSearchModel } from "@/lib/productPhotoSearch";
import { checkPreparedPhotoIndex, queryPreparedProductPhoto } from "@/server/services/productPhotoSearchEngine";

const scope = { organizationId: "org-a", storeId: "store-a" };
const revision = "a".repeat(64);
const sourceKey = "b".repeat(64);
const snapshot = { revision, count: 63_499, withoutPhoto: 0 };
const analysis = { regionSource: "full", region: null, ocrStatus: "ready", lines: [] };
const reply = { modelVersion: productPhotoSearchModel, snapshot, analysis, matches: [{ index: 99, score: 0.93, sourceKey }] };
const photo = Buffer.from("test photo");

beforeEach(() => {
  vi.stubEnv("PRODUCT_PHOTO_SEARCH_URL", "http://127.0.0.1:56175");
  vi.stubEnv("PRODUCT_PHOTO_SEARCH_TOKEN", "t".repeat(32));
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(reply)));
});

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("prepared photo search transport", () => {
  it("sends just the store scope and photo, returning the published revision and source references", async () => {
    await expect(queryPreparedProductPhoto(photo, scope)).resolves.toEqual({ index: snapshot, sourceKeys: [sourceKey], analysis });
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:56175/snapshot-search");
    expect(JSON.parse(String(options?.body))).toEqual({ ...scope, imageBase64: photo.toString("base64"), minScore: 0.68 });
  });

  it("leaves a missing snapshot to the normal database workflow", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(checkPreparedPhotoIndex(scope)).resolves.toBeNull();
  });

  it("rejects malformed revisions and source references", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...reply, snapshot: { ...snapshot, revision: "bad" } }));
    await expect(queryPreparedProductPhoto(photo, scope)).rejects.toThrow("photoSearchUnavailable");
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...reply, matches: [{ index: 99, score: 0.93, sourceKey: "bad" }] }));
    await expect(queryPreparedProductPhoto(photo, scope)).rejects.toThrow("photoSearchUnavailable");
  });
});
