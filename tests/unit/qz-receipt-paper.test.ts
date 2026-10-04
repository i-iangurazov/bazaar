import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const qz = vi.hoisted(() => ({
  configs: {
    create: vi.fn((printerName: string, options?: Record<string, unknown>) => ({ printerName, options })),
  },
  websocket: { isActive: () => true },
  print: vi.fn(async () => {}),
}));

vi.mock("qz-tray", () => ({ default: qz }));

import { printPdfBlobViaQzTray, qzService } from "@/lib/qzTrayPrint";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", {});
  vi.stubGlobal("FileReader", class {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then((bytes) => {
        this.result = `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`;
        this.onload?.();
      }).catch(() => this.onerror?.());
    }
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("QZ receipt paper", () => {
  it("uses the full PDF length for receipts instead of the driver's shorter default paper", async () => {
    const blob = new Blob(["%PDF-1.3\n/MediaBox [0 0 164.409449 720]\n"], { type: "application/pdf" });
    await qzService.printReceipt({ printerName: "receipts", blob });

    const options = qz.configs.create.mock.calls[0][1]!;
    expect(options).toMatchObject({ units: "mm", margins: 0, scaleContent: false });
    const size = options.size as { width: number; height: number; custom: boolean };
    expect(size.width).toBeCloseTo(58, 4);
    expect(size.height).toBe(254);
    expect(size.custom).toBe(true);
    expect(qz.print).toHaveBeenCalledWith(expect.anything(), [expect.objectContaining({
      type: "pixel", format: "pdf",
      options: { pageWidth: size.width, pageHeight: size.height },
    })]);
  });

  it("preserves the existing driver configuration for barcode and label printing", async () => {
    await printPdfBlobViaQzTray({
      printerName: "labels",
      blob: new Blob(["%PDF-1.3\n/MediaBox [0 0 164.409449 720]\n"]),
    });

    expect(qz.configs.create).toHaveBeenCalledWith("labels");
    expect(qz.print).toHaveBeenCalledWith(expect.anything(), [expect.not.objectContaining({
      options: expect.anything(),
    })]);
  });

  it("rejects an invalid receipt page before dispatching a truncated print job", async () => {
    await expect(qzService.printReceipt({
      printerName: "receipts", blob: new Blob(["%PDF-1.3\n/MediaBox [0 0 58 0]\n"]),
    })).rejects.toThrow("pdfPageSizeInvalid");
    expect(qz.print).not.toHaveBeenCalled();
  });
});
