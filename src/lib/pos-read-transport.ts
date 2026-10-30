// These reads must not wait for unrelated dashboard/catalog work in a tRPC batch.
export const isInteractivePosRead = (type: string, path: string) =>
  type === "query" &&
  (path.startsWith("pos.") ||
    path === "products.list" ||
    path === "products.lookupScan" ||
    path === "products.searchQuick");

async function fetchBoundedRead(
  url: RequestInfo | URL,
  options: RequestInit | undefined,
  timeoutMs: number,
) {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (options?.signal?.aborted) abort();
  else options?.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      credentials: "include",
      signal: controller.signal,
    });
    // A response is not complete when only its headers arrive. Keep the deadline
    // until the JSON body is downloaded, including a stalled connection mid-body.
    const body = await response.arrayBuffer();
    return new Response([204, 205, 304].includes(response.status) ? null : body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    if (timedOut) throw new Error("readRequestTimeout", { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
    options?.signal?.removeEventListener("abort", abort);
  }
}

export const fetchPosRead = (url: RequestInfo | URL, options?: RequestInit) =>
  fetchBoundedRead(url, options, 12_000);

export const fetchAppRead = (url: RequestInfo | URL, options?: RequestInit) =>
  fetchBoundedRead(url, options, 30_000);
