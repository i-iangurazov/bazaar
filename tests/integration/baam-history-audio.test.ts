import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { getLogger } from "@/server/logging";
import { baamActions, resultId } from "@/server/services/baamBusiness";
import {
  proposeBaamAction,
  executeBaamAction,
  cancelBaamAction,
} from "@/server/services/baamActions";
import {
  appendBaamMessage,
  createBaamConversation,
  claimBaamTurn,
  readBaamConversation,
  changeBaamConversation,
  listBaamConversations,
  stopBaamTurn,
} from "@/server/services/baamConversations";
import { transcribeBaamAudio } from "@/server/services/baamAudio";
import { sendBaamMessage } from "@/server/services/baamCompanion";
import {
  getSubscriptionUsage,
  reserveSubscriptionUsage,
  startSubscriptionUsage,
  settleSubscriptionUsage,
} from "@/server/billing/subscriptionUsage";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

function wav() {
  const b = Buffer.alloc(32044);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(32000, 40);
  return b;
}

describe.skipIf(!shouldRunDbTests)("BAAM durable history, audio, and interrupted workflows", () => {
  beforeEach(resetDatabase);
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    delete baamActions.test_workflow;
  });
  async function fixture() {
    const seed = await seedBase({ plan: "ENTERPRISE" });
    const user = seed.managerUser;
    const ctx = {
      prisma,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        organizationId: seed.org.id,
        isOrgOwner: false,
        isPlatformOwner: false,
      },
      impersonator: null,
      impersonationSessionId: null,
      ip: "127.0.0.1",
      requestId: randomUUID(),
      logger: getLogger("baam-durable-test"),
    };
    const conversation = await createBaamConversation(ctx, { locale: "en" });
    const request = {
      conversationId: conversation.id,
      clientRequestId: randomUUID(),
      text: "Create a supplier",
      locale: "en" as const,
      revision: 0,
      attachmentIds: [],
    };
    return { ...seed, ctx, conversation, request };
  }
  it("meters a new-contract voice transcript and its answer as one shared operation, including replay", async () => {
    const f = await fixture();
    await prisma.organization.update({
      where: { id: f.org.id },
      data: {
        currentPeriodEndsAt: new Date(Date.now() + 30 * 86400000),
      },
    });
    await prisma.subscriptionContract.create({
      data: { organizationId: f.org.id, catalogVersion: "2026-11" },
    });
    vi.stubEnv("OPENAI_API_KEY", "synthetic-voice-key");
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    const provider = vi.fn(async () =>
      Response.json({ text: "Help", languages: [{ code: "en" }] }),
    );
    vi.stubGlobal("fetch", provider);
    const transcript = await transcribeBaamAudio(
      f.ctx,
      f.conversation.id,
      wav(),
      "audio/wav",
      "en",
    );
    expect((await transcribeBaamAudio(f.ctx, f.conversation.id, wav(), "audio/wav", "en")).id).toBe(
      transcript.id,
    );
    const request = {
      ...f.request,
      text: transcript.text!,
      transcriptionId: transcript.id,
      command: { kind: "help" as const },
    };
    expect((await sendBaamMessage(f.ctx, request)).status).toBe("COMPLETED");
    expect((await sendBaamMessage(f.ctx, request)).replayed).toBe(true);
    const usage = await getSubscriptionUsage(f.org.id);
    expect(usage.find((r) => r.resource === "ai")).toMatchObject({ used: 1, reserved: 0 });
    expect(usage.find((r) => r.resource === "voice")).toMatchObject({ used: 0, reserved: 0 });
    expect(provider).toHaveBeenCalledTimes(1);
  });
  async function modernStarter(f: Awaited<ReturnType<typeof fixture>>) {
    await prisma.user.updateMany({
      where: { organizationId: f.org.id, id: { notIn: [f.adminUser.id, f.managerUser.id] } },
      data: { isActive: false },
    });
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { plan: "STARTER", currentPeriodEndsAt: new Date(Date.now() + 30 * 86400000) },
    });
    await prisma.subscriptionContract.create({
      data: { organizationId: f.org.id, catalogVersion: "2026-11" },
    });
    vi.stubEnv("OPENAI_API_KEY", "synthetic-voice-key");
    vi.stubEnv("DEEPSEEK_API_KEY", "");
  }
  it("blocks voice before the provider when the shared Starter pool is exhausted", async () => {
    const f = await fixture();
    await modernStarter(f);
    const lease = await reserveSubscriptionUsage({
      organizationId: f.org.id,
      resource: "ai",
      operationKey: "previous-ai-work",
      units: 100,
    });
    await startSubscriptionUsage(lease);
    await settleSubscriptionUsage(lease, true);
    const provider = vi.fn(async () => Response.json({ text: "Help" }));
    vi.stubGlobal("fetch", provider);
    await expect(
      transcribeBaamAudio(f.ctx, f.conversation.id, wav(), "audio/wav", "en"),
    ).rejects.toThrow("billingUsageLimitReached");
    expect(provider).not.toHaveBeenCalled();
    expect(
      (await getSubscriptionUsage(f.org.id)).find((row) => row.resource === "ai"),
    ).toMatchObject({ used: 100, reserved: 0 });
  });
  it("lets the last voice transcript consume slot100 and blocks a later plain chat without double charging its voice answer", async () => {
    const f = await fixture();
    await modernStarter(f);
    const previous = await reserveSubscriptionUsage({
      organizationId: f.org.id,
      resource: "ai",
      operationKey: "previous-voice-results",
      units: 99,
    });
    await startSubscriptionUsage(previous);
    await settleSubscriptionUsage(previous, true);
    const provider = vi.fn(async () => Response.json({ text: "Help" }));
    vi.stubGlobal("fetch", provider);
    const transcript = await transcribeBaamAudio(
      f.ctx,
      f.conversation.id,
      wav(),
      "audio/wav",
      "en",
    );
    const voiced = await sendBaamMessage(f.ctx, {
      ...f.request,
      clientRequestId: randomUUID(),
      text: transcript.text!,
      transcriptionId: transcript.id,
      command: { kind: "help" },
    });
    expect(voiced.status).toBe("COMPLETED");
    const plain = await sendBaamMessage(f.ctx, {
      ...f.request,
      clientRequestId: randomUUID(),
      text: "Help",
      command: { kind: "help" },
    });
    expect(plain.status).toBe("FAILED");
    expect(
      (await prisma.baamTurn.findUniqueOrThrow({ where: { id: plain.turnId } })).errorCode,
    ).toBe("billingUsageLimitReached");
    expect(
      (await getSubscriptionUsage(f.org.id)).find((row) => row.resource === "ai"),
    ).toMatchObject({ used: 100, reserved: 0 });
    expect((await transcribeBaamAudio(f.ctx, f.conversation.id, wav(), "audio/wav", "en")).id).toBe(
      transcript.id,
    );
    expect(provider).toHaveBeenCalledTimes(1);
  });
  const rejectNextCustomerQuotaCommit = () => {
    const original = prisma.$transaction.bind(prisma);
    let rejected = false;
    const intercepted = ((arg: unknown, options?: { maxWait?: number; timeout?: number }) => {
      if (Array.isArray(arg)) return original(arg);
      const run = arg as (tx: Prisma.TransactionClient) => Promise<unknown>;
      return original(
        async (tx) =>
          run(
            new Proxy(tx, {
              get(target, key, receiver) {
                if (key !== "subscriptionUsageReservation")
                  return Reflect.get(target, key, receiver);
                return new Proxy(target.subscriptionUsageReservation, {
                  get(delegate, method, delegateReceiver) {
                    if (method !== "update") return Reflect.get(delegate, method, delegateReceiver);
                    return (args: Prisma.SubscriptionUsageReservationUpdateArgs) => {
                      if (
                        !rejected &&
                        args.data.state === "COMMITTED" &&
                        args.data.actualUnits === undefined
                      ) {
                        rejected = true;
                        throw new Error("synthetic quota commit failure");
                      }
                      return delegate.update(args);
                    };
                  },
                });
              },
            }),
          ),
        options,
      );
    }) as typeof prisma.$transaction;
    const spy = vi.spyOn(prisma, "$transaction").mockImplementation(intercepted);
    return { spy, rejected: () => rejected };
  };
  it("does not expose a completed transcript when its customer-quota transaction rolls back", async () => {
    const f = await fixture();
    await modernStarter(f);
    const provider = vi.fn(async () => Response.json({ text: "Help" }));
    vi.stubGlobal("fetch", provider);
    const fault = rejectNextCustomerQuotaCommit();
    try {
      await expect(
        transcribeBaamAudio(f.ctx, f.conversation.id, wav(), "audio/wav", "en"),
      ).rejects.toThrow("synthetic quota commit failure");
      expect(fault.rejected()).toBe(true);
      expect(
        await prisma.baamTranscription.count({
          where: { conversationId: f.conversation.id, status: "COMPLETED" },
        }),
      ).toBe(0);
      expect(
        (await getSubscriptionUsage(f.org.id)).find((row) => row.resource === "ai"),
      ).toMatchObject({ used: 0, reserved: 0 });
      const result = await transcribeBaamAudio(f.ctx, f.conversation.id, wav(), "audio/wav", "en");
      expect(result.status).toBe("COMPLETED");
      expect(
        (await getSubscriptionUsage(f.org.id)).find((row) => row.resource === "ai"),
      ).toMatchObject({ used: 1, reserved: 0 });
    } finally {
      fault.spy.mockRestore();
    }
  });
  it("commits the Baam answer and quota atomically and keeps a successful replay free", async () => {
    const f = await fixture();
    await modernStarter(f);
    const fault = rejectNextCustomerQuotaCommit();
    try {
      const failed = await sendBaamMessage(f.ctx, {
        ...f.request,
        text: "Help",
        command: { kind: "help" },
      });
      expect(fault.rejected()).toBe(true);
      expect(failed.status).toBe("FAILED");
      expect(
        await prisma.baamMessage.count({ where: { turnId: failed.turnId, role: "assistant" } }),
      ).toBe(0);
      expect(
        (await getSubscriptionUsage(f.org.id)).find((row) => row.resource === "ai"),
      ).toMatchObject({ used: 0, reserved: 0 });
      const request = {
        ...f.request,
        clientRequestId: randomUUID(),
        text: "Help",
        command: { kind: "help" as const },
      };
      expect((await sendBaamMessage(f.ctx, request)).status).toBe("COMPLETED");
      expect((await sendBaamMessage(f.ctx, request)).replayed).toBe(true);
      expect(
        (await getSubscriptionUsage(f.org.id)).find((row) => row.resource === "ai"),
      ).toMatchObject({ used: 1, reserved: 0 });
    } finally {
      fault.spy.mockRestore();
    }
  });
  it("pages a long server history without omissions, and deletes only the owned dialog", async () => {
    const f = await fixture();
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < 83; i++)
        await appendBaamMessage(tx, {
          conversationId: f.conversation.id,
          role: "user",
          text: `Message ${i}`,
        });
    });
    const first = await readBaamConversation(f.ctx, f.conversation.id);
    const second = await readBaamConversation(f.ctx, f.conversation.id, first.next!);
    const third = await readBaamConversation(f.ctx, f.conversation.id, second.next!);
    expect(first.messages).toHaveLength(40);
    expect(second.messages).toHaveLength(40);
    expect(third.messages).toHaveLength(3);
    expect(third.next).toBeNull();
    expect(
      new Set([...first.messages, ...second.messages, ...third.messages].map((m) => m.id)).size,
    ).toBe(83);
    expect(first.messages.at(-1)?.text).toBe("Message 82");
    await changeBaamConversation(f.ctx, { id: f.conversation.id, revision: 0, remove: true });
    await expect(readBaamConversation(f.ctx, f.conversation.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await listBaamConversations(f.ctx)).items).toHaveLength(0);
  });
  it("hides even an all-store dialog after any historical store permission is revoked", async () => {
    const f = await fixture();
    expect(f.conversation.storeId).toBeNull();
    await prisma.userStoreAccess.deleteMany({ where: { userId: f.managerUser.id } });
    await expect(readBaamConversation(f.ctx, f.conversation.id)).rejects.toMatchObject({
      message: "storeAccessDenied",
    });
    expect((await listBaamConversations(f.ctx)).items).toHaveLength(0);
  });
  it("serializes two tabs, cancels immediately and saves a cancellation only once", async () => {
    const f = await fixture();
    const attempts = await Promise.allSettled([
      claimBaamTurn(f.ctx, f.request),
      claimBaamTurn(f.ctx, { ...f.request, clientRequestId: randomUUID() }),
    ]);
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    const turn = await prisma.baamTurn.findFirstOrThrow({
      where: { conversationId: f.conversation.id, status: "RUNNING" },
    });
    const proposal = await proposeBaamAction(f.ctx, turn.id, "supplier_create", {
      name: "Never executed",
    });
    expect(
      (await proposeBaamAction(f.ctx, turn.id, "supplier_create", { name: "Never executed" })).id,
    ).toBe(proposal.id);
    await stopBaamTurn(f.ctx, f.conversation.id);
    await stopBaamTurn(f.ctx, f.conversation.id);
    const history = await readBaamConversation(f.ctx, f.conversation.id);
    expect(history.activeTurn).toBeNull();
    expect(history.messages.filter((m) => m.text === "baamStopped")).toHaveLength(1);
    expect((await executeBaamAction(f.ctx, proposal.id)).status).toBe("CANCELLED");
    expect(await prisma.supplier.count({ where: { name: "Never executed" } })).toBe(0);
    expect(
      (await claimBaamTurn(f.ctx, { ...f.request, clientRequestId: randomUUID() })).fresh,
    ).toBe(true);
  });
  it("recovers successful steps after a partial failure and never repeats them", async () => {
    const f = await fixture();
    let fail = true;
    baamActions.test_workflow = {
      name: "test_workflow",
      description: "Test-only fault injection around real supplier services",
      schema: z.object({}).strict(),
      roles: ["MANAGER"],
      prepare: async () => ({
        input: {},
        summary: { title: "Two suppliers", details: [], href: "/suppliers" },
        storeIds: [],
      }),
      execute: async (c) => {
        const first = await c.step("first", ["SUPPLIER_CREATE"], (api) =>
          api.suppliers.create({ name: "First supplier" }),
        );
        if (fail) throw new Error("baamActionFailed");
        await c.step("second", ["SUPPLIER_CREATE"], (api) =>
          api.suppliers.create({ name: "Second supplier" }),
        );
        return {
          title: "Completed suppliers",
          details: [],
          href: "/suppliers",
          resourceId: resultId(first),
        };
      },
    };
    const { turn } = await claimBaamTurn(f.ctx, f.request);
    const proposal = await proposeBaamAction(f.ctx, turn.id, "test_workflow", {});
    await prisma.baamTurn.update({ where: { id: turn.id }, data: { status: "COMPLETED" } });
    await prisma.baamConversation.update({
      where: { id: f.conversation.id },
      data: { activeTurnId: null },
    });
    await expect(executeBaamAction(f.ctx, proposal.id)).rejects.toMatchObject({
      message: "baamActionFailed",
    });
    const failed = await prisma.baamAction.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(failed.status).toBe("FAILED");
    expect(failed.result).toMatchObject({ title: "Partially completed" });
    await expect(cancelBaamAction(f.ctx, proposal.id)).rejects.toMatchObject({
      message: "baamPartialAction",
    });
    fail = false;
    expect((await executeBaamAction(f.ctx, proposal.id)).status).toBe("COMPLETED");
    expect(
      await prisma.supplier.count({
        where: { name: { in: ["First supplier", "Second supplier"] } },
      }),
    ).toBe(2);
    expect(
      await prisma.baamExecution.count({ where: { actionId: proposal.id, status: "COMMITTED" } }),
    ).toBe(2);
  });
  it("deduplicates an audio upload, persists its editable transcript, and refuses a second send of the same recording", async () => {
    const f = await fixture();
    vi.stubEnv("OPENAI_API_KEY", "test-provider-key");
    const provider = vi
      .fn()
      .mockResolvedValue(
        Response.json({ text: "Sell two teas for 150 som", languages: [{ code: "en" }] }),
      );
    vi.stubGlobal("fetch", provider);
    const first = await transcribeBaamAudio(f.ctx, f.conversation.id, wav(), "audio/wav", "en");
    const replay = await transcribeBaamAudio(f.ctx, f.conversation.id, wav(), "audio/wav", "en");
    expect(replay.id).toBe(first.id);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(first.needsReview).toBe(true);
    const body = provider.mock.calls[0][1].body as FormData;
    expect(body.has("languages[]")).toBe(false);
    expect(body.get("file")).toBeInstanceOf(Blob);
    await claimBaamTurn(f.ctx, {
      ...f.request,
      text: "Sell THREE teas for 150 som",
      transcriptionId: first.id,
    });
    await stopBaamTurn(f.ctx, f.conversation.id);
    await expect(
      claimBaamTurn(f.ctx, {
        ...f.request,
        clientRequestId: randomUUID(),
        transcriptionId: first.id,
      }),
    ).rejects.toMatchObject({ message: "baamAudioAlreadySent" });
    const other = await createBaamConversation(f.ctx, { locale: "en" });
    await expect(
      claimBaamTurn(f.ctx, { ...f.request, conversationId: other.id, transcriptionId: first.id }),
    ).rejects.toMatchObject({ message: "baamAudioNotFound" });
    expect(Object.keys(first)).not.toContain("audio");
    expect(Object.keys(first)).not.toContain("url");
  });
});
