import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { appRouter } from "@/server/trpc/routers/_app";
import { createContext } from "@/server/trpc/trpc";
import { ensureRequestId, runWithRequestContext } from "@/server/middleware/requestContext";
import {
  httpRequestDurationMs,
  httpRequestsTotal,
  incrementCounter,
  observeHistogram,
} from "@/server/metrics/metrics";

export const runtime = "nodejs";

const handler = async (request: Request) => {
  const startedAt = Date.now();
  incrementCounter(httpRequestsTotal, { path: "/api/trpc" });
  try {
    const requestId = ensureRequestId(request.headers.get("x-request-id"));
    return runWithRequestContext(requestId, () =>
      fetchRequestHandler({
        endpoint: "/api/trpc",
        req: request,
        router: appRouter,
        createContext,
        responseMeta() {
          return {
            headers: {
              "x-request-id": requestId,
            },
          };
        },
      }),
    );
  } finally {
    observeHistogram(
      httpRequestDurationMs,
      { method: request.method.toUpperCase(), path: "/api/trpc" },
      Date.now() - startedAt,
    );
  }
};

export { handler as GET, handler as POST };
