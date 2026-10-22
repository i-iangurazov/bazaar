import { vi } from "vitest";
import { baamReadOperations } from "@/server/services/baamReadPlan";
import type { BaamReadRequest } from "@/server/services/baamReadPlan";

export const readRequest = (values: Partial<BaamReadRequest>): BaamReadRequest => ({
  dataset: "sales_metrics",
  mode: "summary",
  query: null,
  store: null,
  dateFrom: null,
  dateTo: null,
  limit: 20,
  metric: null,
  movementType: null,
  stockThreshold: null,
  ...values,
});
const response = (name: string, value: unknown) =>
  Response.json({
    status: "completed",
    output: [{ type: "function_call", name, arguments: JSON.stringify(value) }],
  });
// Provider syntax is mocked; the reads, access checks, business calculations,
// conversation storage and fact binding run against the real disposable DB.
export const mockBaamReads = (requests: BaamReadRequest[], intent: Record<string, unknown> = {}) =>
  vi.fn(async (_url: unknown, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body)),
      name = payload.tools[0].name;
    if (name === "understand_request")
      return response(name, {
        kind: "analytics",
        action: null,
        confidence: "high",
        fields: [],
        query: null,
        dateFrom: null,
        dateTo: null,
        period: null,
        reply: null,
        recordKind: null,
        ...intent,
      });
    if (name === "read_business")
      return response(name, {
        requests: requests.map((r) => {
          const operation = Object.entries(baamReadOperations).find(
            ([, pair]) => pair[0] === r.dataset && pair[1] === r.mode,
          )?.[0];
          const { dataset, mode, ...fields } = r;
          return { operation, ...fields, limit: mode === "latest" ? 1 : r.limit };
        }),
        format: "auto",
        clarification: null,
      });
    if (name === "compose_answer" || name === "review_answer") {
      const data = JSON.parse(payload.input[0].content).context;
      const sources = data.sources as Array<{
        scopeLabel: { ref: string };
        facts: Array<{ label: string; ref: string }>;
        records: Array<{ name: { ref: string } }>;
      }>;
      return response(name, {
        answer: sources
          .map(
            (source) =>
              source.scopeLabel.ref +
              "\n\n" +
              source.facts.map((f) => f.label + ": " + f.ref).join("\n") +
              "\n" +
              source.records.map((r) => r.name.ref).join(", "),
          )
          .join("\n\n"),
        suggestions: [],
      });
    }
    throw new Error("Unexpected provider tool " + name);
  });
