// These reads must not wait for unrelated dashboard/catalog work in a tRPC batch.
export const isInteractivePosRead = (type: string, path: string) =>
  type === "query" &&
  (path.startsWith("pos.") || path === "products.lookupScan" || path === "products.searchQuick");

export async function fetchPosRead(url: RequestInfo | URL, options?: RequestInit) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options?.signal?.aborted) abort();
  else options?.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 12_000);
  try {
    return await fetch(url, { ...options, credentials: "include", signal: controller.signal });
  } finally {
    clearTimeout(timer);
    options?.signal?.removeEventListener("abort", abort);
  }
}
