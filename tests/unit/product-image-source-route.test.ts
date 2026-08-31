import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetServerAuthToken, mockReadManagedLocalProductImage, mockDownloadRemoteImage } =
  vi.hoisted(() => ({
    mockGetServerAuthToken: vi.fn(),
    mockReadManagedLocalProductImage: vi.fn(),
    mockDownloadRemoteImage: vi.fn(),
  }));

vi.mock("@/server/auth/token", () => ({
  getServerAuthToken: () => mockGetServerAuthToken(),
}));

vi.mock("@/server/services/productImageStorage", () => ({
  readManagedLocalProductImage: mockReadManagedLocalProductImage,
  downloadRemoteImage: mockDownloadRemoteImage,
}));

describe("product image source route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    mockGetServerAuthToken.mockResolvedValue({ organizationId: "org-1", role: "ADMIN" });
    mockReadManagedLocalProductImage.mockResolvedValue({
      buffer: Buffer.from([1, 2, 3]),
      contentType: "application/octet-stream",
    });
    mockDownloadRemoteImage.mockResolvedValue(null);
  });

  it("proxies managed images and infers image mime from extension when header is generic", async () => {
    const { GET } = await import("../../src/app/api/product-images/source/route");
    const imageUrl = "/uploads/imported-products/org-1/products/prod-1/photo.jpg";
    const request = new Request(
      `http://localhost/api/product-images/source?url=${encodeURIComponent(imageUrl)}`,
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(mockReadManagedLocalProductImage).toHaveBeenCalledWith({
      url: "http://localhost/uploads/imported-products/org-1/products/prod-1/photo.jpg",
      organizationId: "org-1",
    });
    const body = await response.arrayBuffer();
    expect(body.byteLength).toBe(3);
  });

  it("infers image mime from bytes when managed upload urls have no extension", async () => {
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    mockReadManagedLocalProductImage.mockResolvedValue({
      buffer: Buffer.from(jpegBytes),
      contentType: "application/octet-stream",
    });

    const { GET } = await import("../../src/app/api/product-images/source/route");
    const request = new Request(
      `http://localhost/api/product-images/source?url=${encodeURIComponent(
        "/uploads/imported-products/org-1/products/unassigned/hash-without-extension",
      )}`,
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
  });

  it("allows managers to proxy managed product images", async () => {
    mockGetServerAuthToken.mockResolvedValue({ organizationId: "org-1", role: "MANAGER" });
    mockReadManagedLocalProductImage.mockResolvedValue({
      buffer: Buffer.from([1, 2, 3]),
      contentType: "image/png",
    });

    const { GET } = await import("../../src/app/api/product-images/source/route");
    const request = new Request(
      `http://localhost/api/product-images/source?url=${encodeURIComponent(
        "/uploads/imported-products/org-1/products/prod-1/photo.png",
      )}`,
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
  });

  it("proxies only the current tenant's configured R2 product prefix", async () => {
    vi.stubEnv("R2_PUBLIC_BASE_URL", "https://images.example.com/assets");
    mockDownloadRemoteImage.mockResolvedValue({
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      contentType: "image/png",
    });

    const { GET } = await import("../../src/app/api/product-images/source/route");
    const allowedUrl = "https://images.example.com/assets/retails/org-1/products/p-1/photo.png";
    const response = await GET(
      new Request(
        `http://localhost/api/product-images/source?url=${encodeURIComponent(allowedUrl)}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(mockDownloadRemoteImage).toHaveBeenCalledWith(allowedUrl);
    expect(mockReadManagedLocalProductImage).not.toHaveBeenCalled();
  });

  it("rejects non-managed source urls", async () => {
    const { GET } = await import("../../src/app/api/product-images/source/route");
    const request = new Request(
      `http://localhost/api/product-images/source?url=${encodeURIComponent(
        "https://example.com/photo.jpg",
      )}`,
    );

    const response = await GET(request);

    expect(response.status).toBe(403);
    expect(mockReadManagedLocalProductImage).not.toHaveBeenCalled();
    expect(mockDownloadRemoteImage).not.toHaveBeenCalled();
  });

  it.each([
    "https://evil.example/uploads/imported-products/org-1/products/prod-1/photo.jpg",
    "/uploads/imported-products/other-org/products/prod-1/photo.jpg",
    "/uploads/product-images/other-org/photo.jpg",
    "https://images.example.com/assets/retails/other-org/products/prod-1/photo.jpg",
  ])(
    "rejects cross-origin or cross-tenant managed-looking urls before I/O: %s",
    async (imageUrl) => {
      vi.stubEnv("R2_PUBLIC_BASE_URL", "https://images.example.com/assets");
      const { GET } = await import("../../src/app/api/product-images/source/route");
      const response = await GET(
        new Request(
          `http://localhost/api/product-images/source?url=${encodeURIComponent(imageUrl)}`,
        ),
      );

      expect(response.status).toBe(403);
      expect(mockReadManagedLocalProductImage).not.toHaveBeenCalled();
      expect(mockDownloadRemoteImage).not.toHaveBeenCalled();
    },
  );
});
