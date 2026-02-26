import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetServerAuthToken } = vi.hoisted(() => ({
  mockGetServerAuthToken: vi.fn(),
}));

vi.mock("@/server/auth/token", () => ({
  getServerAuthToken: () => mockGetServerAuthToken(),
}));

describe("product image source route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mockGetServerAuthToken.mockResolvedValue({ organizationId: "org-1", role: "ADMIN" });
  });

  it("proxies managed images and infers image mime from extension when header is generic", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("../../src/app/api/product-images/source/route");
    const imageUrl = "/uploads/imported-products/org-1/products/prod-1/photo.jpg";
    const request = new Request(
      `http://localhost/api/product-images/source?url=${encodeURIComponent(imageUrl)}`,
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost/uploads/imported-products/org-1/products/prod-1/photo.jpg",
      { cache: "no-store" },
    );
    const body = await response.arrayBuffer();
    expect(body.byteLength).toBe(3);
  });

  it("rejects non-managed source urls", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("../../src/app/api/product-images/source/route");
    const request = new Request(
      `http://localhost/api/product-images/source?url=${encodeURIComponent(
        "https://example.com/photo.jpg",
      )}`,
    );

    const response = await GET(request);

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
