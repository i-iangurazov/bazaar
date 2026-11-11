// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ share: vi.fn() }));
vi.mock("@/lib/native/files", () => ({ shareBlobNative: native.share }));

import { shareExportJobNative } from "@/lib/native/exportDownload";

const fetchFile = vi.fn();
const csvMime = "text/csv;charset=utf-8";
const xlsxMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const request = () => ({ jobId: "owned-job", fileName: "fallback.csv", mimeType: csvMime, shouldShare: () => true });
const response = (options: { status?: number; mime?: string; disposition?: string; blob?: Blob; redirected?: boolean } = {}) => ({
  ok: (options.status ?? 200) === 200,
  status: options.status ?? 200,
  redirected: options.redirected ?? false,
  headers: new Headers({
    "Content-Type": options.mime ?? csvMime,
    ...(options.disposition === undefined ? {} : { "Content-Disposition": options.disposition }),
  }),
  blob: vi.fn().mockResolvedValue(options.blob ?? new Blob(["SKU;price\r\nTEST-1;120.50"], { type: options.mime ?? csvMime })),
});

beforeEach(() => {
  fetchFile.mockReset().mockResolvedValue(response());
  native.share.mockReset().mockResolvedValue({ status: "shared" });
  vi.stubGlobal("fetch", fetchFile);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("authenticated native export downloads", () => {
  it("fetches only the owned API path with normal same-origin auth and shares the exact CSV bytes/name", async () => {
    const blob = new Blob(["SKU;price\r\nTEST-1;120.50"], { type: csvMime });
    fetchFile.mockResolvedValue(response({ blob, disposition: 'attachment; filename="prices.csv"' }));
    await expect(shareExportJobNative(request())).resolves.toEqual({ status: "shared" });
    expect(fetchFile).toHaveBeenCalledExactlyOnceWith("/api/exports/owned-job", expect.objectContaining({
      credentials: "same-origin", redirect: "error", cache: "no-store", signal: expect.any(AbortSignal),
    }));
    expect(native.share).toHaveBeenCalledWith(expect.objectContaining({ blob, fileName: "prices.csv", title: "Bazaar export" }));
  });

  it("keeps XLSX binary content and the UTF-8 filename from HTTP authoritative", async () => {
    const fileName = "Прайс лист.xlsx", blob = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], { type: xlsxMime });
    fetchFile.mockResolvedValue(response({ mime: xlsxMime, blob,
      disposition: `attachment; filename="ascii-fallback.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}` }));
    await shareExportJobNative({ ...request(), mimeType: xlsxMime });
    expect(native.share).toHaveBeenCalledWith(expect.objectContaining({ blob, fileName }));
  });

  it("uses a valid quoted filename when an extended filename is malformed", async () => {
    fetchFile.mockResolvedValue(response({ disposition: 'attachment; filename="price list.csv"; filename*=UTF-8\'\'%ZZ' }));
    await shareExportJobNative(request());
    expect(native.share).toHaveBeenCalledWith(expect.objectContaining({ fileName: "price list.csv" }));
  });

  it("does not accept path/control characters in a filename and keeps the safe job fallback", async () => {
    fetchFile.mockResolvedValue(response({ disposition: "attachment; filename*=UTF-8''..%2Fprivate%0A.csv" }));
    await shareExportJobNative(request());
    expect(native.share).toHaveBeenCalledWith(expect.objectContaining({ fileName: "fallback.csv" }));
  });

  it("derives an extension from verified HTTP MIME only when both filename sources are missing", async () => {
    fetchFile.mockResolvedValue(response({ mime: xlsxMime }));
    await shareExportJobNative({ ...request(), fileName: null, mimeType: xlsxMime });
    expect(native.share).toHaveBeenCalledWith(expect.objectContaining({ fileName: "export-owned-job.xlsx" }));
  });

  it.each(["cancelled", "failed", "unavailable", "discarded"])("keeps the terminal native %s outcome without a second fetch", async (status) => {
    native.share.mockResolvedValue({ status });
    await expect(shareExportJobNative(request())).resolves.toEqual({ status });
    expect(fetchFile).toHaveBeenCalledTimes(1);
    expect(native.share).toHaveBeenCalledTimes(1);
  });

  it.each([[401, "unauthorized"], [403, "forbidden"], [404, "exportJobNotFound"], [409, "exportNotReady"],
    [410, "exportFileMissing"], [500, "exportDownloadFailed"]] as const)("does not share an HTTP %s failure", async (status, reason) => {
    fetchFile.mockResolvedValue(response({ status }));
    await expect(shareExportJobNative(request())).rejects.toMatchObject({ reason });
    expect(native.share).not.toHaveBeenCalled();
  });

  it.each(["text/html", "application/json", "application/pdf", "application/octet-stream"])("rejects a non-export %s response before consuming it", async (mime) => {
    const result = response({ mime }); fetchFile.mockResolvedValue(result);
    await expect(shareExportJobNative(request())).rejects.toMatchObject({ reason: "exportDownloadFailed" });
    expect(result.blob).not.toHaveBeenCalled();
    expect(native.share).not.toHaveBeenCalled();
  });

  it("rejects a different export format than the selected job metadata", async () => {
    fetchFile.mockResolvedValue(response({ mime: xlsxMime }));
    await expect(shareExportJobNative(request())).rejects.toMatchObject({ reason: "exportDownloadFailed" });
    expect(native.share).not.toHaveBeenCalled();
  });

  it("never shares an unexpectedly redirected or empty attachment", async () => {
    fetchFile.mockResolvedValueOnce(response({ redirected: true })).mockResolvedValueOnce(response({ blob: new Blob([]) }));
    await expect(shareExportJobNative(request())).rejects.toMatchObject({ reason: "exportDownloadFailed" });
    await expect(shareExportJobNative(request())).rejects.toMatchObject({ reason: "exportDownloadFailed" });
    expect(native.share).not.toHaveBeenCalled();
  });

  it.each(["../../customer-file", "https://another.invalid/file", "owned-job?org=other"])("rejects an unpinned job identifier %s before fetching", async (jobId) => {
    await expect(shareExportJobNative({ ...request(), jobId })).rejects.toMatchObject({ reason: "exportDownloadFailed" });
    expect(fetchFile).not.toHaveBeenCalled();
    expect(native.share).not.toHaveBeenCalled();
  });

  it("normalizes a network rejection without exposing its arbitrary body/message", async () => {
    fetchFile.mockRejectedValue(new Error("private upstream response"));
    await expect(shareExportJobNative(request())).rejects.toMatchObject({ message: "exportDownloadFailed" });
    expect(native.share).not.toHaveBeenCalled();
  });
});

