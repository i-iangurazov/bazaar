import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  metrics: vi.fn(),
  access: vi.fn(),
  providerGuard: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@/server/db/prisma", () => ({ prisma: {} }));
vi.mock("@/server/services/baamMetrics", () => ({
  getBaamSalesMetrics: mocks.metrics,
  getBaamAccessScope: mocks.access,
}));
vi.mock("@/server/config/runtime", () => ({
  assertExternalProviderCallAllowed: mocks.providerGuard,
}));
import {
  askBaam,
  baamAskSchema,
  getBaamCapabilities,
  previousBaamPeriod,
} from "@/server/services/baamAssistant";

const input = {
  actorId: "server-actor",
  question: "What changed?",
  dateFrom: "2026-09-01",
  dateTo: "2026-09-02",
  locale: "en" as const,
};
const scope = {
  actorId: input.actorId,
  organizationId: "private-org",
  storeIds: ["private-store"],
  availableStores: [{ id: "private-store", name: "Private Store Name" }],
};
const report = (dateFrom: string, dateTo: string, previous = false) => ({
  version: "completed-sales-kgs-v1",
  queryHash: previous ? "previous-hash" : "current-hash",
  audience: { actorId: input.actorId },
  scope,
  period: { dateFrom, dateTo, timeZone: "Asia/Bishkek" },
  totals: {
    salesBeforeReturnsKgs: previous ? 200 : 300,
    netSalesKgs: previous ? 180 : 240,
    receiptCount: previous ? 2 : 3,
    averageReceiptKgs: 100,
    returnsKgs: previous ? 20 : 60,
    recordedDiscountKgs: 25,
  },
  quality: { salesDifferenceKgs: -15, refundsDifferenceKgs: 10 },
  freshness: { queriedAt: previous ? "2026-09-05T12:00:02.000Z" : "2026-09-05T12:00:01.000Z" },
  days: [{ customerSecret: "This must never reach the model" }],
});
const plan = (overrides = {}) => ({
  intent: "comparison",
  metrics: ["sales", "net_sales"],
  limitation: "none",
  ...overrides,
});
const response = (value: unknown) =>
  new Response(
    JSON.stringify({
      status: "completed",
      output: [
        { type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] },
      ],
    }),
  );

