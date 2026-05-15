export type PrintProvider =
  | "LOCAL_PRINT_AGENT"
  | "KIOSK_SILENT_PRINT"
  | "NETWORK_ESC_POS"
  | "MANUAL_BROWSER_PRINT";

export type LocalPrintAgentPrinter = {
  name: string;
  type?: string;
};

export type LocalPrintAgentBinding = {
  agentUrl: string;
  receiptPrinterName: string;
  labelPrinterName: string;
};

export type LocalPrintAgentJobType = "RECEIPT" | "BARCODE_LABEL";
export type LocalPrintAgentContentFormat = "PDF" | "HTML" | "RAW_ESC_POS" | "IMAGE";

export type LocalPrintAgentPrintInput = {
  storeId: string;
  printerName: string;
  jobType: LocalPrintAgentJobType;
  format: LocalPrintAgentContentFormat;
  content: string;
  options?: Record<string, unknown>;
  timeoutMs?: number;
};

export const defaultLocalPrintAgentUrl = "http://127.0.0.1:17777";
const defaultLocalPrintTimeoutMs = 8_000;

const normalizeAgentUrl = (value: string | null | undefined) => {
  const trimmed = value?.trim().replace(/\/+$/, "");
  return trimmed || defaultLocalPrintAgentUrl;
};

export const localPrintAgentBindingKey = (storeId: string) =>
  `bazaar:printing:local-agent:${storeId}`;

export const getLocalPrintAgentBinding = (storeId: string): LocalPrintAgentBinding => {
  if (typeof window === "undefined") {
    return {
      agentUrl: defaultLocalPrintAgentUrl,
      receiptPrinterName: "",
      labelPrinterName: "",
    };
  }

  const raw = window.localStorage.getItem(localPrintAgentBindingKey(storeId));
  if (!raw) {
    return {
      agentUrl: defaultLocalPrintAgentUrl,
      receiptPrinterName: "",
      labelPrinterName: "",
    };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<LocalPrintAgentBinding>;
    return {
      agentUrl: normalizeAgentUrl(parsed.agentUrl),
      receiptPrinterName: parsed.receiptPrinterName?.trim() ?? "",
      labelPrinterName: parsed.labelPrinterName?.trim() ?? "",
    };
  } catch {
    return {
      agentUrl: defaultLocalPrintAgentUrl,
      receiptPrinterName: "",
      labelPrinterName: "",
    };
  }
};

export const saveLocalPrintAgentBinding = (storeId: string, binding: LocalPrintAgentBinding) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    localPrintAgentBindingKey(storeId),
    JSON.stringify({
      agentUrl: normalizeAgentUrl(binding.agentUrl),
      receiptPrinterName: binding.receiptPrinterName.trim(),
      labelPrinterName: binding.labelPrinterName.trim(),
    }),
  );
};

const fetchWithTimeout = async (url: string, init: RequestInit = {}, timeoutMs = defaultLocalPrintTimeoutMs) => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
};

export const checkLocalPrintAgentHealth = async (agentUrl: string) => {
  const response = await fetchWithTimeout(`${normalizeAgentUrl(agentUrl)}/health`);
  if (!response.ok) {
    throw new Error("printAgentUnavailable");
  }
  return (await response.json().catch(() => ({ ok: true }))) as {
    ok?: boolean;
    version?: string;
  };
};

export const listLocalPrintAgentPrinters = async (agentUrl: string) => {
  const response = await fetchWithTimeout(`${normalizeAgentUrl(agentUrl)}/printers`);
  if (!response.ok) {
    throw new Error("printAgentUnavailable");
  }
  const body = (await response.json().catch(() => null)) as {
    printers?: LocalPrintAgentPrinter[];
  } | null;
  return body?.printers ?? [];
};

export const printViaLocalPrintAgent = async (
  agentUrl: string,
  input: LocalPrintAgentPrintInput,
) => {
  const response = await fetchWithTimeout(
    `${normalizeAgentUrl(agentUrl)}/print`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        printerName: input.printerName,
        jobType: input.jobType,
        format: input.format,
        content: input.content,
        options: input.options ?? {},
      }),
    },
    input.timeoutMs ?? defaultLocalPrintTimeoutMs,
  );
  if (!response.ok) {
    throw new Error("printAgentPrintFailed");
  }
  return (await response.json().catch(() => ({ ok: true }))) as {
    ok?: boolean;
    jobId?: string;
  };
};

export const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("blobReadFailed"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.includes(",") ? result.split(",")[1] ?? "" : result);
    };
    reader.readAsDataURL(blob);
  });

export const printPdfBlobViaLocalPrintAgent = async ({
  storeId,
  blob,
  binding,
  printerName,
  jobType,
  options,
  timeoutMs,
}: {
  storeId: string;
  blob: Blob;
  binding: LocalPrintAgentBinding;
  printerName: string;
  jobType: LocalPrintAgentJobType;
  options?: Record<string, unknown>;
  timeoutMs?: number;
}) => {
  const targetPrinter = printerName.trim();
  if (!targetPrinter) {
    throw new Error("printAgentPrinterMissing");
  }
  const content = await blobToBase64(blob);
  return printViaLocalPrintAgent(binding.agentUrl, {
    storeId,
    printerName: targetPrinter,
    jobType,
    format: "PDF",
    content,
    options,
    timeoutMs,
  });
};
