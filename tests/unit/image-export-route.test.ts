import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";

const { mockGetServerAuthToken, mockExportProductImagesData, mockDownloadRemoteImage } = vi.hoisted(
  () => ({
    mockGetServerAuthToken: vi.fn(),
    mockExportProductImagesData: vi.fn(),
    mockDownloadRemoteImage: vi.fn(),
  }),
);

vi.mock("@/server/auth/token", () => ({
  getServerAuthToken: mockGetServerAuthToken,
}));

vi.mock("@/server/services/products/read", () => ({
  exportProductImagesData: mockExportProductImagesData,
}));

vi.mock("@/server/services/productImageStorage", () => ({
  downloadRemoteImage: mockDownloadRemoteImage,
  readManagedLocalProductImage: vi.fn(),
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
  });

  it("builds a bounded archive, persists it between requests, and downloads once", async () => {
    mockExportProductImagesData.mockResolvedValue([
      {
        id: "product-1",
        name: "First/Product",
        images: Array.from({ length: 40 }, (_, index) => `https://images.test/${index}.jpg`),
      },
    ]);
    mockDownloadRemoteImage.mockImplementation(async (url: string) => ({
      buffer: Buffer.from(`image:${url}`),
      contentType: "image/jpeg",
    }));

    const exportResponse = await exportImagesGet(
      new Request("http://localhost/api/products/export-images?storeName=Main"),
    );
    const events = (await exportResponse.text())
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)) as { type: string; token?: string });
    const ready = events.find((event) => event.type === "ready");

    expect(exportResponse.status).toBe(200);
    expect(mockDownloadRemoteImage).toHaveBeenCalledTimes(40);
    expect(ready?.token).toEqual(expect.any(String));
    expect(events.some((event) => event.type === "error")).toBe(false);

    const downloadUrl = `http://localhost/api/products/export-images/download?token=${ready?.token}`;
    const downloadResponse = await downloadImagesGet(new Request(downloadUrl));
    const bytes = await downloadResponse.arrayBuffer();
    const archive = await JSZip.loadAsync(bytes);

    expect(downloadResponse.status).toBe(200);
    expect(Object.keys(archive.files)).toHaveLength(40);
    expect(await archive.file("First_Product/image-40.jpg")?.async("string")).toContain("/39.jpg");
    expect((await downloadImagesGet(new Request(downloadUrl))).status).toBe(404);
  });
});
