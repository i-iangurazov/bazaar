import { describe, expect, it } from "vitest";
import type { BaamLocale } from "@/lib/baam/companion";
import type { AppRole } from "@/lib/roleAccess";
import {
  answerBaamOperationalHelp,
  baamOperationalTopic,
  readBaamPrinterDetails,
} from "@/server/services/baamOperationalHelp";

const stores = [{ id: "store-centre", name: "Центр" }, { id: "store-market", name: "Рынок" }];
const access = (role: AppRole = "ADMIN", locale: BaamLocale = "ru") => ({
  access: { role }, locale, stores,
});

describe("BAAM help for real workflows", () => {
  it.each([
    ["Как настроить принтер?", "printer"],
    ["How to set up a printer?", "printer"],
    ["Принтерди кантип жөндөө керек?", "printer"],
    ["Как оформить продажу в магазине Центр?", "sale"],
    ["Составь короткую инструкцию кассиру по продаже", "sale"],
    ["Как продлить подписку?", "billing"],
    ["Составь инструкцию", "instruction"],
    ["Как идут продажи за неделю?", null],
    ["Продай принтер", null],
    ["Покажи остаток принтеров", null],
  ])("routes %s to %s", (text, topic) => {
    expect(baamOperationalTopic({ text })).toBe(topic);
  });

  it("uses the current printing page for an otherwise unspecified instruction", () => {
    expect(baamOperationalTopic({ text: "Составь инструкцию", page: { path: "/settings/printing" } })).toBe("printer");
  });

  it("asks for the missing printer details and links to the existing settings", () => {
    const result = answerBaamOperationalHelp({
      topic: "printer", text: "Как настроить принтер?", locale: "ru", access: access(),
    });
    expect(result.text).toMatch(/модель принтера/);
    expect(result.text).toMatch(/размер бумаги или этикетки в мм/);
    expect(result.text).toMatch(/USB, Wi-Fi или Bluetooth/);
    expect(result.text).toMatch(/устройство и систему/);
    expect(result.parts).toContainEqual({ type: "link", label: "Настройки печати", href: "/settings/printing" });
    expect(result.parts.every((part) => part.type !== "workflow")).toBe(true);
  });

  it("keeps previously supplied printer details and uses the correct label panels and dimensions", () => {
    const result = answerBaamOperationalHelp({
      topic: "printer", text: "Этикетки 58×40 мм, USB, Windows 11", locale: "ru", access: access(),
      previousPrinter: readBaamPrinterDetails("Xprinter XP-350B"),
    });
    expect(result.text).toContain("Xprinter XP-350B · USB · Windows 11");
    expect(result.text).toContain("58×40 мм");
    expect(result.text).toContain("масштаб 100%");
    expect(result.text).not.toContain("уточните");
  });

  it("uses the specified receipt width and test receipt printing", () => {
    const result = answerBaamOperationalHelp({
      topic: "printer", text: "Epson TM-T20, чек 80 мм, USB, Windows", locale: "ru", access: access(),
    });
    expect(result.text).toContain("Тестовая печать чека");
    expect(result.text).toContain("80 мм");
  });

  it("walks through the requested accessible store and links to the POS entry and exact help article", () => {
    const result = answerBaamOperationalHelp({
      topic: "sale", text: "Как оформить продажу в магазине Центр?", locale: "ru", access: access(), storeId: "store-market",
    });
    expect(result.text).toContain("«Центр»");
    expect(result.text).toContain("после получения оплаты");
    expect(result.parts.map((part) => part.type === "link" ? part.href : null)).toEqual([
      "/pos?store=store-centre", "/help/pos/make-sale",
    ]);
  });

  it("does not send a cashier to the wrong store when a requested store is inaccessible", () => {
    const result = answerBaamOperationalHelp({
      topic: "sale", text: "Как оформить продажу в магазине Закрытый?", locale: "ru", access: access(), storeId: "store-market",
    });
    expect(result.text).toContain("В каком магазине");
    expect(result.parts).toEqual([]);
  });

  it("gives billing navigation only to the billing role", () => {
    const request = { topic: "billing", text: "Как продлить подписку?", locale: "ru" } as const;
    expect(answerBaamOperationalHelp({ ...request, access: access() }).parts).toEqual([
      { type: "link", label: "Подписка и оплата", href: "/billing" },
    ]);
    const manager = answerBaamOperationalHelp({ ...request, access: access("MANAGER") });
    expect(manager.parts).toEqual([]);
    expect(manager.text).toContain("администратор");
  });

  it("asks for a task and audience while preparing an unspecified instruction", () => {
    const result = answerBaamOperationalHelp({
      topic: "instruction", text: "Составь инструкцию", locale: "ru", access: access(),
    });
    expect(result.text).toContain("какую задачу");
    expect(result.text).toContain("для кого");
    expect(result.parts).toEqual([]);
  });
});
