import qzTray from "qz-tray";

export type QzTrayBinding = {
  receiptPrinterName: string;
  labelPrinterName: string;
};

export type QzTrustStatus = "unknown" | "trusted" | "unsigned" | "error";

type QzTray = {
  security?: {
    setCertificatePromise?: (
      promise: (
        resolve: (certificate: string) => void,
        reject: (reason?: unknown) => void,
      ) => void,
    ) => void;
    setSignatureAlgorithm?: (algorithm: string) => void;
    setSignaturePromise?: (
      promise: (
        toSign: string,
      ) => (resolve: (signature: string) => void, reject: (reason?: unknown) => void) => void,
    ) => void;
  };
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

let securityInitialized = false;
let trustStatus: QzTrustStatus = "unknown";

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

export const initializeQzSecurity = async (): Promise<QzTrustStatus> => {
  if (securityInitialized) {
    return trustStatus;
  }

  const qz = getQzTray();
  const setCertificatePromise = qz.security?.setCertificatePromise;
  const setSignaturePromise = qz.security?.setSignaturePromise;
  if (!setCertificatePromise || !setSignaturePromise) {
    securityInitialized = true;
    trustStatus = "unsigned";
    return trustStatus;
  }

  try {
    const certificateResponse = await fetch("/api/qz/certificate", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (certificateResponse.status === 204) {
      securityInitialized = true;
      trustStatus = "unsigned";
      return trustStatus;
    }
    if (!certificateResponse.ok) {
      securityInitialized = true;
      trustStatus = "error";
      return trustStatus;
    }

    const certificate = (await certificateResponse.text()).trim();
    if (!certificate) {
      securityInitialized = true;
      trustStatus = "unsigned";
      return trustStatus;
    }

    setCertificatePromise((resolve) => resolve(certificate));
    qz.security?.setSignatureAlgorithm?.("SHA512");
    setSignaturePromise((toSign) => (resolve, reject) => {
      void fetch("/api/qz/sign", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: toSign }),
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(await response.text());
          }
          const payload = (await response.json()) as { signature?: string };
          if (!payload.signature) {
            throw new Error("qzSignatureMissing");
          }
          resolve(payload.signature);
        })
        .catch(reject);
    });

    securityInitialized = true;
    trustStatus = "trusted";
    return trustStatus;
  } catch {
    securityInitialized = true;
    trustStatus = "error";
    return trustStatus;
  }
};

export const getQzTrustStatus = () => trustStatus;

export const connectQzTray = async () => {
  await initializeQzSecurity();
  const qz = getQzTray();
  if (!qz.websocket.isActive()) {
    await qz.websocket.connect({ retries: 3, delay: 1 });
  }
  if (!qz.websocket.isActive()) {
    throw new Error("qzNotConnected");
  }
  return qz;
};

export const disconnectQzTray = async () => {
  const qz = getQzTray();
  if (qz.websocket.isActive()) {
    await qz.websocket.disconnect();
  }
};

export const isQzTrayConnected = () => {
  try {
    return getQzTray().websocket.isActive();
  } catch {
    return false;
  }
};

export const listQzPrinters = async () => {
  const qz = await connectQzTray();
  return qz.printers.find();
};

export const findQzPrinter = async (name: string) => {
  const target = name.trim();
  if (!target) {
    return false;
  }
  const printers = await listQzPrinters();
  return printers.some((printer) => printer === target);
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
  return { trustStatus };
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
  return { trustStatus };
};

export const qzTrayErrorMessageKey = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  if (message === "qzPrinterMissing") return "qzPrinterMissing";
  if (message === "qzNotInstalled") return "qzNotInstalled";
  if (message === "qzNotConnected" || normalized.includes("connect")) return "qzNotConnected";
  if (normalized.includes("qzsigningnotconfigured")) return "qzTrustMissing";
  if (normalized.includes("certificate") || normalized.includes("sign")) return "qzCertificateError";
  if (normalized.includes("printer") && normalized.includes("not")) return "qzPrinterNotFound";
  if (normalized.includes("timeout")) return "qzTimeout";
  return "qzPrintFailed";
};

export const qzService = {
  initializeSecurity: initializeQzSecurity,
  connect: connectQzTray,
  disconnect: disconnectQzTray,
  isConnected: isQzTrayConnected,
  getConnectionStatus: isQzTrayConnected,
  listPrinters: listQzPrinters,
  findPrinter: findQzPrinter,
  printReceipt: printPdfBlobViaQzTray,
  printBarcode: printPdfBlobViaQzTray,
  getTrustStatus: getQzTrustStatus,
  mapQzError: qzTrayErrorMessageKey,
};
