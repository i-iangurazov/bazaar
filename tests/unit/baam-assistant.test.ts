import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  metrics: vi.fn(),
  products: vi.fn(),
  access: vi.fn(),
  providerGuard: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@/server/services/baamProducts", () => ({ executeBaamProductPlan: mocks.products }));
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
import { baamProductFollowUps } from "@/server/services/baamFollowUps";

const input = {
  actorId: "server-actor",
  question: "What changed?",
  dateFrom: "2026-09-01",
  dateTo: "2026-09-02",
  locale: "en" as const,
};
const scope = {
  role: "ADMIN" as const,
  isOrgOwner: true,
  planFeatures: ["analytics"],
  authorizationFingerprint: "current-grants",
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
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify({ plan: value }) }],
        },
      ],
    }),
  );

describe("BAAM question interpretation and authoritative answers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "synthetic-model-key");
    vi.stubEnv("NEXTAUTH_SECRET", "synthetic-context-secret");
    vi.stubEnv("OPENAI_MODEL", "gpt-5-mini");
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.metrics.mockImplementation(async (args) =>
      report(args.dateFrom, args.dateTo, args.dateFrom !== input.dateFrom),
    );
    mocks.access.mockResolvedValue(scope);
    mocks.fetch.mockImplementation(async () => response(plan()));
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
    expect(JSON.parse(body.input[1].content[0].text)).toEqual({
      question: input.question.toLowerCase(),
    });
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
        "I cannot establish causes, forecast, calculate historical profit, or perform business actions",
      );
      expect(answer).not.toContain("Sales before returns: 300 KGS");
    },
  );

  it("reports configuration explicitly and never fabricates an AI reply without a key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(await getBaamCapabilities(input.actorId)).toMatchObject({
      available: true,
      aiConfigured: false,
      reason: "local_only",
    });
    expect((await askBaam(input)).mode).toBe("guided");
    await expect(askBaam({ ...input, question: "Discuss an unspecified issue" })).rejects.toThrow(
      "baamNotConfigured",
    );
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

  it("refuses grants/tenant changes between reporting snapshots without returning facts", async () => {
    mocks.metrics
      .mockResolvedValueOnce(report(input.dateFrom, input.dateTo))
      .mockResolvedValueOnce({
        ...report("2026-08-30", "2026-08-31", true),
        scope: { ...scope, storeIds: ["new-store"] },
      });
    await expect(askBaam(input)).rejects.toThrow("baamScopeChanged");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["forbidden", "unauthorized", "subscriptionInactive", "storeAccessDenied"])(
    "does not reveal an answer after %s during the provider request",
    async (reason) => {
      mocks.access
        .mockResolvedValueOnce(scope)
        .mockResolvedValueOnce(scope)
        .mockRejectedValueOnce(new Error(reason));
      await expect(askBaam(input)).rejects.toThrow(reason);
      expect(mocks.access).toHaveBeenCalledWith(input.actorId, undefined);
      expect(mocks.access.mock.invocationCallOrder[2]).toBeGreaterThan(
        mocks.fetch.mock.invocationCallOrder[0],
      );
    },
  );

  it("rejects a new tenant or changed all-store scope after the model completes", async () => {
    mocks.access
      .mockResolvedValueOnce(scope)
      .mockResolvedValueOnce(scope)
      .mockResolvedValueOnce({ ...scope, organizationId: "new-tenant" });
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

  it.each(["Sales in Store Unknown", "Sales during July", "Sales on 04/09/2026", "Compare stores"])(
    "clarifies unresolved scope without figures or provider: %s",
    async (question) => {
      const result = await askBaam({ ...input, question });
      expect(result.status).toBe("clarification");
      expect(result.mode).toBe("guided");
      expect(result.evidence).toBeNull();
      expect(result.contextToken).toBeNull();
      expect(result.analyticsHref).toBeNull();
      expect(mocks.metrics).not.toHaveBeenCalled();
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );

  it("resolves a date and authorized store before fresh reporting, and keeps both private from the provider", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T12:00:00Z"));
    const result = await askBaam({
      ...input,
      question: "Sales for Private Store Name last two months",
    });
    expect(result.status).toBe("answer");
    expect(result.scope).toMatchObject({
      dateFrom: "2026-07-01",
      dateTo: "2026-08-31",
      storeId: "private-store",
      source: "question",
    });
    expect(result.analyticsHref).toBe(
      "/reports/analytics?dateFrom=2026-07-01&dateTo=2026-08-31&storeId=private-store",
    );
    expect(mocks.metrics.mock.calls[0][0]).toMatchObject({
      dateFrom: "2026-07-01",
      dateTo: "2026-08-31",
      storeId: "private-store",
    });
    const payload = mocks.fetch.mock.calls[0][1].body;
    for (const value of ["Private Store Name", "private-store", "last two months", "2026-07-01"])
      expect(payload).not.toContain(value);
    expect(result.contextToken).toEqual(expect.any(String));
  });

  it("carries only authenticated typed intent into follow-ups and re-reads figures", async () => {
    const first = await askBaam(input);
    mocks.fetch.mockResolvedValue(response(plan({ intent: "returns", metrics: ["returns"] })));
    const second = await askBaam({
      ...input,
      question: "And returns?",
      contextToken: first.contextToken!,
    });
    expect(second.scope.source).toBe("context");
    expect(second.answer).toContain("Returns: 60 KGS");
    expect(mocks.metrics).toHaveBeenCalledTimes(4);
    const payload = JSON.parse(mocks.fetch.mock.calls[1][1].body);
    expect(JSON.parse(payload.input[1].content[0].text)).toEqual({
      question: "and returns?",
      previousPlan: plan(),
    });
    expect(mocks.fetch.mock.calls[1][1].body).not.toContain(first.contextToken);
    expect(mocks.fetch.mock.calls[1][1].body).not.toContain("300 KGS");
  });

  it("does not reuse previous intent after an explicit manual control change", async () => {
    const first = await askBaam(input);
    await askBaam({
      ...input,
      dateFrom: "2026-08-01",
      dateTo: "2026-08-02",
      question: "And returns?",
      contextToken: first.contextToken!,
    });
    expect(
      JSON.parse(JSON.parse(mocks.fetch.mock.calls[1][1].body).input[1].content[0].text)
        .previousPlan,
    ).toBeUndefined();
  });

  it("rejects a modified, cross-actor or grant-stale context before report/provider access", async () => {
    const first = await askBaam(input);
    mocks.metrics.mockClear();
    mocks.fetch.mockClear();
    expect((await askBaam({ ...input, contextToken: first.contextToken! + "x" })).status).toBe(
      "clarification",
    );
    expect(
      (await askBaam({ ...input, actorId: "other", contextToken: first.contextToken! })).status,
    ).toBe("clarification");
    mocks.access.mockResolvedValue({ ...scope, authorizationFingerprint: "new-grants" });
    expect((await askBaam({ ...input, contextToken: first.contextToken! })).status).toBe(
      "clarification",
    );
    expect(mocks.metrics).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    "What is happening in my business?",
    "What changed in this period?",
    "What should I check next?",
    "What changed compared with the previous period?",
    "How much do returns affect net sales?",
    "Do payments and refunds reconcile?",
    "Что происходит в моём бизнесе?",
    "Что изменилось за этот период?",
    "Что мне проверить в первую очередь?",
    "Что изменилось по сравнению с предыдущим периодом?",
    "Как возвраты влияют на продажи?",
    "Сходятся ли платежи и возвраты?",
    "Бизнесимде эмне болуп жатат?",
    "Бул мезгилде эмне өзгөрдү?",
    "Биринчи кезекте эмнени текшеришим керек?",
    "Мурунку мезгилге салыштырмалуу эмне өзгөрдү?",
    "Кайтаруулар сатууга кандай таасир этет?",
    "Төлөмдөр менен кайтаруулар дал келеби?",
    "Sales for selected stores",
    "Store sales for the selected period",
    "May I see sales?",
    "Are net sales greater than 2026.05 KGS?",
  ])(
    "does not misclassify a supported suggestion or a date-free forecast as explicit scope: %s",
    async (question) => {
      const result = await askBaam({ ...input, question });
      expect(result.status).toBe("answer");
      expect(result.evidence).not.toBeNull();
      expect(mocks.metrics).toHaveBeenCalledTimes(2);
    },
  );

  it("does not let the deterministic guard bypass authorization or missing configuration", async () => {
    mocks.access.mockRejectedValueOnce(new Error("forbidden"));
    await expect(askBaam({ ...input, question: "Sales yesterday" })).rejects.toThrow("forbidden");
    vi.stubEnv("OPENAI_API_KEY", "");
    expect((await askBaam({ ...input, question: "Sales yesterday" })).mode).toBe("guided");
  });
  it.each([
    "Open sales report for last two months",
    "Open analytics for last 2 months",
    "Open analytics from 2026-07-01 to 2026-08-31",
  ])("opens exactly filtered reports without model or sales reads: %s", async (question) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T12:00:00Z"));
    const result = await askBaam({ ...input, question });
    expect(result.status).toBe("answer");
    expect(result.analyticsHref).toBe("/reports/analytics?dateFrom=2026-07-01&dateTo=2026-08-31");
    expect(result.actions.some((action) => action.href === result.analyticsHref)).toBe(true);
    expect(result.answer).toContain("2026-07-01");
    expect(result.evidence).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.metrics).not.toHaveBeenCalled();
  });

  it.each([
    "What can you help me with?",
    "Чем ты можешь помочь?",
    "Сен эмне менен жардам бере аласың?",
  ])("explains shipped tools without a provider: %s", async (question) => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const result = await askBaam({ ...input, question });
    expect(result.status).toBe("answer");
    expect(result.mode).toBe("guided");
    expect(result.actions.length).toBeGreaterThan(0);
    expect(result.evidence).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.metrics).not.toHaveBeenCalled();
  });

  it.each(["Why did sales fall?", "Почему упали продажи?", "Сатуу эмне үчүн азайды?"])(
    "provides bounded non-causal diagnostics for %s",
    async (question) => {
      const result = await askBaam({ ...input, question });
      expect(result.status).toBe("answer");
      expect(result.mode).toBe("guided");
      expect(result.answer).toContain("not proof of what caused");
      expect(result.answer).toContain("Completed receipts");
      expect(result.answer).toContain("Average receipt");
      expect(result.answer).toContain("Returns");
      expect(result.answer).toContain("Net sales");
      expect(result.followUps[0]).toBe("Do payments and refunds reconcile?");
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    "Forecast sales",
    "What is our profit?",
    "Delete products",
    "Why did product Apple fall?",
  ])("does not turn unsupported %s into arbitrary figures", async (question) => {
    const result = await askBaam({ ...input, question });
    expect(result.status).toBe("unsupported");
    expect(result.evidence).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.metrics).not.toHaveBeenCalled();
  });

  it("retains prior metric references for a no-key comparison follow-up", async () => {
    mocks.fetch.mockResolvedValue(response(plan({ intent: "summary", metrics: ["discounts"] })));
    const first = await askBaam(input);
    vi.stubEnv("OPENAI_API_KEY", "");
    const second = await askBaam({
      ...input,
      question: "Compare that with the previous period",
      contextToken: first.contextToken!,
    });
    expect(second.answer).toContain("Recorded discounts:");
    expect(second.answer).not.toContain("Sales before returns:");
    expect(second.mode).toBe("guided");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("uses a literal quoted catalog query and keeps product evidence separate from sales", async () => {
    mocks.products.mockResolvedValue({
      status: "answer",
      answer: "Current catalog result",
      cards: [
        {
          id: "product-a",
          title: "May ABC123",
          href: "/products/product-a",
          sku: "ABC123",
          displayFields: [],
        },
      ],
      evidence: { summary: "Current catalog", details: ["Date not applied"], appliedPeriod: false },
      contextProductId: "product-a",
    });
    const result = await askBaam({ ...input, question: 'Find product "May ABC123"' });
    expect(result.status).toBe("answer");
    expect(result.products[0].id).toBe("product-a");
    expect(mocks.products.mock.calls[0][0].plan.query).toBe("May ABC123");
    expect(result.evidence).toBeNull();
    expect(result.productEvidence?.appliedPeriod).toBe(false);
    expect(mocks.metrics).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    const payload = JSON.parse(
      Buffer.from(result.contextToken!.split(".")[0], "base64url").toString(),
    );
    expect(payload.plan.query).toBeNull();
    expect(payload.productId).toBe("product-a");
    expect(JSON.stringify(payload)).not.toContain("ABC123");
  });

  it("uses the current product page before a previous product context and never sends IDs to the model", async () => {
    mocks.products.mockResolvedValue({
      status: "answer",
      answer: "Catalog details",
      cards: [],
      evidence: { summary: "Current catalog", details: [], appliedPeriod: false },
      contextProductId: "product-a",
    });
    const first = await askBaam({
      ...input,
      question: "Tell me about this product",
      pageContext: { kind: "product", id: "product-a" },
    });
    await askBaam({
      ...input,
      question: "Tell me about this product",
      pageContext: { kind: "product", id: "product-b" },
      contextToken: first.contextToken!,
    });
    expect(mocks.products.mock.calls[1][0].pageProductId).toBe("product-b");
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.metrics).not.toHaveBeenCalled();
  });

  it("does not silently repeat a one-period product ranking when asked to compare it", async () => {
    mocks.products.mockResolvedValue({
      status: "answer",
      answer: "Ranking",
      cards: [],
      evidence: { summary: "Product ranking", details: [], appliedPeriod: true },
    });
    const first = await askBaam({ ...input, question: "Show top products" });
    const second = await askBaam({
      ...input,
      question: "Compare that with the previous period",
      contextToken: first.contextToken!,
    });
    expect(second.status).toBe("clarification");
    expect(second.answer).toContain("cannot yet compare product rankings");
    expect(mocks.products).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("validates a product model branch but rejects a fabricated search term", async () => {
    mocks.fetch.mockResolvedValue(
      response({
        intent: "products",
        productAction: "search",
        query: "INVENTED",
        direction: null,
        metric: null,
        limit: 5,
      }),
    );
    const result = await askBaam({ ...input, question: "Explore the catalog for apple" });
    expect(result.status).toBe("clarification");
    expect(mocks.products).not.toHaveBeenCalled();
    expect(mocks.metrics).not.toHaveBeenCalled();
  });
  it.each([
    "Open the sales report for this period",
    "Открой отчёт о продажах за этот период",
    "Бул мезгил үчүн сатуу отчётун ач",
  ])("opens the actual localized report suggestion with matching filters: %s", async (question) => {
    const result = await askBaam({ ...input, question });
    expect(result.analyticsHref).toBe("/reports/analytics?dateFrom=2026-09-01&dateTo=2026-09-02");
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.metrics).not.toHaveBeenCalled();
  });

  it.each(["А возвраты?", "Ал эми кайтаруулар?", "And returns?"])(
    "preserves typed prior context for multilingual follow-up %s",
    async (question) => {
      const first = await askBaam(input);
      mocks.fetch.mockResolvedValue(response(plan({ intent: "returns" })));
      const second = await askBaam({ ...input, question, contextToken: first.contextToken! });
      expect(second.scope.source).toBe("context");
      expect(
        JSON.parse(JSON.parse(mocks.fetch.mock.calls[1][1].body).input[1].content[0].text)
          .previousPlan,
      ).toEqual(plan());
    },
  );

  it("does not echo client text, context tokens or page IDs into scope metadata", async () => {
    const result = await askBaam({
      ...input,
      contextToken: "invalid-context",
      pageContext: { kind: "product", id: "product-a" },
    });
    expect(result.status).toBe("clarification");
    expect(Object.keys(result.scope).sort()).toEqual(
      [
        "dateFrom",
        "dateTo",
        "storeId",
        "source",
        "reason",
        "timeZone",
        "storeNames",
        "comparison",
      ].sort(),
    );
    expect(JSON.stringify(result.scope)).not.toContain("invalid-context");
    expect(JSON.stringify(result.scope)).not.toContain("product-a");
  });

  it("rejects arbitrary page URLs and extra context fields before model access", () => {
    for (const pageContext of [
      { kind: "section", section: "https://attacker.test" },
      { kind: "product", id: "../../other-tenant" },
      { kind: "product", id: "product-a", totals: 123 },
    ]) {
      const request = {
        question: input.question,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        locale: input.locale,
      };
      expect(baamAskSchema.safeParse({ ...request, pageContext }).success).toBe(false);
    }
  });
  it.each(["Explain its change", "Объясни его результат", "Анын жыйынтыгын түшүндүр"])(
    "blocks an adversarial whole-store model plan for dependent product question: %s",
    async (question) => {
      mocks.products.mockResolvedValue({
        status: "answer",
        answer: "Product",
        cards: [],
        evidence: { summary: "Catalog", details: [], appliedPeriod: false },
        contextProductId: "product-a",
      });
      const first = await askBaam({
        ...input,
        question: "Tell me about this product",
        pageContext: { kind: "product", id: "product-a" },
      });
      mocks.fetch.mockResolvedValue(response(plan({ intent: "summary" })));
      const second = await askBaam({ ...input, question, contextToken: first.contextToken! });
      expect(second.status).toBe("clarification");
      expect(second.answer).not.toContain("300 KGS");
      expect(mocks.metrics).not.toHaveBeenCalled();
    },
  );

  it("allows an explicit switch from product context to overall sales", async () => {
    mocks.products.mockResolvedValue({
      status: "answer",
      answer: "Product",
      cards: [],
      evidence: { summary: "Catalog", details: [], appliedPeriod: false },
      contextProductId: "product-a",
    });
    const first = await askBaam({
      ...input,
      question: "Tell me about this product",
      pageContext: { kind: "product", id: "product-a" },
    });
    const second = await askBaam({
      ...input,
      question: "Compare overall sales with the previous period",
      contextToken: first.contextToken!,
    });
    expect(second.status).toBe("answer");
    expect(second.answer).toContain("Sales before returns:");
    expect(
      JSON.parse(JSON.parse(mocks.fetch.mock.calls[0][1].body).input[1].content[0].text)
        .previousPlan,
    ).toBeUndefined();
  });

  it.each(["What are its returns?", "А сколько его продали?", "Анын кайтаруулары канча?"])(
    "routes a known product follow-up to product performance, never whole-store totals: %s",
    async (question) => {
      mocks.products.mockResolvedValue({
        status: "answer",
        answer: "Product",
        cards: [],
        evidence: { summary: "Catalog", details: [], appliedPeriod: false },
        contextProductId: "product-a",
      });
      const first = await askBaam({
        ...input,
        question: "Tell me about this product",
        pageContext: { kind: "product", id: "product-a" },
      });
      mocks.products.mockResolvedValue({
        status: "answer",
        answer: "Product performance",
        cards: [],
        evidence: {
          summary: "Recorded product sales and returns",
          details: [],
          appliedPeriod: true,
        },
        contextProductId: "product-a",
      });
      const second = await askBaam({ ...input, question, contextToken: first.contextToken! });
      expect(second.status).toBe("answer");
      expect(second.productEvidence?.appliedPeriod).toBe(true);
      expect(mocks.products.mock.calls[1][0]).toMatchObject({
        pageProductId: "product-a",
        plan: { productAction: "performance" },
      });
      expect(mocks.metrics).not.toHaveBeenCalled();
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );
  it.each(["en", "ru", "kg"] as const)(
    "answers both suggested single-product performance follow-ups in %s without whole-store reads",
    async (locale) => {
      mocks.products.mockResolvedValue({
        status: "answer",
        answer: "Product result",
        cards: [],
        evidence: { summary: "Scoped product", details: [], appliedPeriod: true },
        contextProductId: "product-a",
      });
      const first = await askBaam({
        ...input,
        locale,
        question: "Tell me about this product",
        pageContext: { kind: "product", id: "product-a" },
      });
      expect(first.followUps).toEqual(baamProductFollowUps(locale, true));
      for (const question of first.followUps.slice(0, 2)) {
        const answer = await askBaam({
          ...input,
          locale,
          question,
          contextToken: first.contextToken!,
        });
        expect(answer.status).toBe("answer");
        expect(mocks.products.mock.lastCall?.[0]).toMatchObject({
          pageProductId: "product-a",
          plan: { productAction: "performance" },
        });
      }
      expect(mocks.metrics).not.toHaveBeenCalled();
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );
  it.each([
    "Open the sales report for this period",
    "Open receiving documents",
    "What can you help me with?",
  ])("preserves valid analytical context through local guidance: %s", async (question) => {
    mocks.fetch.mockResolvedValue(response(plan({ intent: "summary", metrics: ["discounts"] })));
    const first = await askBaam(input);
    const navigation = await askBaam({ ...input, question, contextToken: first.contextToken! });
    expect(navigation.contextToken).toBe(first.contextToken);
    const followUp = await askBaam({
      ...input,
      question: "Compare that with the previous period",
      contextToken: navigation.contextToken!,
    });
    expect(followUp.answer).toContain("Recorded discounts:");
    expect(followUp.answer).not.toContain("Sales before returns:");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});
