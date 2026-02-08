import { getServerAuthToken } from "@/server/auth/token";
import { incrementCounter, httpRequestsTotal, renderMetrics } from "@/server/metrics/metrics";

export const runtime = "nodejs";

export const GET = async (request: Request) => {
  incrementCounter(httpRequestsTotal, { path: "/api/metrics" });

  const configuredSecret = process.env.METRICS_SECRET;
  const providedSecret = request.headers.get("x-metrics-secret");
  if (configuredSecret) {
    if (providedSecret !== configuredSecret) {
      return new Response("unauthorized", { status: 401 });
    }
  } else {
    const token = await getServerAuthToken();
    if (!token?.sub || token.role !== "ADMIN") {
      return new Response("unauthorized", { status: 401 });
    }
  }

  return new Response(renderMetrics(), {
    headers: {
      "Content-Type": "text/plain; version=0.0.4",
    },
  });
};
