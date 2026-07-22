import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { lookupMock, transformMock } = vi.hoisted(() => ({
  lookupMock: vi.fn(),
  transformMock: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));
vi.mock("@/server/services/catalogImageTransform", () => ({
  transformCatalogImageToWebp: transformMock,
}));

import { GET as getCatalogImage } from "@/app/api/public/catalog/image/route";

const originalEnvironment = {
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  R2_PUBLIC_BASE_URL: process.env.R2_PUBLIC_BASE_URL,
  PRODUCT_IMAGE_MAX_BYTES: process.env.PRODUCT_IMAGE_MAX_BYTES,
  PRODUCT_IMAGE_FETCH_TIMEOUT_MS: process.env.PRODUCT_IMAGE_FETCH_TIMEOUT_MS,
};

const restoreEnvironmentValue = (key: keyof typeof originalEnvironment) => {
  const value = originalEnvironment[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
};

const requestImage = (sourceUrl: string, params?: { width?: string; quality?: string }) => {
  const requestUrl = new URL("https://app.example.com/api/public/catalog/image");
  requestUrl.searchParams.set("url", sourceUrl);
  if (params?.width) requestUrl.searchParams.set("w", params.width);
  if (params?.quality) requestUrl.searchParams.set("q", params.quality);
  return getCatalogImage(new Request(requestUrl));
};

const imageResponse = (body: BodyInit = new Uint8Array([1, 2, 3]), headers?: HeadersInit) =>
  new Response(body, {
    status: 200,
    headers: { "content-type": "image/png", ...headers },
  });

describe("HARD-A3-026 public catalogue image proxy", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    delete process.env.NEXTAUTH_URL;
    process.env.R2_PUBLIC_BASE_URL = "https://images.example.com";
    process.env.PRODUCT_IMAGE_MAX_BYTES = "5242880";
    process.env.PRODUCT_IMAGE_FETCH_TIMEOUT_MS = "4000";
    lookupMock.mockReset();
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    transformMock.mockReset();
    transformMock.mockResolvedValue(Buffer.from("safe-webp"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnvironmentValue("NEXT_PUBLIC_APP_URL");
    restoreEnvironmentValue("NEXTAUTH_URL");
    restoreEnvironmentValue("R2_PUBLIC_BASE_URL");
    restoreEnvironmentValue("PRODUCT_IMAGE_MAX_BYTES");
    restoreEnvironmentValue("PRODUCT_IMAGE_FETCH_TIMEOUT_MS");
  });

  it.each([
    "file:///uploads/imported-products/probe.png",
    "ftp://images.example.com/uploads/imported-products/probe.png",
    "data:image/png;base64,aW50ZXJuYWwtcHJvYmU=",
    "https://user:secret@images.example.com/uploads/imported-products/probe.png",
    "https://images.example.com:444/uploads/imported-products/probe.png",
  ])("rejects unsafe schemes, credentials, and ports before I/O: %s", async (sourceUrl) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await requestImage(sourceUrl);

    expect(response.status).toBe(404);
    expect(lookupMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["localhost", "assets.localhost", "catalog.local", "catalog.internal"])(
    "blocks local hostnames and suffixes before DNS or fetch: %s",
    async (host) => {
      process.env.R2_PUBLIC_BASE_URL = `http://${host}`;
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const response = await requestImage(
        `http://${host}/uploads/imported-products/internal-probe.png`,
      );

      expect(response.status).toBe(404);
      expect(lookupMock).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    "0.0.0.1",
    "10.12.0.8",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.10",
    "192.0.2.1",
    "198.18.0.1",
    "224.0.0.1",
    "240.0.0.1",
  ])("blocks private, metadata, and reserved IPv4 targets: %s", async (host) => {
    process.env.R2_PUBLIC_BASE_URL = `http://${host}`;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await requestImage(
      `http://${host}/uploads/imported-products/internal-probe.png`,
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it.each(["::1", "fc00::1", "fd12::1", "fe80::1", "ff02::1", "::ffff:169.254.169.254"])(
    "blocks private, metadata-mapped, and reserved IPv6 targets: %s",
    async (host) => {
      process.env.R2_PUBLIC_BASE_URL = `http://[${host}]`;
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const response = await requestImage(
        `http://[${host}]/uploads/imported-products/internal-probe.png`,
      );

      expect(response.status).toBe(404);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(lookupMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    [[{ address: "10.0.0.7", family: 4 }]],
    [
      [
        { address: "93.184.216.34", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ],
    ],
    [[{ address: "fd00::7", family: 6 }]],
  ])("blocks hostnames when any resolved address is non-public: %j", async (records) => {
    lookupMock.mockResolvedValue(records);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await requestImage(
      "https://images.example.com/uploads/imported-products/internal-probe.png",
    );

    expect(response.status).toBe(404);
    expect(lookupMock).toHaveBeenCalledWith("images.example.com", {
      all: true,
      verbatim: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates a redirect target and blocks a redirect to metadata before the second fetch", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://169.254.169.254";
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: {
          location: "http://169.254.169.254/uploads/product-images/secret.png",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await requestImage(
      "https://images.example.com/uploads/imported-products/redirect.png",
    );

    expect(response.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("revalidates DNS and the allowlist on every successful public redirect hop", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://app.example.com/uploads/product-images/final.png" },
        }),
      )
      .mockResolvedValueOnce(imageResponse());
    vi.stubGlobal("fetch", fetchMock);

    const response = await requestImage(
      "https://images.example.com/uploads/imported-products/redirect.png",
    );

    expect(response.status).toBe(200);
    expect(lookupMock.mock.calls.map(([host]) => host)).toEqual([
      "images.example.com",
      "app.example.com",
    ]);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://images.example.com/uploads/imported-products/redirect.png",
      "https://app.example.com/uploads/product-images/final.png",
    ]);
  });

  it("stops after the bounded redirect count", async () => {
    const redirectUrl = "https://images.example.com/uploads/imported-products/loop.png";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: redirectUrl },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await requestImage(redirectUrl);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ message: "imageReadFailed" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(lookupMock).toHaveBeenCalledTimes(4);
    expect(transformMock).not.toHaveBeenCalled();
  });

  it.each(["text/html", "application/json", "image/svg+xml"])(
    "rejects an unsafe upstream content type: %s",
    async (contentType) => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response("not-a-raster-image", {
          status: 200,
          headers: { "content-type": contentType },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const response = await requestImage(
        "https://images.example.com/uploads/imported-products/not-image",
      );

      expect(response.status).toBe(415);
      expect(await response.json()).toEqual({ message: "imageInvalidType" });
      expect(transformMock).not.toHaveBeenCalled();
    },
  );

  it("does not expose an upstream response body when the image fetch fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("internal-provider-token=secret", {
        status: 500,
        headers: { "content-type": "text/plain" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await requestImage(
      "https://images.example.com/uploads/imported-products/failed.png",
    );
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(JSON.parse(body)).toEqual({ message: "imageReadFailed" });
    expect(body).not.toContain("internal-provider-token");
    expect(body).not.toContain("secret");
  });

  it("rejects an oversized declared content length without reading or transforming", async () => {
    process.env.PRODUCT_IMAGE_MAX_BYTES = "10";
    const fetchMock = vi.fn().mockResolvedValue(imageResponse(new Uint8Array([1]), {
      "content-length": "11",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await requestImage(
      "https://images.example.com/uploads/imported-products/large.png",
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ message: "imageTooLarge" });
    expect(transformMock).not.toHaveBeenCalled();
  });

  it("stops a streamed response as soon as its actual byte count exceeds the limit", async () => {
    process.env.PRODUCT_IMAGE_MAX_BYTES = "10";
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6));
        controller.enqueue(new Uint8Array(6));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(imageResponse(stream));
    vi.stubGlobal("fetch", fetchMock);

    const response = await requestImage(
      "https://images.example.com/uploads/imported-products/streamed-large.png",
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ message: "imageTooLarge" });
    expect(transformMock).not.toHaveBeenCalled();
  });

  it("aborts and returns a gateway timeout when the upstream fetch stalls", async () => {
    process.env.PRODUCT_IMAGE_FETCH_TIMEOUT_MS = "5";
    const fetchMock = vi.fn(
      async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await requestImage(
      "https://images.example.com/uploads/imported-products/slow.png",
    );

    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ message: "imageReadTimeout" });
    expect(transformMock).not.toHaveBeenCalled();
  });

  it("blocks a managed-looking path on an unconfigured public origin before DNS or fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await requestImage(
      "https://attacker.example/uploads/imported-products/probe.png",
    );

    expect(response.status).toBe(404);
    expect(lookupMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches an allowed public image with manual redirects and returns transformed WebP", async () => {
    const sourceBytes = new Uint8Array([137, 80, 78, 71]);
    const fetchMock = vi.fn().mockResolvedValue(imageResponse(sourceBytes));
    vi.stubGlobal("fetch", fetchMock);

    const response = await requestImage(
      "https://images.example.com/uploads/imported-products/public.png",
      { width: "900", quality: "82" },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("safe-webp");
    expect(lookupMock).toHaveBeenCalledWith("images.example.com", {
      all: true,
      verbatim: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://images.example.com/uploads/imported-products/public.png",
      expect.objectContaining({
        cache: "force-cache",
        redirect: "manual",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(transformMock).toHaveBeenCalledWith({
      sourceBuffer: Buffer.from(sourceBytes),
      width: 900,
      quality: 82,
      sourceMimeType: "image/png",
    });
  });

  it("resolves a relative managed path only against the configured application origin", async () => {
    const fetchMock = vi.fn().mockResolvedValue(imageResponse());
    vi.stubGlobal("fetch", fetchMock);

    const response = await requestImage("/uploads/product-images/public.png");

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://app.example.com/uploads/product-images/public.png",
      expect.objectContaining({ redirect: "manual" }),
    );
  });
});
