import { describe, expect, it } from "vitest";
import { resolveBaamQuestionScope } from "@/server/services/baamQuestionScope";
import { issueBaamContext, readBaamContext } from "@/server/services/baamConversation";

const selected = { dateFrom: "2026-09-01", dateTo: "2026-09-02" };
const now = new Date("2026-09-05T12:00:00Z");
const resolve = (question: string, clock = now, stores: Array<{ id: string; name: string }> = []) =>
  resolveBaamQuestionScope({ question, selected, now: clock, stores });
describe("BAAM server business-calendar scope grammar", () => {
  it.each([
    "Summarize sales for the last two months",
    "tell me something for last 2 months",
    "last2months",
    "last ２ months",
    "Подведи итоги продаж за последние два месяца",
    "за последние 2 месяца",
    "за предыдущие два месяца",
    "Акыркы эки айдагы сатууну жыйынтыкта",
    "Акыркы 2 айдагы сатуулар",
  ])("resolves complete calendar months for %s", (question) => {
    expect(resolve(question)).toMatchObject({
      status: "resolved",
      range: { dateFrom: "2026-07-01", dateTo: "2026-08-31" },
      reason: "complete_months",
    });
  });
  it.each([
    ["today", "2026-09-05", "2026-09-05"],
    ["yesterday", "2026-09-04", "2026-09-04"],
    ["сегодняшние продажи", "2026-09-05", "2026-09-05"],
    ["Кечээги сатуулар", "2026-09-04", "2026-09-04"],
    ["last seven days", "2026-08-29", "2026-09-04"],
    ["последние семь дней", "2026-08-29", "2026-09-04"],
    ["акыркы жети күн", "2026-08-29", "2026-09-04"],
    ["last twenty-one days", "2026-08-15", "2026-09-04"],
    ["акыркы он эки күн", "2026-08-24", "2026-09-04"],
    ["last two weeks", "2026-08-22", "2026-09-04"],
    ["last week", "2026-08-24", "2026-08-30"],
    ["прошлую неделю", "2026-08-24", "2026-08-30"],
    ["Өткөн аптадагы сатуулар", "2026-08-24", "2026-08-30"],
    ["this month", "2026-09-01", "2026-09-05"],
    ["в этом месяце", "2026-09-01", "2026-09-05"],
    ["бул айдагы сатуу", "2026-09-01", "2026-09-05"],
    ["last month", "2026-08-01", "2026-08-31"],
    ["from 2026-07-01 to 2026-08-31", "2026-07-01", "2026-08-31"],
    ["с 2026-07-01 по 2026-08-31", "2026-07-01", "2026-08-31"],
    ["July–August 2026", "2026-07-01", "2026-08-31"],
    ["июль—август 2026", "2026-07-01", "2026-08-31"],
    ["August 2026", "2026-08-01", "2026-08-31"],
    ["December 2025 to January 2026", "2025-12-01", "2026-01-31"],
  ])("uses explicit documented calendar semantics: %s", (question, dateFrom, dateTo) => {
    expect(resolve(question)).toMatchObject({ status: "resolved", range: { dateFrom, dateTo } });
  });
  it("uses Bishkek midnight instead of UTC midnight and handles leap days", () => {
    expect(resolve("today", new Date("2026-09-04T18:00:00Z"))).toMatchObject({
      range: { dateFrom: "2026-09-05", dateTo: "2026-09-05" },
    });
    expect(resolve("last month", new Date("2024-03-01T00:00:00Z"))).toMatchObject({
      range: { dateFrom: "2024-02-01", dateTo: "2024-02-29" },
    });
    expect(resolve("last two months", new Date("2026-01-10T00:00:00Z"))).toMatchObject({
      range: { dateFrom: "2025-11-01", dateTo: "2025-12-31" },
    });
  });
  it.each([
    "July",
    "август",
    "September 3",
    "04/09/2026",
    "04.09.2026",
    "2026-02-30",
    "2026-09-05 to 2026-09-01",
    "last 367 days",
    "last zero days",
    "last thirteen months",
    "last 0 months",
    "past two months",
    "rolling 60 days",
    "since 2026-07-01",
    "Monday",
    "yesterday and today",
    "July 2026 and August 2026",
    "2026-07-01 and 2026-08-31",
    "last few months",
    "акыркы бир нече ай",
    "за последние несколько месяцев",
  ])("clarifies ambiguous, invalid or unsupported dates: %s", (question) => {
    expect(resolve(question).status).toBe("clarification");
  });
  it.each([
    "What changed in this period?",
    "What changed compared with the previous period?",
    "May I see sales?",
    "Are net sales greater than 2026.05 KGS?",
    "Что изменилось по сравнению с предыдущим периодом?",
    "Мурунку мезгилге салыштырмалуу эмне өзгөрдү?",
    "Store sales for the selected period",
  ])("does not mistake normal questions for date syntax: %s", (question) =>
    expect(resolve(question)).toMatchObject({
      status: "resolved",
      range: selected,
      explicit: false,
    }),
  );
  it("resolves an authorized unique literal name locally and removes it from model input", () => {
    const value = resolve("Sales at North (Main) yesterday", now, [
      { id: "store-a", name: "North (Main)" },
    ]);
    expect(value).toMatchObject({
      status: "resolved",
      storeId: "store-a",
      range: { dateFrom: "2026-09-04", dateTo: "2026-09-04" },
    });
    if (value.status === "resolved") expect(value.question).not.toMatch(/north|main|yesterday/i);
  });
  it("prefers exact longer names but clarifies duplicate names and multiple stores", () => {
    expect(
      resolve("North Main sales", now, [
        { id: "a", name: "North" },
        { id: "b", name: "North Main" },
      ]),
    ).toMatchObject({ status: "resolved", storeId: "b" });
    expect(
      resolve("North sales", now, [
        { id: "a", name: "North" },
        { id: "b", name: "North" },
      ]).status,
    ).toBe("clarification");
    expect(
      resolve("North and South sales", now, [
        { id: "a", name: "North" },
        { id: "b", name: "South" },
      ]).status,
    ).toBe("clarification");
  });
  it.each([
    "Sales in Store Unknown",
    "Продажи в магазине Север",
    "Север дүкөнүндөгү сатуулар",
    "Compare stores",
    "Сравни магазины",
    "Дүкөндөрдү салыштыр",
  ])("does not fall back to all stores for unknown or ambiguous store requests: %s", (question) =>
    expect(resolve(question)).toMatchObject({ status: "clarification", clarification: "store" }),
  );
});

