// @vitest-environment jsdom

import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  plugins: new Set(["Filesystem", "Share"]),
  writeFile: vi.fn(), getUri: vi.fn(), deleteFile: vi.fn(), rmdir: vi.fn(), share: vi.fn(), diagnostic: vi.fn(),
}));

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Cache: "CACHE" },
  Filesystem: { writeFile: native.writeFile, getUri: native.getUri, deleteFile: native.deleteFile, rmdir: native.rmdir },
}));
vi.mock("@capacitor/share", () => ({ Share: { share: native.share } }));
vi.mock("@/lib/native/platform", () => ({ isPluginAvailable: (name: string) => native.plugins.has(name) }));
vi.mock("@/lib/native/diagnostics", () => ({ reportNativeDiagnostic: native.diagnostic }));

import { shareBlobNative } from "@/lib/native/files";

const file = () => ({ blob: new Blob(["abc"], { type: "text/csv" }), fileName: "stock.csv", title: "Stock" });

beforeEach(() => {
  vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-4000-8000-000000000001" });
  native.plugins = new Set(["Filesystem", "Share"]);
  for (const mock of [native.writeFile, native.getUri, native.deleteFile, native.rmdir, native.share, native.diagnostic]) mock.mockReset();
  native.writeFile.mockImplementation(async ({ path }: { path: string }) => ({ uri: `file:///private/cache/${path}` }));
  native.getUri.mockImplementation(async ({ path }: { path: string }) => ({ uri: `file:///private/cache/${path}` }));
  native.deleteFile.mockResolvedValue(undefined);
  native.rmdir.mockResolvedValue(undefined);
  native.share.mockResolvedValue({ activityType: "com.apple.UIKit.activity.SaveToFiles" });
  native.diagnostic.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("native file share terminal outcomes", () => {
  it("shares the prepared private cache file and removes that exact file afterward", async () => {
    await expect(shareBlobNative(file())).resolves.toEqual({ status: "shared" });
    expect(native.writeFile).toHaveBeenCalledWith({
      path: "bazaar-share/00000000-0000-4000-8000-000000000001/stock.csv",
      data: "YWJj", directory: "CACHE", recursive: true,
    });
    const path = native.writeFile.mock.calls[0][0].path;
    expect(native.getUri).toHaveBeenCalledWith({ path, directory: "CACHE" });
    expect(native.share).toHaveBeenCalledWith({
      title: "Stock", dialogTitle: "Stock", files: [`file:///private/cache/${path}`],
    });
    expect(native.deleteFile).toHaveBeenCalledWith({ path, directory: "CACHE" });
    expect(native.rmdir).toHaveBeenCalledExactlyOnceWith({
      path: "bazaar-share/00000000-0000-4000-8000-000000000001", directory: "CACHE", recursive: false,
    });
    expect(native.deleteFile.mock.invocationCallOrder[0]).toBeLessThan(native.rmdir.mock.invocationCallOrder[0]);
    expect(native.diagnostic).not.toHaveBeenCalled();
  });

  it.each([new Error("Share canceled"), { message: "Share canceled" }, "Share canceled"])(
    "treats the actual sheet cancellation as quiet and terminal (%j)", async (error) => {
      native.share.mockRejectedValue(error);
      await expect(shareBlobNative(file())).resolves.toEqual({ status: "cancelled" });
      expect(native.share).toHaveBeenCalledTimes(1);
      expect(native.deleteFile).toHaveBeenCalledTimes(1);
      expect(native.rmdir).toHaveBeenCalledExactlyOnceWith({
        path: "bazaar-share/00000000-0000-4000-8000-000000000001", directory: "CACHE", recursive: false,
      });
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
    expect(native.rmdir).not.toHaveBeenCalled();
    expect(native.diagnostic).not.toHaveBeenCalled();
  });

  it.each(["shared", "cancelled"] as const)("does not replace %s with a cleanup error", async (status) => {
    if (status === "cancelled") native.share.mockRejectedValue(new Error("Share canceled"));
    native.deleteFile.mockRejectedValue(new Error("cache cleanup refused"));
    native.rmdir.mockRejectedValue(new Error("directory is not empty"));
    await expect(shareBlobNative(file())).resolves.toEqual({ status });
    expect(native.rmdir).toHaveBeenCalledExactlyOnceWith({
      path: "bazaar-share/00000000-0000-4000-8000-000000000001", directory: "CACHE", recursive: false,
    });
    expect(native.diagnostic).not.toHaveBeenCalled();
  });

  it("keeps a successful share when only its empty-directory cleanup fails", async () => {
    native.rmdir.mockRejectedValue(new Error("cache directory cleanup refused"));
    await expect(shareBlobNative(file())).resolves.toEqual({ status: "shared" });
    expect(native.deleteFile).toHaveBeenCalledTimes(1);
    expect(native.rmdir).toHaveBeenCalledTimes(1);
    expect(native.diagnostic).not.toHaveBeenCalled();
  });
});

describe("native file share names and attempt isolation", () => {
  it.each([
    ["price-list-2026-11-13_to_2026-11-13-qa123456.csv", "price-list-2026-11-13_to_2026-11-13-qa123456.csv"],
    ["../../price list.xlsx", "..-..-price-list.xlsx"],
    ["a".repeat(150) + ".xlsx", "a".repeat(115) + ".xlsx"],
    [".", "bazaar-file"], ["..", "bazaar-file"], ["", "bazaar-file"],
  ])("shares a safe visible basename for %s", async (fileName, basename) => {
    await expect(shareBlobNative({ ...file(), fileName })).resolves.toEqual({ status: "shared" });
    const sharedUri = native.share.mock.calls[0][0].files[0] as string;
    expect(new URL(sharedUri).pathname.split("/").at(-1)).toBe(basename);
    expect(native.writeFile.mock.calls[0][0].path).toBe(`bazaar-share/00000000-0000-4000-8000-000000000001/${basename}`);
  });

  it("keeps simultaneous same-name attempts separate and cleans only the completed attempt", async () => {
    let attempt = 0;
    vi.stubGlobal("crypto", { randomUUID: () => `00000000-0000-4000-8000-00000000000${++attempt}` });
    const settle = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
    native.share.mockImplementation(({ files }: { files: string[] }) => new Promise<void>((resolve, reject) => {
      settle.set(files[0], { resolve, reject });
    }));
    const first = shareBlobNative(file());
    await waitFor(() => expect(settle.size).toBe(1));
    const second = shareBlobNative(file());
    await waitFor(() => expect(settle.size).toBe(2));
    const firstPath = native.writeFile.mock.calls[0][0].path as string;
    const secondPath = native.writeFile.mock.calls[1][0].path as string;
    expect(firstPath).not.toBe(secondPath);
    expect([firstPath.split("/").at(-1), secondPath.split("/").at(-1)]).toEqual(["stock.csv", "stock.csv"]);

    settle.get(`file:///private/cache/${secondPath}`)!.reject(new Error("Share canceled"));
    await expect(second).resolves.toEqual({ status: "cancelled" });
    expect(native.deleteFile).toHaveBeenCalledExactlyOnceWith({ path: secondPath, directory: "CACHE" });
    expect(native.rmdir).toHaveBeenCalledExactlyOnceWith({ path: secondPath.slice(0, secondPath.lastIndexOf("/")), directory: "CACHE", recursive: false });
    expect(native.deleteFile).not.toHaveBeenCalledWith({ path: firstPath, directory: "CACHE" });

    settle.get(`file:///private/cache/${firstPath}`)!.resolve();
    await expect(first).resolves.toEqual({ status: "shared" });
    expect(native.deleteFile).toHaveBeenNthCalledWith(2, { path: firstPath, directory: "CACHE" });
    expect(native.rmdir).toHaveBeenNthCalledWith(2, { path: firstPath.slice(0, firstPath.lastIndexOf("/")), directory: "CACHE", recursive: false });
    expect(native.diagnostic).not.toHaveBeenCalled();
  });
});

describe("native file share audience guard", () => {
  it("does not prepare anything for an already invalidated export", async () => {
    await expect(shareBlobNative({ ...file(), shouldShare: () => false })).resolves.toEqual({ status: "discarded" });
    expect(native.writeFile).not.toHaveBeenCalled();
    expect(native.share).not.toHaveBeenCalled();
    expect(native.rmdir).not.toHaveBeenCalled();
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
    expect(native.rmdir).not.toHaveBeenCalled();
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
    expect(native.rmdir).toHaveBeenCalledExactlyOnceWith({ path: "bazaar-share/00000000-0000-4000-8000-000000000001", directory: "CACHE", recursive: false });
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
    expect(native.rmdir).toHaveBeenCalledExactlyOnceWith({ path: "bazaar-share/00000000-0000-4000-8000-000000000001", directory: "CACHE", recursive: false });
    expect(native.diagnostic).not.toHaveBeenCalled();
  });
});
