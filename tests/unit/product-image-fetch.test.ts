import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockProductImageHttpResponse } from "../helpers/product-image-http";

const { lookupMock, requestMock } = vi.hoisted(() => ({ lookupMock: vi.fn(), requestMock: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));
vi.mock("node:http", () => ({ request: requestMock }));
vi.mock("node:https", () => ({ request: requestMock }));

import { fetchPublicProductImage, readLocalProductImage } from "@/server/services/productImageFetch";

describe("public product image transport", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    requestMock.mockImplementation((_url, _options, callback) => mockProductImageHttpResponse(callback));
  });
  const readImage = (url: string, maxBytes = 50) => fetchPublicProductImage(url, { signal: AbortSignal.timeout(500), maxBytes });

  it.each([
    "http://127.0.0.1/secret", "http://169.254.169.254/secret", "http://10.0.0.1/secret",
    "http://100.64.0.1/secret", "http://[::1]/secret", "http://[::ffff:169.254.169.254]/secret",
    "http://[64:ff9b::a00:1]/secret", "http://[fc00::1]/secret", "http://[fe80::1]/secret", "http://[fec0::1]/secret", "http://[::10.0.0.1]/secret",
    "http://[100:0:0:1::1]/secret", "http://[2001:2::1]/secret", "http://[3fff::1]/secret", "http://[5f00::1]/secret",
    "http://localhost./secret", "http://host.local/secret", "http://host.internal/secret",
    "https://images.test:444/photo.jpg", "https://user:password@images.test/photo.jpg",
    "file:///etc/passwd", "ftp://images.test/photo.jpg",
  ])("blocks unsafe destinations before a connection: %s", async (url) => {
    expect(await readImage(url)).toBeNull();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("rejects a hostname if any DNS answer is private", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }]);
    expect(await readImage("https://images.test/photo.jpg")).toBeNull();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it.each(["http://93.184.216.34/photo.jpg", "https://[2606:4700:4700::1111]/photo.jpg"])("allows public literal destinations: %s", async (url) => {
    expect((await readImage(url))?.buffer.byteLength).toBe(3);
    expect(lookupMock).not.toHaveBeenCalled();
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("pins the approved DNS snapshot while keeping the original HTTPS hostname", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    expect((await readImage("https://images.test/photo.jpg"))?.buffer.byteLength).toBe(3);
    expect(lookupMock).toHaveBeenCalledTimes(1);
    const [url, options] = requestMock.mock.calls[0];
    expect(url.hostname).toBe("images.test");
    expect(options.agent).toBe(false);
    const callback = vi.fn();
    options.lookup("images.test", { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: "93.184.216.34", family: 4 }]);
    options.lookup("images.test", { family: 4 }, callback);
    expect(callback).toHaveBeenLastCalledWith(null, "93.184.216.34", 4);
    expect(lookupMock).toHaveBeenCalledTimes(1);
  });

  it("blocks redirect-to-private targets and rechecks DNS on each allowed hop", async () => {
    requestMock.mockImplementationOnce((_url, _options, callback) => mockProductImageHttpResponse(callback, {
      status: 302, headers: { location: "https://redirect.test/photo.jpg" },
    }));
    lookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    expect(await readImage("https://images.test/photo.jpg")).toBeNull();
    expect(lookupMock).toHaveBeenCalledTimes(2);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("supports legitimate public imported images through a public CDN redirect", async () => {
    requestMock.mockImplementationOnce((_url, _options, callback) => mockProductImageHttpResponse(callback, {
      status: 302, headers: { location: "https://cdn.test/photo.jpg" },
    }));
    expect((await readImage("https://images.test/photo.jpg"))?.contentType).toBe("image/jpeg");
    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(lookupMock.mock.calls.map(([hostname]) => hostname)).toEqual(["images.test", "cdn.test"]);
  });

  it("bounds redirect loops", async () => {
    requestMock.mockImplementation((_url, _options, callback) => mockProductImageHttpResponse(callback, {
      status: 302, headers: { location: "/photo.jpg" },
    }));
    expect(await readImage("https://images.test/photo.jpg")).toBeNull();
    expect(requestMock).toHaveBeenCalledTimes(4);
  });

  const oversizedBodies: Array<{ body: string | Uint8Array[]; headers: Record<string, string> }> = [
    { body: "123", headers: { "content-length": "20" } },
    { body: [new Uint8Array(3), new Uint8Array(3)], headers: {} },
  ];
  it.each(oversizedBodies)("enforces both declared and streamed byte limits", async (input) => {
    requestMock.mockImplementation((_url, _options, callback) => mockProductImageHttpResponse(callback, input));
    expect(await readImage("https://images.test/photo.jpg", 4)).toBeNull();
  });

  it("allows only configured URL destinations on every redirect when a managed policy is present", async () => {
    requestMock.mockImplementation((_url, _options, callback) => mockProductImageHttpResponse(callback, {
      status: 302, headers: { location: "https://other-public.test/photo.jpg" },
    }));
    expect(await fetchPublicProductImage("https://images.test/photo.jpg", {
      signal: AbortSignal.timeout(500), maxBytes: 50, allowUrl: (url) => url.origin === "https://images.test",
    })).toBeNull();
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("aborts a stalled DNS lookup without opening a connection", async () => {
    lookupMock.mockImplementation(() => new Promise(() => undefined));
    await expect(fetchPublicProductImage("https://images.test/photo.jpg", {
      signal: AbortSignal.timeout(10), maxBytes: 50,
    })).rejects.toThrow();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("propagates a network abort without leaving an open request", async () => {
    requestMock.mockImplementation((_url, options) => {
      const request = new EventEmitter() as EventEmitter & { end: () => void };
      request.end = () => options.signal.addEventListener("abort", () => request.emit("error", options.signal.reason), { once: true });
      return request;
    });
    await expect(fetchPublicProductImage("https://images.test/photo.jpg", {
      signal: AbortSignal.timeout(10), maxBytes: 50,
    })).rejects.toThrow();
  });
});

describe("local product image compatibility and confinement", () => {
  const fixture = `image-read-test-${randomUUID()}`;
  const path = `/uploads/imported-products/${fixture}`;
  const directory = join(process.cwd(), "public", path);
  const outsideFile = join(process.cwd(), ".local", `${fixture}.txt`);
  beforeAll(async () => {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "photo.jpg"), "image");
    await writeFile(outsideFile, "private control");
    await symlink(outsideFile, join(directory, "escape.jpg"));
  });
  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
    await rm(outsideFile, { force: true });
  });

  it("reads existing local upload bytes and applies the byte bound", async () => {
    expect((await readLocalProductImage(`${path}/photo.jpg`, 10))?.buffer.toString()).toBe("image");
    expect(await readLocalProductImage(`${path}/photo.jpg`, 4)).toBeNull();
  });
  it("rejects traversal and symlinks escaping the uploads directory", async () => {
    expect(await readLocalProductImage(`/uploads/../../.local/${fixture}.txt`, 50)).toBeNull();
    expect(await readLocalProductImage(`${path}/escape.jpg`, 50)).toBeNull();
    expect(await readLocalProductImage(`//evil.test${path}/photo.jpg`, 50)).toBeNull();
  });
});
