const pdfMimeType = "application/pdf";

export const fetchPdfBlob = async (input: {
  url: string;
  init?: RequestInit;
}) => {
  const response = await fetch(input.url, input.init);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "pdfRequestFailed");
  }
  const contentType = (response.headers.get("Content-Type") ?? "").toLowerCase();
  if (!contentType.includes(pdfMimeType)) {
    throw new Error("pdfContentTypeInvalid");
  }
  return response.blob();
};

export const downloadPdfBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

export const printPdfBlob = async (blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const revokeLater = () => {
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  let printWindow: Window | null = null;
  try {
    // Some macOS browsers may open a tab but still return null with strict window features.
    printWindow = window.open(url, "_blank");
  } catch {
    printWindow = null;
  }

  if (!printWindow) {
    // Fallback: open via link and let operator print manually if auto-print cannot be controlled.
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.click();
    revokeLater();
    return;
  }

  let printed = false;
  const finalize = () => {
    if (printed) {
      return;
    }
    printed = true;
    try {
      printWindow.focus();
      printWindow.print();
    } catch {
      // If browser disallows scripted print, keep opened tab as successful fallback.
    } finally {
      revokeLater();
    }
  };

  const tryFinalizeWhenReady = () => {
    if (printed) {
      return;
    }
    try {
      if (printWindow.document?.readyState !== "complete") {
        return;
      }
    } catch {
      // Access checks may fail in some browser states; keep opened tab as fallback.
      return;
    }
    finalize();
  };

  try {
    printWindow.addEventListener("load", finalize, { once: true });
  } catch {
    // Ignore listener attachment failures; timeout fallback below still attempts print.
  }
  // Avoid very early print calls: some browsers apply default paper before PDF page size is ready.
  window.setTimeout(tryFinalizeWhenReady, 2200);
  window.setTimeout(tryFinalizeWhenReady, 4200);
};