describe("BAAM question interpretation and authoritative answers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "synthetic-model-key");
    vi.stubEnv("OPENAI_MODEL", "gpt-5-mini");
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.metrics.mockImplementation(async (args) =>
      report(args.dateFrom, args.dateTo, args.dateFrom !== input.dateFrom),
    );
    mocks.access.mockResolvedValue(scope);
    mocks.fetch.mockResolvedValue(response(plan()));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("compares fresh server metrics over the immediately preceding equal-length period", async () => {
    const result = await askBaam(input);
    expect(mocks.metrics.mock.calls.map((call) => call[0])).toEqual([
      {
        actorId: input.actorId,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        storeId: undefined,
      },
      { actorId: input.actorId, dateFrom: "2026-08-30", dateTo: "2026-08-31", storeId: undefined },
    ]);
    expect(result.answer).toContain(
      "Sales before returns: 300 KGS. Previous equal-length period: 200 KGS; change: +100 KGS. (50%)",
    );
    expect(result.answer).toContain(
      "Net sales: 240 KGS. Previous equal-length period: 180 KGS; change: +60 KGS. (33.33%)",
    );
    expect(result.answer).toContain("source completeness is unknown");
    expect(result.evidence).toMatchObject({
      metricVersion: "completed-sales-kgs-v1",
      queryHashes: ["current-hash", "previous-hash"],
      storeNames: ["Private Store Name"],
    });
    expect(result.audience).toEqual({ actorId: input.actorId, organizationId: "private-org" });
    expect(result.mode).toBe("ai");
  });

  it("sends only the bounded question and static schema, never metrics, identity or stored business text", async () => {
    await askBaam(input);
    const [url, options] = mocks.fetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(options).toMatchObject({
      method: "POST",
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({
      model: "gpt-5-mini",
      store: false,
      max_output_tokens: 500,
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(JSON.parse(body.input[1].content[0].text)).toEqual({ question: input.question });
    for (const value of [
      "server-actor",
      "private-org",
      "private-store",
      "Private Store Name",
      "customerSecret",
      "300",
      "2026-09-01",
    ])
      expect(options.body).not.toContain(value);
    expect(body.tools).toBeUndefined();
    expect(body.previous_response_id).toBeUndefined();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects client metric/history/identity injection and invalid date windows before provider access", async () => {
    expect(
      baamAskSchema.safeParse({ ...input, actorId: undefined, totals: { sales: 999 } }).success,
    ).toBe(false);
    const request = {
      question: input.question,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      locale: input.locale,
    };
    for (const extra of [
      { history: [] },
      { actorId: "victim" },
      { organizationId: "victim" },
      { question: "x".repeat(1501) },
    ]) {
      expect(baamAskSchema.safeParse({ ...request, ...extra }).success).toBe(false);
    }
    await expect(askBaam({ ...input, dateFrom: "2026-02-30" })).rejects.toThrow("invalidInput");
    expect(mocks.metrics).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("calculates prior periods across leap days without reusing current dates", () => {
    expect(previousBaamPeriod("2024-03-01", "2024-03-02")).toEqual({
      dateFrom: "2024-02-28",
      dateTo: "2024-02-29",
    });
    expect(previousBaamPeriod("2026-01-01", "2026-01-01")).toEqual({
      dateFrom: "2025-12-31",
      dateTo: "2025-12-31",
    });
  });

  it("reports ratios as period ratios, with percentage-point deltas rather than cohort return rates", async () => {
    mocks.fetch.mockResolvedValue(response(plan({ metrics: ["return_ratio"] })));
    const { answer } = await askBaam(input);
    expect(answer).toContain(
      "Returns / sales: 20%. Previous equal-length period: 10%; change: +10 percentage points.",
    );
    expect(answer).toContain("not a return rate for the same sales cohort");
  });

  it("does not invent percentages or average receipts for zero/missing baselines", async () => {
    mocks.metrics.mockImplementation(async (args) => {
      const result = report(args.dateFrom, args.dateTo);
      if (args.dateFrom !== input.dateFrom) result.totals.salesBeforeReturnsKgs = 0;
      return { ...result, totals: { ...result.totals, averageReceiptKgs: null } };
    });
    mocks.fetch.mockResolvedValue(response(plan({ metrics: ["sales", "average_receipt"] })));
    const { answer } = await askBaam(input);
    expect(answer).toContain("percentage change unavailable when the previous value is zero");
    expect(answer).toContain("Average receipt: not available");
    expect(answer).not.toMatch(/NaN|Infinity/);
  });

  it.each(["en", "ru", "kg"] as const)(
    "renders return pressure in %s from server facts",
    async (locale) => {
      mocks.fetch.mockResolvedValue(response(plan({ intent: "returns" })));
      const { answer, followUps } = await askBaam({ ...input, locale });
      expect(answer).toContain("60 KGS");
      expect(answer).toContain("20%");
      expect(answer).toContain("240 KGS");
      expect(followUps).toHaveLength(3);
    },
  );

  it("describes actual payment and refund discrepancies without asserting a cause", async () => {
    mocks.fetch.mockResolvedValue(response(plan({ intent: "payments" })));
    const { answer } = await askBaam(input);
    expect(answer).toContain("payment total minus sales -15 KGS");
    expect(answer).toContain("refund total minus returns 10 KGS");
  });

  it.each(["causes", "forecast", "profit", "other_data", "actions"])(
    "honestly limits unsupported %s requests and offers only recorded facts",
    async (limitation) => {
      mocks.fetch.mockResolvedValue(response(plan({ intent: "unsupported", limitation })));
      const { answer } = await askBaam(input);
      expect(answer).toContain(
        "These records cannot establish causes, forecasts, profit, other business data or perform actions",
      );
      expect(answer).not.toContain("Sales before returns: 300 KGS");
    },
  );

  it("reports configuration explicitly and never fabricates an AI reply without a key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(await getBaamCapabilities(input.actorId)).toMatchObject({
      available: false,
      reason: "not_configured",
    });
    await expect(askBaam(input)).rejects.toThrow("baamNotConfigured");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("capabilities rechecks current authorization and exposes no provider credential", async () => {
    expect(await getBaamCapabilities(input.actorId)).toMatchObject({
      available: true,
      reason: "configured",
      audience: { organizationId: "private-org" },
    });
    expect(JSON.stringify(await getBaamCapabilities(input.actorId))).not.toContain(
      "synthetic-model-key",
    );
    mocks.access.mockRejectedValueOnce(new Error("forbidden"));
    await expect(getBaamCapabilities(input.actorId)).rejects.toThrow("forbidden");
  });

  it("refuses grants/tenant changes between snapshots before sending the question", async () => {
    mocks.metrics
      .mockResolvedValueOnce(report(input.dateFrom, input.dateTo))
      .mockResolvedValueOnce({
        ...report("2026-08-30", "2026-08-31", true),
        scope: { ...scope, storeIds: ["new-store"] },
      });
    await expect(askBaam(input)).rejects.toThrow("baamScopeChanged");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each(["forbidden", "unauthorized", "subscriptionInactive", "storeAccessDenied"])(
    "does not reveal an answer after %s during the provider request",
    async (reason) => {
      mocks.access.mockRejectedValue(new Error(reason));
      await expect(askBaam(input)).rejects.toThrow(reason);
      expect(mocks.access).toHaveBeenCalledWith(input.actorId, undefined);
      expect(mocks.access.mock.invocationCallOrder[0]).toBeGreaterThan(
        mocks.fetch.mock.invocationCallOrder[0],
      );
    },
  );

  it("rejects a new tenant or changed all-store scope after the model completes", async () => {
    mocks.access.mockResolvedValue({ ...scope, organizationId: "new-tenant" });
    await expect(askBaam(input)).rejects.toThrow("baamScopeChanged");
  });

  it.each([
    { ...plan(), answer: "Invented sales 999999" },
    plan({ metrics: ["profit"] }),
    plan({ intent: "run_sql" }),
    plan({ intent: "unsupported", limitation: "none" }),
    plan({ intent: "summary", limitation: "causes" }),
  ])("rejects an invalid or injected response plan without retry: %j", async (invalid) => {
    mocks.fetch.mockResolvedValue(response(invalid));
    await expect(askBaam(input)).rejects.toThrow("baamUnavailable");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    () => new Response("sensitive provider error", { status: 429 }),
    () => new Response("sensitive provider error", { status: 503 }),
    () => new Response("malformed"),
    () => new Response(JSON.stringify({ status: "incomplete", output: [] })),
    () =>
      new Response(
        JSON.stringify({
          status: "completed",
          output: [{ type: "message", content: [{ type: "refusal", refusal: "refused" }] }],
        }),
      ),
  ])(
    "fails safely on provider errors, refusal or truncation, with no automatic cost retry",
    async (makeResponse) => {
      mocks.fetch.mockResolvedValue(makeResponse());
      const error = await askBaam(input).catch((error) => error);
      expect(error.message).toBe("baamUnavailable");
      expect(JSON.stringify(error)).not.toContain("sensitive");
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["headers", "body"])(
    "bounds a hung provider %s request at 20 seconds and aborts without retry",
    async (phase) => {
      vi.useFakeTimers();
      if (phase === "headers") mocks.fetch.mockImplementation(() => new Promise(() => {}));
      else mocks.fetch.mockResolvedValue({ ok: true, text: () => new Promise(() => {}) });
      const outcome = askBaam(input).catch((error) => error);
      await vi.advanceTimersByTimeAsync(20000);
      expect((await outcome).message).toBe("baamUnavailable");
      expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(true);
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("obeys the existing provider guard without making a network call", async () => {
    mocks.providerGuard.mockImplementation(() => {
      throw new Error("disabled");
    });
    await expect(askBaam(input)).rejects.toThrow("baamUnavailable");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each(["gpt-4o", "gpt-5.4", "other-configured-model"])(
    "does not force GPT-5 minimal reasoning onto %s",
    async (model) => {
      vi.stubEnv("OPENAI_MODEL", model);
      await askBaam(input);
      expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).reasoning).toBeUndefined();
    },
  );

  it.each([
    "What were sales yesterday?",
    "Sales for Store B",
    "Продажи за вчера?",
    "Кечээги сатуулар?",
  ])("returns scope clarification instead of different-period facts for %s", async (question) => {
    mocks.fetch.mockResolvedValue(response(plan({ intent: "unsupported", limitation: "scope" })));
    const { answer, evidence } = await askBaam({ ...input, question });
    expect(answer).toContain("Selected period: 2026-09-01 — 2026-09-02 (Asia/Bishkek), KGS.");
    expect(answer).toContain("Use the date and store controls");
    expect(answer).not.toContain("300 KGS");
    expect(evidence.currentQueriedAt).toBe("2026-09-05T12:00:01.000Z");
    expect(evidence.previousQueriedAt).toBe("2026-09-05T12:00:02.000Z");
    const prompt = JSON.parse(mocks.fetch.mock.calls[0][1].body).input[0].content[0].text;
    expect(prompt).toContain("never silently answer a different period or store");
  });
});
