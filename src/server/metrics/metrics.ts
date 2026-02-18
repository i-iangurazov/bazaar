type Labels = Record<string, string>;

type Counter = {
  name: string;
  help: string;
};

type Gauge = {
  name: string;
  help: string;
};

type Histogram = {
  name: string;
  help: string;
  buckets: number[];
};

type HistogramSample = {
  name: string;
  labels?: Labels;
  buckets: number[];
  bucketCounts: number[];
  sum: number;
  count: number;
};

const counterDefs = new Map<string, Counter>();
const gaugeDefs = new Map<string, Gauge>();
const histogramDefs = new Map<string, Histogram>();
const counters = new Map<string, number>();
const gauges = new Map<string, number>();
const histograms = new Map<string, HistogramSample>();

const formatLabels = (labels?: Labels) => {
  if (!labels || Object.keys(labels).length === 0) {
    return "";
  }
  const parts = Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}="${value}"`);
  return `{${parts.join(",")}}`;
};

const metricKey = (name: string, labels?: Labels) => `${name}${formatLabels(labels)}`;

const normalizeBuckets = (buckets: number[]) =>
  Array.from(new Set(buckets.filter((value) => Number.isFinite(value) && value > 0))).sort((a, b) => a - b);

export const defineCounter = (counter: Counter) => {
  counterDefs.set(counter.name, counter);
  return counter;
};

export const defineGauge = (gauge: Gauge) => {
  gaugeDefs.set(gauge.name, gauge);
  return gauge;
};

export const defineHistogram = (histogram: Histogram) => {
  const buckets = normalizeBuckets(histogram.buckets);
  if (!buckets.length) {
    throw new Error(`Histogram "${histogram.name}" must define at least one positive finite bucket.`);
  }
  const normalized = { ...histogram, buckets };
  histogramDefs.set(normalized.name, normalized);
  return normalized;
};

export const incrementCounter = (counter: Counter, labels?: Labels, inc = 1) => {
  const key = metricKey(counter.name, labels);
  counters.set(key, (counters.get(key) ?? 0) + inc);
};

export const setGauge = (gauge: Gauge, labels: Labels | undefined, value: number) => {
  const key = metricKey(gauge.name, labels);
  gauges.set(key, value);
};

export const incrementGauge = (gauge: Gauge, labels?: Labels, inc = 1) => {
  const key = metricKey(gauge.name, labels);
  gauges.set(key, (gauges.get(key) ?? 0) + inc);
};

export const decrementGauge = (gauge: Gauge, labels?: Labels, dec = 1) => {
  incrementGauge(gauge, labels, -dec);
};

export const observeHistogram = (histogram: Histogram, labels: Labels | undefined, value: number) => {
  const observedValue = Number.isFinite(value) && value >= 0 ? value : 0;
  const key = metricKey(histogram.name, labels);
  let sample = histograms.get(key);
  if (!sample) {
    sample = {
      name: histogram.name,
      labels: labels ? { ...labels } : undefined,
      buckets: histogram.buckets,
      bucketCounts: new Array(histogram.buckets.length).fill(0),
      sum: 0,
      count: 0,
    };
    histograms.set(key, sample);
  }
  sample.count += 1;
  sample.sum += observedValue;
  for (let index = 0; index < sample.buckets.length; index += 1) {
    if (observedValue <= sample.buckets[index]) {
      sample.bucketCounts[index] += 1;
    }
  }
};

export const renderMetrics = () => {
  const lines: string[] = [];
  for (const counter of counterDefs.values()) {
    lines.push(`# HELP ${counter.name} ${counter.help}`);
    lines.push(`# TYPE ${counter.name} counter`);
  }
  for (const gauge of gaugeDefs.values()) {
    lines.push(`# HELP ${gauge.name} ${gauge.help}`);
    lines.push(`# TYPE ${gauge.name} gauge`);
  }
  for (const histogram of histogramDefs.values()) {
    lines.push(`# HELP ${histogram.name} ${histogram.help}`);
    lines.push(`# TYPE ${histogram.name} histogram`);
  }
  for (const [key, value] of counters.entries()) {
    lines.push(`${key} ${value}`);
  }
  for (const [key, value] of gauges.entries()) {
    lines.push(`${key} ${value}`);
  }
  for (const sample of histograms.values()) {
    for (let index = 0; index < sample.buckets.length; index += 1) {
      lines.push(
        `${sample.name}_bucket${formatLabels({
          ...(sample.labels ?? {}),
          le: String(sample.buckets[index]),
        })} ${sample.bucketCounts[index]}`,
      );
    }
    lines.push(
      `${sample.name}_bucket${formatLabels({
        ...(sample.labels ?? {}),
        le: "+Inf",
      })} ${sample.count}`,
    );
    lines.push(`${sample.name}_sum${formatLabels(sample.labels)} ${sample.sum}`);
    lines.push(`${sample.name}_count${formatLabels(sample.labels)} ${sample.count}`);
  }
  return `${lines.join("\n")}\n`;
};

export const httpRequestsTotal = defineCounter({
  name: "http_requests_total",
  help: "Total HTTP requests",
});

export const httpRequestDurationMs = defineHistogram({
  name: "http_request_duration_ms",
  help: "HTTP request duration in milliseconds",
  buckets: [25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000],
});

export const eventsPublishedTotal = defineCounter({
  name: "events_published_total",
  help: "Total realtime events published",
});

export const eventsPublishFailuresTotal = defineCounter({
  name: "events_publish_failures_total",
  help: "Total realtime event publish failures",
});

export const sseConnectionsActive = defineGauge({
  name: "sse_connections_active",
  help: "Active SSE connections",
});

export const jobsFailedTotal = defineCounter({
  name: "jobs_failed_total",
  help: "Total jobs moved to dead letter",
});

export const jobsRetriedTotal = defineCounter({
  name: "jobs_retried_total",
  help: "Total job retry attempts",
});

export const jobsInflight = defineGauge({
  name: "jobs_inflight",
  help: "Jobs currently running",
});

export const jobsCompletedTotal = defineCounter({
  name: "jobs_completed_total",
  help: "Total jobs completed by status",
});

export const jobsSkippedTotal = defineCounter({
  name: "jobs_skipped_total",
  help: "Total jobs skipped by reason",
});

export const jobDurationMs = defineHistogram({
  name: "job_duration_ms",
  help: "Job execution duration in milliseconds",
  buckets: [100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000, 300_000],
});

export const redisOperationsTotal = defineCounter({
  name: "redis_operations_total",
  help: "Total Redis operations by operation and status",
});

export const redisOperationDurationMs = defineHistogram({
  name: "redis_operation_duration_ms",
  help: "Redis operation duration in milliseconds",
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000],
});

export const kkmReceiptsQueuedTotal = defineCounter({
  name: "kkm_receipts_queued_total",
  help: "Total fiscal receipts queued",
});

export const kkmReceiptsSentTotal = defineCounter({
  name: "kkm_receipts_sent_total",
  help: "Total fiscal receipts sent successfully",
});

export const kkmReceiptsFailedTotal = defineCounter({
  name: "kkm_receipts_failed_total",
  help: "Total fiscal receipts failed",
});

export const connectorOnlineGauge = defineGauge({
  name: "connector_online_gauge",
  help: "Connector online state by store label (1 online, 0 unknown/offline)",
});

export const posShiftOpenedTotal = defineCounter({
  name: "pos_shift_opened_total",
  help: "Total opened POS shifts",
});

export const posShiftClosedTotal = defineCounter({
  name: "pos_shift_closed_total",
  help: "Total closed POS shifts",
});
