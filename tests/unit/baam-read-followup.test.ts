import { expect, it } from "vitest";
import { continueBaamRead } from "@/server/services/baamReadFollowup";
import { readRequest } from "../helpers/baamReadProvider";
const now = new Date("2026-10-22T06:00:00Z");
const stores = [
  { id: "store-a", name: "Test Store" },
  { id: "store-b", name: "Second shop" },
];
const previous = {
  requests: [
    readRequest({ mode: "comparison", dateFrom: "2026-10-19", dateTo: "2026-10-22", store: "*" }),
  ],
  format: "table" as const,
  clarification: null,
};
it.each(["А за вчера?", "And for yesterday?", "Ал эми кечээ?"])(
  "retains comparison, format and all-store scope for %s",
  (text) => {
    const plan = continueBaamRead(text, previous, stores, "store-a", now);
    expect(plan?.format).toBe("table");
    expect(plan?.requests[0]).toMatchObject({
      mode: "comparison",
      dateFrom: "2026-10-21",
      dateTo: "2026-10-21",
      store: "*",
    });
  },
);
it("changes only the store on a scope-only follow-up", () => {
  expect(
    continueBaamRead("А в Second shop?", previous, stores, undefined, now)?.requests[0],
  ).toMatchObject({ mode: "comparison", store: "Second shop", dateFrom: "2026-10-19" });
});
it("lets an explicit all-store request override the conversation selection", () => {
  const one = { ...previous, requests: [readRequest({ mode: "comparison", store: "Test Store" })] };
  expect(
    continueBaamRead("А по всем магазинам?", one, stores, "store-a", now)?.requests[0].store,
  ).toBe("*");
});
it.each([
  "А что вообще происходит в магазине за этот месяц?",
  "Покажи топ-7 товаров за вчера",
  "А новые клиенты за вчера?",
  "Покажи за 32 октября",
])("does not reuse an old analysis for a new/invalid question: %s", (text) => {
  expect(continueBaamRead(text, previous, stores, undefined, now)).toBeNull();
});
it("does not represent current stock as historical stock", () => {
  expect(
    continueBaamRead(
      "А за вчера?",
      { ...previous, requests: [readRequest({ dataset: "inventory", mode: "list" })] },
      stores,
      undefined,
      now,
    ),
  ).toBeNull();
});
