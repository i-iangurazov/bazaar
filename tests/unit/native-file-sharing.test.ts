// @vitest-environment jsdom

import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  plugins: new Set(["Filesystem", "Share"]),
  writeFile: vi.fn(), getUri: vi.fn(), deleteFile: vi.fn(), share: vi.fn(), diagnostic: vi.fn(),
}));

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Cache: "CACHE" },
  Filesystem: { writeFile: native.writeFile, getUri: native.getUri, deleteFile: native.deleteFile },
}));
vi.mock("@capacitor/share", () => ({ Share: { share: native.share } }));
vi.mock("@/lib/native/platform", () => ({ isPluginAvailable: (name: string) => native.plugins.has(name) }));
vi.mock("@/lib/native/diagnostics", () => ({ reportNativeDiagnostic: native.diagnostic }));

import { shareBlobNative } from "@/lib/native/files";

const file = () => ({ blob: new Blob(["abc"], { type: "text/csv" }), fileName: "stock.csv", title: "Stock" });

beforeEach(() => {
  vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-4000-8000-000000000001" });
  native.plugins = new Set(["Filesystem", "Share"]);
  for (const mock of [native.writeFile, native.getUri, native.deleteFile, native.share, native.diagnostic]) mock.mockReset();
  native.writeFile.mockResolvedValue({ uri: "file:///private/cache/stock.csv" });
  native.getUri.mockResolvedValue({ uri: "file:///private/cache/stock.csv" });
  native.deleteFile.mockResolvedValue(undefined);
  native.share.mockResolvedValue({ activityType: "com.apple.UIKit.activity.SaveToFiles" });
  native.diagnostic.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("native file share terminal outcomes", () => {
  it("shares the prepared private cache file and removes that exact file afterward", async () => {
    await expect(shareBlobNative(file())).resolves.toEqual({ status: "shared" });
    expect(native.writeFile).toHaveBeenCalledWith({
      path: expect.stringMatching(/^bazaar-share\/[A-Za-z0-9-]+-stock\.csv$/),
      data: "YWJj", directory: "CACHE", recursive: true,
    });
    const path = native.writeFile.mock.calls[0][0].path;
    expect(native.getUri).toHaveBeenCalledWith({ path, directory: "CACHE" });
    expect(native.share).toHaveBeenCalledWith({
      title: "Stock", dialogTitle: "Stock", files: ["file:///private/cache/stock.csv"],
    });
    expect(native.deleteFile).toHaveBeenCalledWith({ path, directory: "CACHE" });
    expect(native.diagnostic).not.toHaveBeenCalled();
  });

  it.each([new Error("Share canceled"), { message: "Share canceled" }, "Share canceled"])(
    "treats the actual sheet cancellation as quiet and terminal (%j)", async (error) => {
      native.share.mockRejectedValue(error);
      await expect(shareBlobNative(file())).resolves.toEqual({ status: "cancelled" });
      expect(native.share).toHaveBeenCalledTimes(1);
      expect(native.deleteFile).toHaveBeenCalledTimes(1);
      expect(native.diagnostic).not.toHaveBeenCalled();
    },
  );

  it("does not misclassify an unrelated sharing failure as cancellation", async () => {
    native.share.mockRejectedValue(new Error("Error sharing item"));
    await expect(shareBlobNative(file())).resolves.toEqual({ status: "failed" });
    expect(native.deleteFile).toHaveBeenCalledTimes(1);
    expect(native.diagnostic).toHaveBeenCalledExactlyOnceWith("native_share_failed");
  });

  it("does not hide a preparation failure whose message happens to resemble a cancellation", async () => {
    native.writeFile.mockRejectedValue(new Error("Share canceled"));
    await expect(shareBlobNative(file())).resolves.toEqual({ status: "failed" });
    expect(native.share).not.toHaveBeenCalled();
    expect(native.deleteFile).toHaveBeenCalledWith({ path: native.writeFile.mock.calls[0][0].path, directory: "CACHE" });
    expect(native.diagnostic).toHaveBeenCalledExactlyOnceWith("native_share_failed");
  });

  it("cleans a prepared file when obtaining its native URI fails", async () => {
    native.getUri.mockRejectedValue(new Error("unreadable cache"));
    await expect(shareBlobNative(file())).resolves.toEqual({ status: "failed" });
    expect(native.share).not.toHaveBeenCalled();
    expect(native.deleteFile).toHaveBeenCalledTimes(1);
    expect(native.diagnostic).toHaveBeenCalledExactlyOnceWith("native_share_failed");
  });

  it.each(["Filesystem", "Share"])("keeps a missing %s plugin distinct from a failed share", async (plugin) => {
    native.plugins.delete(plugin);
    await expect(shareBlobNative(file())).resolves.toEqual({ status: "unavailable" });
    expect(native.writeFile).not.toHaveBeenCalled();
    expect(native.share).not.toHaveBeenCalled();
    expect(native.deleteFile).not.toHaveBeenCalled();
    expect(native.diagnostic).not.toHaveBeenCalled();
  });

  it.each(["shared", "cancelled"] as const)("does not replace %s with a cleanup error", async (status) => {
    if (status === "cancelled") native.share.mockRejectedValue(new Error("Share canceled"));
    native.deleteFile.mockRejectedValue(new Error("cache cleanup refused"));
    await expect(shareBlobNative(file())).resolves.toEqual({ status });
    expect(native.diagnostic).not.toHaveBeenCalled();
  });
});

describe("native file share audience guard", () => {
  it("does not prepare anything for an already invalidated export", async () => {
    await expect(shareBlobNative({ ...file(), shouldShare: () => false })).resolves.toEqual({ status: "discarded" });
    expect(native.writeFile).not.toHaveBeenCalled();
    expect(native.share).not.toHaveBeenCalled();
    expect(native.diagnostic).not.toHaveBeenCalled();
  });

  it("rechecks after the asynchronous blob read before creating a cache file", async () => {
    let current = true;
    const result = shareBlobNative({ ...file(), shouldShare: () => current });
    current = false;
    await expect(result).resolves.toEqual({ status: "discarded" });
    expect(native.writeFile).not.toHaveBeenCalled();
    expect(native.share).not.toHaveBeenCalled();
    expect(native.deleteFile).not.toHaveBeenCalled();
  });

  it("cleans the file instead of sharing when the audience changes during the cache write", async () => {
    let current = true, finishWrite!: () => void;
    native.writeFile.mockImplementation(() => new Promise<void>((resolve) => { finishWrite = resolve; }));
    const result = shareBlobNative({ ...file(), shouldShare: () => current });
    await waitFor(() => expect(native.writeFile).toHaveBeenCalledTimes(1));
    current = false;
    finishWrite();
    await expect(result).resolves.toEqual({ status: "discarded" });
    expect(native.getUri).not.toHaveBeenCalled();
    expect(native.share).not.toHaveBeenCalled();
    expect(native.deleteFile).toHaveBeenCalledTimes(1);
    expect(native.diagnostic).not.toHaveBeenCalled();
  });

  it("rechecks immediately before the sheet after resolving the native URI", async () => {
    let current = true, finishUri!: (value: { uri: string }) => void;
    native.getUri.mockImplementation(() => new Promise<{ uri: string }>((resolve) => { finishUri = resolve; }));
    const result = shareBlobNative({ ...file(), shouldShare: () => current });
    await waitFor(() => expect(native.getUri).toHaveBeenCalledTimes(1));
    current = false;
    finishUri({ uri: "file:///private/cache/stock.csv" });
    await expect(result).resolves.toEqual({ status: "discarded" });
    expect(native.share).not.toHaveBeenCalled();
    expect(native.deleteFile).toHaveBeenCalledTimes(1);
    expect(native.diagnostic).not.toHaveBeenCalled();
  });
});
