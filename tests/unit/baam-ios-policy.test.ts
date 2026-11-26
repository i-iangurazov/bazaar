import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaamSend } from "@/lib/baam/companion";
import type { Context } from "@/server/trpc/trpc";
import {
  baamIosHelpText,
  baamIosNeedsLocalHelp,
  isBaamIosRequest,
} from "@/server/services/baamIosPolicy";
import { readBaamConversation } from "@/server/services/baamConversations";
import { understandBaamIntent } from "@/server/services/baamWorkflowIntent";

const db = vi.hoisted(() => ({
  baamConversation: { findFirst: vi.fn() },
  baamMessage: { findMany: vi.fn() },
  baamTurn: { findFirst: vi.fn() },
  baamAction: { findMany: vi.fn() },
  baamWorkflow: { findMany: vi.fn() },
}));
vi.mock("@/server/db/prisma", () => ({ prisma: db }));
vi.mock("@/server/services/baamMetrics", () => ({
  getBaamAccessScope: async () => ({ actorId: "user", organizationId: "org", storeIds: [] }),
}));

const origin = "https://www.bazaar.kg";
const iosAgent = "Mobile/15E148 BazaarNativeIOS/1.0.0 (production)";
const ios = (agent = iosAgent, url = origin, caller = url) =>
  isBaamIosRequest(new Request(url + "/api/trpc/baam.send", { headers: { "user-agent": agent, origin: caller } }));

const input = (text: string, overrides: Partial<BaamSend> = {}): BaamSend => ({
  conversationId: "conversation",
  clientRequestId: "test-turn-1",
  revision: 0,
  locale: "ru",
  text,
  attachmentIds: [],
  ...overrides,
});

describe("Baam health answers on iOS", () => {
  beforeEach(() => vi.resetAllMocks());

  it("uses the approved native WebView origin rather than a mobile Safari or Android request", () => {
    expect(ios()).toBe(true);
    expect(ios("Mobile/15E148 Safari/604.1")).toBe(false);
    expect(ios("BazaarNativeAndroid/1.0.0")).toBe(false);
    expect(ios(iosAgent, "https://example.invalid")).toBe(false);
    expect(ios(iosAgent, origin, "https://example.invalid")).toBe(false);
  });

  it.each(["У меня болит голова. Что делать?", "What is diabetes?", "Башым ооруйт", "Что такое астма?"])(
    "chooses a local answer for %s",
    (question) => expect(baamIosNeedsLocalHelp(input(question))).toBe(true),
  );

  it("checks edited speech and health questions while preserving ordinary photos and store documents", () => {
    expect(baamIosNeedsLocalHelp(input("Помоги", { transcriptionId: "speech" }), "Башым ооруйт")).toBe(true);
    expect(baamIosNeedsLocalHelp(input("Что такое диабет?", { attachmentIds: ["photo"] }))).toBe(true);
    expect(baamIosNeedsLocalHelp(input("Посмотри фото", { attachmentIds: ["photo"] }))).toBe(false);
    expect(baamIosNeedsLocalHelp(input("Расшифруй позиции накладной с лекарствами", { attachmentIds: ["invoice"] }))).toBe(false);
    expect(baamIosNeedsLocalHelp(input("Создай товар по фото", { attachmentIds: ["photo"] }))).toBe(false);
    expect(baamIosNeedsLocalHelp(input("Show inventory for Headache pills"))).toBe(false);
    expect(baamIosNeedsLocalHelp(input("Что делать при возврате товара?"))).toBe(false);
    expect(baamIosNeedsLocalHelp(input("Покажи продажи, и что делать, если болит голова?"))).toBe(true);
  });

  it("returns the local iOS response before a photo or text model attempt", async () => {
    const record = vi.fn();
    const intent = await understandBaamIntent({
      text: "У меня болит голова. Что делать?",
      locale: "ru",
      history: [],
      images: ["data:image/png;base64,fixture"],
      iosBusinessHelpOnly: true,
      signal: new AbortController().signal,
      record,
    });
    expect(intent).toMatchObject({ kind: "answer", source: "grammar", reply: baamIosHelpText("ru") });
    expect(record).not.toHaveBeenCalled();
  });

  it("replaces a stored web answer on iOS without deleting data, skipping a row, or hiding the safe reply", async () => {
    const assistant = (sequence: number, turnId: string, text: string) =>
      ({ id: String(sequence), sequence, turnId, text, role: "assistant", parts: [] });
    const webAnswer = assistant(50, "old", "Old general answer");
    const business = assistant(49, "sale", "Откройте кассу.");
    const alreadySafe = assistant(48, "safe", baamIosHelpText("en"));
    const page = [webAnswer, business, alreadySafe,
      ...Array.from({ length: 38 }, (_, index) => assistant(47 - index, "sale", "Продажи за неделю"))];
    db.baamConversation.findFirst.mockResolvedValue({ id: "conversation", title: "У меня болит голова", scopeStoreIds: [] });
    db.baamMessage.findMany.mockImplementation(async (args) => args.where.role === "user"
      ? [{ turnId: "old", text: "У меня болит голова", turn: { locale: "ru" }, parts: [] },
          { turnId: "safe", text: "What is diabetes?", turn: { locale: "en" }, parts: [] }]
      : page);
    db.baamAction.findMany.mockResolvedValue([]);
    db.baamWorkflow.findMany.mockResolvedValue([]);
    const ctx = { user: { id: "user", organizationId: "org" } } as Context;
    const web = await readBaamConversation(ctx, "conversation", 51);
    const native = await readBaamConversation({ ...ctx, nativeIosBaam: true }, "conversation", 51);

    expect(native.next).toBe(web.next);
    expect(native.messages.map((message) => message.id)).toEqual(web.messages.map((message) => message.id));
    expect(native.messages.at(-3)?.text).toBe(alreadySafe.text);
    expect(native.messages.at(-2)?.text).toBe(business.text);
    expect(native.messages.at(-1)?.text).toBe(baamIosHelpText("ru"));
    expect(web.messages.at(-1)?.text).toBe(webAnswer.text);
    expect(native.conversation.title).toBe("Baam");
    expect(web.conversation.title).toBe("У меня болит голова");
    expect(db.baamMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ role: "user", turnId: expect.objectContaining({ in: expect.arrayContaining(["old"]) }) }),
    }));
  });
});
