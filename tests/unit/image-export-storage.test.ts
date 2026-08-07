import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ImageExportZipWriter } from "@/server/services/imageExportZip";

const owner = { userId: "user-alpha", organizationId: "org-alpha" };

describe("durable image export artifacts", () => {
  beforeEach(async () => {
    vi.stubEnv("IMAGE_STORAGE_PROVIDER", "local");
    const { clearImageExportStorageForTests } = await import("@/lib/imageExportStore");
    await clearImageExportStorageForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("streams valid ZIP entries to disk without retaining a process artifact", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bazaar-zip-writer-test-"));
    const path = join(directory, "images.zip");
    try {
      const writer = new ImageExportZipWriter(path, 2 * 1024 * 1024);
      for (let index = 0; index < 250; index += 1) {
        await writer.addFile(
          `product-${index}/image-1.jpg`,
          Buffer.from(`bounded-image-${index}`),
        );
      }
      const result = await writer.close();
      const archive = await JSZip.loadAsync(await readFile(path));

      expect(result.entryCount).toBe(250);
      expect(result.byteLength).toBeLessThan(100_000);
      expect(Object.keys(archive.files)).toHaveLength(250);
      expect(await archive.file("product-249/image-1.jpg")?.async("string")).toBe(
        "bounded-image-249",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("survives a module reload, preserves owner binding, and atomically consumes once", async () => {
    const token = randomUUID();
    const payload = new TextEncoder().encode("cross-instance-artifact");
    const firstModule = await import("@/lib/imageExportStore");
    await firstModule.storeZipBuffer(token, payload, "images.zip", owner);

    vi.resetModules();
    const secondModule = await import("@/lib/imageExportStore");
    expect(
      await secondModule.consumeZip(token, {
        userId: "different-user",
        organizationId: owner.organizationId,
      }),
    ).toBeUndefined();
    expect(await secondModule.hasStoredZipForTests(token)).toBe(true);

    const consumed = await secondModule.consumeZip(token, owner);
    expect(consumed?.filename).toBe("images.zip");
    expect(new Uint8Array(await new Response(consumed?.data).arrayBuffer())).toEqual(payload);
    expect(await secondModule.consumeZip(token, owner)).toBeUndefined();
  });

  it("expires artifacts and leaves corrupt or invalid tokens unavailable", async () => {
    const storage = await import("@/lib/imageExportStore");
    const token = randomUUID();
    await storage.storeZipBuffer(token, new Uint8Array([1, 2, 3]), "expired.zip", owner, {
      ttlMs: -1,
    });

    expect(await storage.consumeZip(token, owner)).toBeUndefined();
    expect(await storage.hasStoredZipForTests(token)).toBe(false);
    expect(await storage.consumeZip("../../escape", owner)).toBeUndefined();
  });

  it("rejects archives above the configured cap before finalization", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bazaar-zip-limit-test-"));
    const path = join(directory, "images.zip");
    const writer = new ImageExportZipWriter(path, 64);
    try {
      await expect(writer.addFile("image.jpg", Buffer.alloc(128))).rejects.toThrow(
        "imageExportTooLarge",
      );
    } finally {
      await writer.abort();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