describe("Scope parsing preserves literal identifiers and rejects lifetime ambiguity", () => {
  it.each(["Find product ABC123", "Find product One"])(
    "does not rewrite a catalog identifier: %s",
    (question) => {
      const result = resolve(question);
      expect(result).toMatchObject({ status: "resolved", question: question.toLowerCase() });
    },
  );
  it.each([
    "products never sold",
    "all-time sales",
    "товары никогда не продавались",
    "эч качан сатылган эмес",
  ])("does not treat lifetime wording as a selected short period: %s", (question) =>
    expect(resolve(question).status).toBe("clarification"),
  );
});

describe("BAAM authenticated context is bounded and contains no answer data", () => {
  const identity = {
    actorId: "actor",
    organizationId: "org",
    authorizationFingerprint: "current-grants",
  };
  const plan = {
    intent: "summary" as const,
    metrics: ["sales" as const],
    limitation: "none" as const,
  };
  const secret = "synthetic-context-secret";
  const issue = () =>
    issueBaamContext({ ...identity, ...selected, storeId: "a", plan }, secret, now.getTime());
  it("round-trips typed intent/scope without question, numbers, raw history or provider state", () => {
    expect(readBaamContext(issue(), identity, secret, now.getTime())).toMatchObject({
      ...identity,
      ...selected,
      plan,
    });
    const payload = JSON.parse(Buffer.from(issue().split(".")[0], "base64url").toString());
    expect(Object.keys(payload).sort()).toEqual(
      [
        "actorId",
        "organizationId",
        "authorizationFingerprint",
        "dateFrom",
        "dateTo",
        "storeId",
        "plan",
        "version",
        "issuedAt",
        "expiresAt",
      ].sort(),
    );
  });
  it.each(["actorId", "organizationId", "authorizationFingerprint"] as const)(
    "rejects changed %s",
    (field) =>
      expect(
        readBaamContext(issue(), { ...identity, [field]: "changed" }, secret, now.getTime()),
      ).toBeNull(),
  );
  it("rejects modification, truncation, invalid schema, wrong key, expiry and future issuance", () => {
    const token = issue();
    for (const value of [token + "x", token.slice(1), "x".repeat(4097), "malformed"])
      expect(readBaamContext(value, identity, secret, now.getTime())).toBeNull();
    expect(readBaamContext(token, identity, "different", now.getTime())).toBeNull();
    expect(readBaamContext(token, identity, secret, now.getTime() + 1800000)).toBeNull();
    expect(readBaamContext(token, identity, secret, now.getTime() - 1)).toBeNull();
    expect(() =>
      issueBaamContext(
        { ...identity, ...selected, plan: { ...plan, metrics: ["profit"] } } as never,
        secret,
      ),
    ).toThrow();
  });
});
