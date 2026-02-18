import { beforeEach, describe, expect, it, vi } from "vitest";

describe("metrics histograms", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("renders request latency histogram samples", async () => {
    const metrics = await import("@/server/metrics/metrics");
    metrics.observeHistogram(
      metrics.httpRequestDurationMs,
      { method: "GET", path: "/api/test" },
      42,
    );

    const output = metrics.renderMetrics();
    expect(output).toContain("# TYPE http_request_duration_ms histogram");
    expect(output).toContain('http_request_duration_ms_bucket{le="50",method="GET",path="/api/test"} 1');
    expect(output).toContain('http_request_duration_ms_bucket{le="+Inf",method="GET",path="/api/test"} 1');
    expect(output).toContain('http_request_duration_ms_count{method="GET",path="/api/test"} 1');
  });

  it("tracks redis operation counters and latency", async () => {
    const metrics = await import("@/server/metrics/metrics");
    metrics.incrementCounter(metrics.redisOperationsTotal, {
      operation: "lock_set",
      status: "ok",
    });
    metrics.observeHistogram(metrics.redisOperationDurationMs, { operation: "lock_set" }, 7);

    const output = metrics.renderMetrics();
    expect(output).toContain('redis_operations_total{operation="lock_set",status="ok"} 1');
    expect(output).toContain('redis_operation_duration_ms_count{operation="lock_set"} 1');
  });
});