describe("native download audience and lifetime", () => {
  it("does not fetch an already stale or aborted request", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(shareExportJobNative({ ...request(), signal: controller.signal })).resolves.toEqual({ status: "discarded" });
    await expect(shareExportJobNative({ ...request(), shouldShare: () => false })).resolves.toEqual({ status: "discarded" });
    expect(fetchFile).not.toHaveBeenCalled();
  });

  it("does not consume or share a response after the account changes", async () => {
    let current = true, finish!: (value: ReturnType<typeof response>) => void;
    fetchFile.mockImplementation(() => new Promise<ReturnType<typeof response>>((resolve) => { finish = resolve; }));
    const pending = shareExportJobNative({ ...request(), shouldShare: () => current });
    current = false; const late = response(); finish(late);
    await expect(pending).resolves.toEqual({ status: "discarded" });
    expect(late.blob).not.toHaveBeenCalled();
    expect(native.share).not.toHaveBeenCalled();
  });

  it("discards a blob completed after the store context changes", async () => {
    let current = true, finish!: (value: Blob) => void;
    const result = response();
    result.blob.mockImplementation(() => new Promise<Blob>((resolve) => { finish = resolve; }));
    fetchFile.mockResolvedValue(result);
    const pending = shareExportJobNative({ ...request(), shouldShare: () => current });
    await Promise.resolve(); current = false; finish(new Blob(["old data"], { type: csvMime }));
    await expect(pending).resolves.toEqual({ status: "discarded" });
    expect(native.share).not.toHaveBeenCalled();
  });

  it("passes the live audience check into cache preparation, not only HTTP acquisition", async () => {
    let current = true;
    native.share.mockImplementation(async (input: { shouldShare: () => boolean }) => {
      expect(input.shouldShare()).toBe(true); current = false; expect(input.shouldShare()).toBe(false);
      return { status: "discarded" };
    });
    await expect(shareExportJobNative({ ...request(), shouldShare: () => current })).resolves.toEqual({ status: "discarded" });
  });

  it("bounds a stalled network request as a retryable failure, not as a user cancellation", async () => {
    vi.useFakeTimers();
    fetchFile.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const pending = shareExportJobNative(request());
    const failure = expect(pending).rejects.toMatchObject({ reason: "exportDownloadFailed" });
    await vi.advanceTimersByTimeAsync(60_000); await failure;
    expect(native.share).not.toHaveBeenCalled();
  });

  it("does not apply the acquisition timeout to a Share sheet the user keeps open", async () => {
    vi.useFakeTimers();
    let finish!: (value: { status: string }) => void;
    native.share.mockImplementation(() => new Promise<{ status: string }>((resolve) => { finish = resolve; }));
    const pending = shareExportJobNative(request());
    await Promise.resolve(); await Promise.resolve();
    expect(native.share).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchFile.mock.calls[0][1].signal.aborted).toBe(false);
    finish({ status: "shared" });
    await expect(pending).resolves.toEqual({ status: "shared" });
  });

  it("stops the network when the page is gone and treats that as discarded", async () => {
    const controller = new AbortController();
    fetchFile.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const pending = shareExportJobNative({ ...request(), signal: controller.signal }); controller.abort();
    await expect(pending).resolves.toEqual({ status: "discarded" });
    expect(native.share).not.toHaveBeenCalled();
  });
});
