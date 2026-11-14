// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const native = vi.hoisted(() => ({ enabled: true, share: vi.fn() }));
vi.mock("@/lib/native/platform", () => ({ isNativeApp: () => native.enabled }));
vi.mock("@/lib/native/files", () => ({ shareBlobNative: native.share }));

import { downloadTableFile } from "@/lib/fileExport";
import { downloadPdfBlob, printPdfBlob } from "@/lib/pdfClient";

const createObjectURL = vi.fn(() => "blob:bazaar-export");
const revokeObjectURL = vi.fn();
const table = { format: "csv" as const, fileNameBase: "stock", header: ["SKU"], rows: [["TEST-1"]] };
const pdf = () => new Blob(["test PDF"], { type: "application/pdf" });
let click: MockInstance<HTMLAnchorElement["click"]>;
let open: MockInstance<Window["open"]>;

beforeEach(() => {
  native.enabled = true;
  native.share.mockReset().mockResolvedValue({ status: "shared" });
  createObjectURL.mockClear(); revokeObjectURL.mockClear();
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  open = vi.spyOn(window, "open").mockReturnValue(null);
});
afterEach(() => {
  vi.clearAllTimers(); vi.useRealTimers();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe("table export native outcome handling", () => {
  it.each(["csv", "xlsx"] as const)("never retries a cancelled %s share using a browser download", async (format) => {
    native.share.mockResolvedValue({ status: "cancelled" });
    await downloadTableFile({ ...table, format });
    expect(native.share).toHaveBeenCalledTimes(1);
    expect(native.share).toHaveBeenCalledWith(expect.objectContaining({ fileName: `stock.${format}` }));
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it.each(["shared", "discarded"])("does not run a browser fallback for %s", async (status) => {
    native.share.mockResolvedValue({ status });
    await downloadTableFile(table);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it.each(["failed", "unavailable"])("preserves the existing browser fallback for %s", async (status) => {
    native.share.mockResolvedValue({ status });
    await downloadTableFile(table);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:bazaar-export");
  });

  it("passes the current audience guard through native preparation and blocks a stale fallback", async () => {
    let current = true, finishShare!: (value: { status: string }) => void;
    native.share.mockImplementation(() => new Promise<{ status: string }>((resolve) => { finishShare = resolve; }));
    const shouldDownload = () => current;
    const result = downloadTableFile({ ...table, shouldDownload });
    expect(native.share).toHaveBeenCalledWith(expect.objectContaining({ shouldShare: shouldDownload }));
    current = false;
    finishShare({ status: "unavailable" });
    await result;
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it("does not invoke native or browser output for an invalidated export", async () => {
    await downloadTableFile({ ...table, shouldDownload: () => false });
    expect(native.share).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("retains browser download and object URL cleanup outside the native app", async () => {
    native.enabled = false;
    await downloadTableFile(table);
    expect(native.share).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:bazaar-export");
  });
});

describe("PDF native outcome handling", () => {
  it.each(["shared", "cancelled", "discarded"])("does not download or open a new window after %s", async (status) => {
    native.share.mockResolvedValue({ status });
    downloadPdfBlob(pdf(), "receipt.pdf");
    await Promise.resolve();
    expect(native.share).toHaveBeenCalledTimes(1);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it.each(["failed", "unavailable"])("keeps the previous PDF download fallback for %s", async (status) => {
    native.share.mockResolvedValue({ status });
    downloadPdfBlob(pdf(), "receipt.pdf");
    await Promise.resolve();
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:bazaar-export");
  });

  it("returns explicit print cancellation without claiming an open PDF or a print attempt", async () => {
    native.share.mockResolvedValue({ status: "cancelled" });
    await expect(printPdfBlob(pdf())).resolves.toEqual({
      opened: false, autoPrintAttempted: false, fallbackUsed: false, nativeShareStatus: "cancelled",
    });
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it.each(["failed", "unavailable"])("does not report print success for %s", async (status) => {
    native.share.mockResolvedValue({ status });
    await expect(printPdfBlob(pdf())).resolves.toEqual({
      opened: false, autoPrintAttempted: false, fallbackUsed: true, nativeShareStatus: status,
    });
    expect(open).not.toHaveBeenCalled();
  });

  it("reports the native share sheet without claiming automatic printing", async () => {
    await expect(printPdfBlob(pdf())).resolves.toEqual({
      opened: true, autoPrintAttempted: false, fallbackUsed: false, nativeShareStatus: "shared",
    });
    expect(open).not.toHaveBeenCalled();
  });

  it("preserves ordinary PDF downloads and manual-print fallback on the website", async () => {
    native.enabled = false;
    downloadPdfBlob(pdf(), "receipt.pdf");
    expect(click).toHaveBeenCalledTimes(1);
    vi.useFakeTimers();
    await expect(printPdfBlob(pdf())).resolves.toEqual({ opened: false, autoPrintAttempted: false, fallbackUsed: true });
    expect(open).toHaveBeenCalledExactlyOnceWith("blob:bazaar-export", "_blank");
    expect(click).toHaveBeenCalledTimes(2);
    expect(native.share).not.toHaveBeenCalled();
  });
});
