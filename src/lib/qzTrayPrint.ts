import qzTray from "qz-tray";

export type QzTrayBinding = {
  receiptPrinterName: string;
  labelPrinterName: string;
};

type QzTray = {
  websocket: {
    connect: (options?: { retries?: number; delay?: number }) => Promise<void>;
    disconnect: () => Promise<void>;
    isActive: () => boolean;
  };
  printers: {
    find: () => Promise<string[]>;
  };
  configs: {
    create: (printerName: string, options?: Record<string, unknown>) => unknown;
  };
  print: (config: unknown, data: Array<Record<string, unknown>>) => Promise<void>;
};

export type QzTrayStatus = "idle" | "checking" | "connected" | "error";

export const qzTrayBindingKey = (storeId: string) => `bazaar:printing:qz-tray:${storeId}`;

export const getQzTrayBinding = (storeId: string): QzTrayBinding => {
  if (typeof window === "undefined") {
    return { receiptPrinterName: "", labelPrinterName: "" };
  }
  const raw = window.localStorage.getItem(qzTrayBindingKey(storeId));
  if (!raw) {
    return { receiptPrinterName: "", labelPrinterName: "" };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<QzTrayBinding>;
    return {
      receiptPrinterName: parsed.receiptPrinterName?.trim() ?? "",
      labelPrinterName: parsed.labelPrinterName?.trim() ?? "",
    };
  } catch {
    return { receiptPrinterName: "", labelPrinterName: "" };
  }
};

export const saveQzTrayBinding = (storeId: string, binding: QzTrayBinding) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    qzTrayBindingKey(storeId),
    JSON.stringify({
      receiptPrinterName: binding.receiptPrinterName.trim(),
      labelPrinterName: binding.labelPrinterName.trim(),
    }),
  );
};

export const getQzTray = () => {
  if (typeof window === "undefined") {
    throw new Error("qzNotInstalled");
  }
  return qzTray as QzTray;
};

export const connectQzTray = async () => {
  const qz = getQzTray();
  if (!qz.websocket.isActive()) {
    await qz.websocket.connect({ retries: 3, delay: 1 });
  }
  if (!qz.websocket.isActive()) {
    throw new Error("qzNotConnected");
  }
  return qz;
};

export const listQzPrinters = async () => {
  const qz = await connectQzTray();
  return qz.printers.find();
};

export const printHtmlViaQzTray = async ({
  printerName,
  html,
}: {
  printerName: string;
  html: string;
}) => {
  const targetPrinter = printerName.trim();
  if (!targetPrinter) {
    throw new Error("qzPrinterMissing");
  }
  const qz = await connectQzTray();
  const config = qz.configs.create(targetPrinter);
  await qz.print(config, [{ type: "html", format: "plain", data: html }]);
};

export const printPdfBlobViaQzTray = async ({
  printerName,
  blob,
}: {
  printerName: string;
  blob: Blob;
}) => {
  const targetPrinter = printerName.trim();
  if (!targetPrinter) {
    throw new Error("qzPrinterMissing");
  }
  const content = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("blobReadFailed"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.includes(",") ? result.split(",")[1] ?? "" : result);
    };
    reader.readAsDataURL(blob);
  });
  const qz = await connectQzTray();
  const config = qz.configs.create(targetPrinter);
  await qz.print(config, [{ type: "pixel", format: "pdf", flavor: "base64", data: content }]);
};

export const qzTrayErrorMessageKey = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  if (message === "qzPrinterMissing") return "qzPrinterMissing";
  if (message === "qzNotInstalled") return "qzNotInstalled";
  if (message === "qzNotConnected" || normalized.includes("connect")) return "qzNotConnected";
  if (normalized.includes("certificate") || normalized.includes("sign")) return "qzCertificateError";
  if (normalized.includes("printer") && normalized.includes("not")) return "qzPrinterNotFound";
  if (normalized.includes("timeout")) return "qzTimeout";
  return "qzPrintFailed";
};
