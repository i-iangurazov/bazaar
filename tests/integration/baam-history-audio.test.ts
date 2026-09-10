import { randomUUID } from "node:crypto";
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
