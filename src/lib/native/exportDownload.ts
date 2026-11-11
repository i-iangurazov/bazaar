import { shareBlobNative, type NativeShareResult } from "@/lib/native/files";

const csvMimeType = "text/csv";
const xlsxMimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const normalizeMime = (value: string) => value.split(";", 1)[0].trim().toLowerCase();

type DownloadFailure = "exportDownloadFailed" | "unauthorized" | "forbidden" | "exportJobNotFound" | "exportNotReady" | "exportFileMissing";
export class NativeExportDownloadError extends Error {
  constructor(readonly reason: DownloadFailure = "exportDownloadFailed") {
    super(reason);
  }
}

const usableFileName = (value: string | null | undefined) =>
  value && value !== "." && value !== ".." && !/[/\\]/.test(value) &&
    !Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ? value : null;

const responseFileName = (disposition: string | null) => {
  if (!disposition) return null;
  const extended = /(?:^|;)\s*filename\*\s*=\s*(?:"([^"]*)"|([^;]*))/i.exec(disposition);
  const encoded = extended && /^UTF-8'[^']*'(.*)$/i.exec((extended[1] ?? extended[2]).trim());
  if (encoded) {
    try {
      const name = usableFileName(decodeURIComponent(encoded[1]));
      if (name) return name;
    } catch { /* A malformed extended filename can still have a valid ASCII fallback. */ }
  }
  const quoted = /(?:^|;)\s*filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(disposition);
  if (quoted) return usableFileName(quoted[1].replace(/\\(.)/g, "$1"));
  const plain = /(?:^|;)\s*filename\s*=\s*([^;]*)/i.exec(disposition);
  return usableFileName(plain?.[1].trim());
};

const failureForStatus = (status: number): DownloadFailure => {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "exportJobNotFound";
  if (status === 409) return "exportNotReady";
  if (status === 410) return "exportFileMissing";
  return "exportDownloadFailed";
};

/** Fetch only the existing authenticated export endpoint. Never navigate the
 * WebView to its attachment or expose an artifact's underlying storage URL. */
export async function shareExportJobNative(input: {
  jobId: string;
  fileName?: string | null;
  mimeType?: string | null;
  signal?: AbortSignal;
  shouldShare: () => boolean;
}): Promise<NativeShareResult> {
  const isCurrent = () => !input.signal?.aborted && input.shouldShare();
  if (!isCurrent()) return { status: "discarded" };
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.jobId)) throw new NativeExportDownloadError();
  const controller = new AbortController();
  const abort = () => controller.abort();
  input.signal?.addEventListener("abort", abort, { once: true });
  // Bound only network/body acquisition. A user may keep the Share sheet open
  // longer; its terminal outcome is not inferred from a timeout.
  const timeout = setTimeout(abort, 60_000);
  let blob: Blob, fileName: string;
  try {
    const response = await fetch(`/api/exports/${encodeURIComponent(input.jobId)}`, {
      credentials: "same-origin", redirect: "error", cache: "no-store", signal: controller.signal,
    });
    if (!isCurrent()) return { status: "discarded" };
    if (!response.ok) throw new NativeExportDownloadError(failureForStatus(response.status));
    if (response.redirected) throw new NativeExportDownloadError();
    const mime = normalizeMime(response.headers.get("Content-Type") ?? "");
    if (![csvMimeType, xlsxMimeType].includes(mime) || (input.mimeType && normalizeMime(input.mimeType) !== mime))
      throw new NativeExportDownloadError();
    fileName = responseFileName(response.headers.get("Content-Disposition")) ?? usableFileName(input.fileName) ??
      `export-${input.jobId}.${mime === xlsxMimeType ? "xlsx" : "csv"}`;
    blob = await response.blob();
    if (!isCurrent()) return { status: "discarded" };
    if (!blob.size) throw new NativeExportDownloadError();
  } catch (error) {
    if (!isCurrent()) return { status: "discarded" };
    throw error instanceof NativeExportDownloadError ? error : new NativeExportDownloadError();
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", abort);
  }
  return shareBlobNative({ blob, fileName, title: "Bazaar export", shouldShare: isCurrent });
}
