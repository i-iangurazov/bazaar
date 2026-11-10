import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { mockProductImageHttpResponse } from "../helpers/product-image-http";

const { mockGetServerAuthToken, mockExportProductImagesData, lookupMock, requestMock } = vi.hoisted(() => ({
  mockGetServerAuthToken: vi.fn(),
  mockExportProductImagesData: vi.fn(),
  lookupMock: vi.fn(),
  requestMock: vi.fn(),
}));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));
vi.mock("node:http", () => ({ request: requestMock }));
vi.mock("node:https", () => ({ request: requestMock }));

vi.mock("@/server/auth/token", () => ({
  getServerAuthToken: mockGetServerAuthToken,
}));

vi.mock("@/server/services/products/read", () => ({
  exportProductImagesData: mockExportProductImagesData,
}));

import { GET as exportImagesGet } from "@/app/api/products/export-images/route";
import { GET as downloadImagesGet } from "@/app/api/products/export-images/download/route";
import { clearImageExportStorageForTests } from "@/lib/imageExportStore";

describe("image export HTTP workflow", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("IMAGE_STORAGE_PROVIDER", "local");
    await clearImageExportStorageForTests();
    mockGetServerAuthToken.mockResolvedValue({
      sub: "image-export-user",
      organizationId: "image-export-org",
      role: "ADMIN",
    });
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    requestMock.mockImplementation((url, _options, callback) => mockProductImageHttpResponse(callback, { body: `image:${String(url)}` }));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("builds a bounded archive, persists it between requests, and downloads once", async () => {
    mockExportProductImagesData.mockResolvedValue([
      {
        id: "product-1",
        name: "First/Product",
        images: Array.from({ length: 40 }, (_, index) => `https://images.test/${index}.jpg`),
      },
    ]);

    const exportResponse = await exportImagesGet(
      new Request("http://localhost/api/products/export-images?storeName=Main"),
    );
    const events = (await exportResponse.text())
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)) as { type: string; token?: string });
    const ready = events.find((event) => event.type === "ready");

    expect(exportResponse.status).toBe(200);
    expect(requestMock).toHaveBeenCalledTimes(40);
    expect(ready?.token).toEqual(expect.any(String));
    expect(events.some((event) => event.type === "error")).toBe(false);

    const downloadUrl = `http://localhost/api/products/export-images/download?token=${ready?.token}`;
    const downloadResponse = await downloadImagesGet(new Request(downloadUrl));
    const bytes = await downloadResponse.arrayBuffer();
    const archive = await JSZip.loadAsync(bytes);

    expect(downloadResponse.status).toBe(200);
    expect(Object.keys(archive.files)).toHaveLength(40);
    expect(await archive.file("First_Product/image-40.jpg")?.async("string")).toContain(
      "/39.jpg",
    );
    expect((await downloadImagesGet(new Request(downloadUrl))).status).toBe(404);
  });

  it.each([
    "http://169.254.169.254/latest/meta-data/",
    "http://127.0.0.1/uploads/imported-products/secret.jpg",
    "http://[::ffff:169.254.169.254]/secret.jpg",
  ])("does not fetch private URLs retained in product records: %s", async (imageUrl) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockExportProductImagesData.mockResolvedValue([{ name: "Stored image", images: [imageUrl] }]);
    const response = await exportImagesGet(new Request("http://localhost/api/products/export-images"));
    const events = await response.text();
    expect(events).toContain('"type":"ready"');
    expect(events).not.toContain('"type":"error"');
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("does not follow stored public image redirects to private services", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockExportProductImagesData.mockResolvedValue([{ name: "Redirect", images: ["https://images.test/photo.jpg"] }]);
    requestMock.mockImplementationOnce((_url, _options, callback) => mockProductImageHttpResponse(callback, {
      status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" },
    }));
    const response = await exportImagesGet(new Request("http://localhost/api/products/export-images"));
    expect(await response.text()).toContain('"type":"ready"');
    expect(requestMock).toHaveBeenCalledTimes(1);
  });
});
