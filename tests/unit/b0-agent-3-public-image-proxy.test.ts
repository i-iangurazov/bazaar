import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as getCatalogImage } from "@/app/api/public/catalog/image/route";

describe("B0 Agent 3 public image proxy P0 runtime verification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reproduces HARD-A3-026 without network access: a managed-looking loopback path is fetched", async () => {
    const attackerControlledUrl = "http://127.0.0.1/uploads/imported-products/internal-probe";
    const fetchMock = vi.fn(async () =>
      new Response("internal-secret", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const requestUrl = new URL("http://localhost/api/public/catalog/image");
    requestUrl.searchParams.set("url", attackerControlledUrl);
    requestUrl.searchParams.set("w", "120");
    const response = await getCatalogImage(new Request(requestUrl));
    const body = await response.text();

    console.info(
      `[B0-EVIDENCE] HARD-A3-026 ${JSON.stringify({
        suppliedUrl: attackerControlledUrl,
        fetchCalls: fetchMock.mock.calls.map(([url]) => String(url)),
        responseStatus: response.status,
        responseContentType: response.headers.get("content-type"),
        responseBody: body,
        liveNetworkCalls: 0,
      })}`,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      attackerControlledUrl,
      expect.objectContaining({ cache: "force-cache" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(body).toBe("internal-secret");
  });
});
