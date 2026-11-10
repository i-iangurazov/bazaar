import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockProductImageHttpResponse } from "../helpers/product-image-http";

const { mockGetServerAuthToken, lookupMock, requestMock } = vi.hoisted(() => ({
  mockGetServerAuthToken: vi.fn(), lookupMock: vi.fn(), requestMock: vi.fn(),
}));
vi.mock("@/server/auth/token", () => ({ getServerAuthToken: mockGetServerAuthToken }));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));
vi.mock("node:http", () => ({ request: requestMock }));
vi.mock("node:https", () => ({ request: requestMock }));

import { GET } from "@/app/api/product-images/source/route";

describe("product image source route", () => {
  const uploadPath = `/uploads/imported-products/image-source-test-${randomUUID()}`;
  const uploadDirectory = join(process.cwd(), "public", uploadPath);
  const requestImage = (url: string) => GET(new Request(`http://localhost/api/product-images/source?url=${encodeURIComponent(url)}`));

  beforeAll(async () => {
    await mkdir(uploadDirectory, { recursive: true });
    await writeFile(join(uploadDirectory, "photo.jpg"), new Uint8Array([1, 2, 3]));
    await writeFile(join(uploadDirectory, "extensionless"), new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
  });
  afterAll(async () => { await rm(uploadDirectory, { recursive: true, force: true }); });
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerAuthToken.mockResolvedValue({ organizationId: "org-1", role: "ADMIN" });
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    requestMock.mockImplementation((_url, _options, callback) => mockProductImageHttpResponse(callback));
    vi.stubEnv("R2_PUBLIC_BASE_URL", "https://images.example.com/assets");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("reads actual local managed uploads and infers MIME from extension without loopback HTTP", async () => {
    const response = await requestImage(`${uploadPath}/photo.jpg`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect((await response.arrayBuffer()).byteLength).toBe(3);
    expect(requestMock).not.toHaveBeenCalled();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("infers extensionless local upload MIME from bytes", async () => {
    const response = await requestImage(`${uploadPath}/extensionless`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
  });

  it("allows managers to read a configured object-storage image", async () => {
    mockGetServerAuthToken.mockResolvedValue({ organizationId: "org-1", role: "MANAGER" });
    const response = await requestImage("https://images.example.com/assets/retails/photo.jpg");
    expect(response.status).toBe(200);
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(String(requestMock.mock.calls[0][0])).toBe("https://images.example.com/assets/retails/photo.jpg");
  });

  it("resolves legacy retails paths against the configured storage subdirectory", async () => {
    const response = await requestImage("/retails/photo.jpg");
    expect(response.status).toBe(200);
    expect(String(requestMock.mock.calls[0][0])).toBe("https://images.example.com/assets/retails/photo.jpg");
  });

  it.each([
    "https://example.com/photo.jpg",
    "http://127.0.0.1/uploads/imported-products/probe.jpg",
    "http://169.254.169.254/uploads/product-images/probe.jpg",
    "https://evil.example/uploads/imported-products/probe.jpg",
    "https://images.example.com.evil.example/assets/photo.jpg",
    "https://user:secret@images.example.com/assets/photo.jpg",
    "https://images.example.com:444/assets/photo.jpg",
  ])("rejects non-managed or unsafe destinations: %s", async (url) => {
    const response = await requestImage(url);
    expect(response.status).toBe(403);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("does not trust a request Host over configured production application origins", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    vi.stubEnv("NEXTAUTH_URL", "https://app.example.com");
    const source = "https://evil.example/uploads/imported-products/photo.jpg";
    const response = await GET(new Request(`https://evil.example/api/product-images/source?url=${encodeURIComponent(source)}`));
    expect(response.status).toBe(403);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("rejects an object-storage redirect to private metadata before a second request", async () => {
    requestMock.mockImplementation((_url, _options, callback) => mockProductImageHttpResponse(callback, {
      status: 302, headers: { location: "http://169.254.169.254/uploads/product-images/secret.jpg" },
    }));
    expect((await requestImage("https://images.example.com/assets/photo.jpg")).status).toBe(502);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("keeps valid redirects within configured storage working", async () => {
    requestMock.mockImplementationOnce((_url, _options, callback) => mockProductImageHttpResponse(callback, {
      status: 302, headers: { location: "/assets/renamed.jpg" },
    }));
    expect((await requestImage("https://images.example.com/assets/photo.jpg")).status).toBe(200);
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it("preserves HEIC MIME and rejects SVG payloads", async () => {
    requestMock.mockImplementationOnce((_url, _options, callback) => mockProductImageHttpResponse(callback, {
      headers: { "content-type": "image/heic-sequence" },
    }));
    expect((await requestImage("https://images.example.com/assets/photo.heic")).headers.get("content-type")).toBe("image/heic");
    requestMock.mockImplementationOnce((_url, _options, callback) => mockProductImageHttpResponse(callback, {
      headers: { "content-type": "image/svg+xml" },
    }));
    expect((await requestImage("https://images.example.com/assets/photo.svg")).status).toBe(400);
  });

  it.each([null, { organizationId: "org-1", role: "CASHIER" }])("preserves authorization: %j", async (token) => {
    mockGetServerAuthToken.mockResolvedValue(token);
    expect([401, 403]).toContain((await requestImage(`${uploadPath}/photo.jpg`)).status);
    expect(requestMock).not.toHaveBeenCalled();
  });
});
