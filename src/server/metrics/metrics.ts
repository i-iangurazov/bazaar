type Labels = Record<string, string>;

type Counter = {
  name: string;
  help: string;
};

type Gauge = {
  name: string;
  help: string;
};

const counterDefs = new Map<string, Counter>();
const gaugeDefs = new Map<string, Gauge>();
const counters = new Map<string, number>();
const gauges = new Map<string, number>();

const formatLabels = (labels?: Labels) => {
  if (!labels || Object.keys(labels).length === 0) {
    return "";
  }
  const parts = Object.entries(labels).map(([key, value]) => `${key}="${value}"`);
  return `{${parts.join(",")}}`;
};

export const defineCounter = (counter: Counter) => {
  counterDefs.set(counter.name, counter);
  return counter;
};

export const defineGauge = (gauge: Gauge) => {
  gaugeDefs.set(gauge.name, gauge);
  return gauge;
};

export const incrementCounter = (counter: Counter, labels?: Labels, inc = 1) => {
  const key = `${counter.name}${formatLabels(labels)}`;
  counters.set(key, (counters.get(key) ?? 0) + inc);
};

export const setGauge = (gauge: Gauge, labels: Labels | undefined, value: number) => {
  const key = `${gauge.name}${formatLabels(labels)}`;
  gauges.set(key, value);
};

export const incrementGauge = (gauge: Gauge, labels?: Labels, inc = 1) => {
  const key = `${gauge.name}${formatLabels(labels)}`;
  gauges.set(key, (gauges.get(key) ?? 0) + inc);
};

export const decrementGauge = (gauge: Gauge, labels?: Labels, dec = 1) => {
  incrementGauge(gauge, labels, -dec);
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
  for (const [key, value] of counters.entries()) {
    lines.push(`${key} ${value}`);
  }
  for (const [key, value] of gauges.entries()) {
    lines.push(`${key} ${value}`);
  }
  return `${lines.join("\n")}\n`;
};

export const httpRequestsTotal = defineCounter({
  name: "http_requests_total",
  help: "Total HTTP requests",
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
