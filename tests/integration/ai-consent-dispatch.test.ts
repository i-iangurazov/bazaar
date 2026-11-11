import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_PRIVACY_CONSENT_VERSION } from "@/lib/aiPrivacy";
import { whatsappKnowledgeSchema, whatsappProfileSchema } from "@/lib/whatsapp-ai";
import { prisma } from "@/server/db/prisma";
import { getLogger } from "@/server/logging";
import { withAiOperationBudget } from "@/server/billing/aiOperationBudget";
import { getSubscriptionUsage } from "@/server/billing/subscriptionUsage";
import { updateAiConsent, withAiPrivacyIdentity } from "@/server/services/aiPrivacy";
import { fetchAiResponse } from "@/server/services/aiProvider";
import { createBaamConversation } from "@/server/services/baamConversations";
import { transcribeBaamAudio } from "@/server/services/baamAudio";
import { callOpenAiImageEnhancement } from "@/server/services/productImageStudio";
import { generateWhatsAppAnswer } from "@/server/whatsapp/assistant";
import { resetDatabase, shouldRunDbTests } from "../helpers/db";
import { seedConsentingAiFixture } from "../helpers/consentingAiFixture";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};
const outcome = <T>(promise: Promise<T>) => promise.then(
  (value) => ({ status: "fulfilled" as const, value }),
  (reason: unknown) => ({ status: "rejected" as const, reason }),
);
const textConfig = { provider: "deepseek" as const, model: "deepseek-flash",
  apiKey: "synthetic-dispatch-only", url: "https://api.deepseek.com/responses" };

function wav() {
  const bytes = Buffer.alloc(32044);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(32000, 40);
  return bytes;
}

async function fixture() {
  const f = await seedConsentingAiFixture({ plan: "BUSINESS" });
  await prisma.organization.update({ where: { id: f.org.id }, data: {
    currentPeriodEndsAt: new Date(Date.now() + 30 * 86400000),
  } });
  await prisma.subscriptionContract.create({ data: {
    organizationId: f.org.id, catalogVersion: "2026-11",
  } });
  const ctx = {
    prisma, user: { ...f.managerUser, organizationId: f.org.id, isPlatformOwner: false },
    impersonator: null, impersonationSessionId: null, ip: "127.0.0.1",
    requestId: randomUUID(), logger: getLogger("synthetic-ai-dispatch-test"),
  };
  return { ...f, ctx };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const consent = (f: Fixture, userId: string, granted: boolean) => updateAiConsent({
  organizationId: f.org.id, userId, granted, version: AI_PRIVACY_CONSENT_VERSION,
  requestId: randomUUID(),
});
const usage = async (f: Fixture, resource: string) =>
  (await getSubscriptionUsage(f.org.id)).find((row) => row.resource === resource)!;

// The outbound operation really waits inside the production budget transaction.
// A NO KEY UPDATE organization hold allows consent's audit FK to commit while
// preventing the usage budget's UPDATE lock from proceeding.
async function revokeDuringBudgetWait<T>(f: Fixture, userId: string, run: () => Promise<T>,
  kind: "organization" | "whatsapp" = "organization") {
  const held = deferred(), release = deferred();
  let holderPid = 0;
  const holder = outcome(prisma.$transaction(async (tx) => {
    holderPid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0].pid;
    if (kind === "organization") {
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${f.org.id} FOR NO KEY UPDATE`;
    } else {
      const key = `whatsapp-ai-budget:${new Date().toISOString().slice(0, 10)}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    }
    held.resolve();
    await release.promise;
  }, { timeout: 12_000 }));
  await held.promise;
  const result = outcome(run());
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const rows = await prisma.$queryRaw<Array<{ pid: number }>>`
        SELECT pid FROM pg_stat_activity WHERE datname = current_database()
        AND ${holderPid} = ANY(pg_blocking_pids(pid))
      `;
      if (rows.length) { waiting = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting, "provider must be waiting on the real budget lock").toBe(true);
    expect((await consent(f, userId, false)).granted).toBe(false);
  } finally {
    release.resolve();
    expect((await holder).status).toBe("fulfilled");
  }
  return result;
}

const imageRequest = async (f: Fixture) => {
  const buffer = await sharp({ create: {
    width: 600, height: 600, channels: 3, background: "blue",
  } }).png().toBuffer();
  return {
    organizationId: f.org.id, jobId: randomUUID(), prompt: "Keep the same product on white",
    sourceImage: { buffer, normalizedUrl: "/uploads/synthetic-dispatch-source.png",
      mimeType: "image/png", bytes: buffer.length, width: 600, height: 600 },
    presets: { backgroundMode: "WHITE" as const, outputFormat: "SQUARE" as const,
      centered: true, improveVisibility: true, softShadow: false,
      tighterCrop: false, brighterPresentation: false },
  };
};

describeDb("committed consent withdrawal at actual AI dispatch boundaries", () => {
  const network = vi.fn();
  beforeEach(async () => {
    await resetDatabase();
    network.mockReset();
    vi.stubGlobal("fetch", network);
    vi.stubEnv("OPENAI_API_KEY", "synthetic-dispatch-only");
    vi.stubEnv("DEEPSEEK_API_KEY", "synthetic-dispatch-only");
    vi.stubEnv("AI_PROVIDER", "deepseek");
    vi.stubEnv("WHATSAPP_PRIVACY_APPROVED", "1");
    vi.stubEnv("WHATSAPP_DAILY_BUDGET_USD_MICROS", "100000000");
    vi.stubEnv("HARDENING_EXTERNAL_PROVIDER_MODE", "");
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("blocks text after withdrawal commits during its vendor-budget wait and returns the unused reserve", async () => {
    const f = await fixture();
    const run = () => withAiPrivacyIdentity({ userId: f.managerUser.id, organizationId: f.org.id },
      () => withAiOperationBudget({ organizationId: f.org.id, enabled: true },
        () => fetchAiResponse(textConfig, { input: "Synthetic private request" }, AbortSignal.timeout(10_000))));
    const result = await revokeDuringBudgetWait(f, f.managerUser.id, run);
    expect(result).toMatchObject({ status: "rejected", reason: { message: "aiConsentRequired" } });
    expect(network).not.toHaveBeenCalled();
    expect(await usage(f, "aiVendorBudgetMinor")).toMatchObject({ used: 0, reserved: 0 });
    const reservation = await prisma.subscriptionUsageReservation.findFirstOrThrow({
      where: { organizationId: f.org.id, resource: "aiVendorBudgetMinor" },
    });
    expect(reservation.actualUnits).toBe(0);
    await consent(f, f.managerUser.id, true);
    network.mockResolvedValue(Response.json({ usage: { input_tokens: 10, output_tokens: 2 }, output: [] }));
    await run();
    expect(network).toHaveBeenCalledOnce();
    expect((await usage(f, "aiVendorBudgetMinor")).used).toBeGreaterThan(0);
  }, 18_000);

  it("blocks WhatsApp after withdrawal during its real daily-budget wait without recording a model attempt", async () => {
    const f = await fixture();
    const dailyPeriod = new Date().toISOString().slice(0, 10);
    const id = `budget:${dailyPeriod}`;
    await prisma.whatsAppWorkerState.create({ data: { id, dailyPeriod, state: "BUDGET", spentMicros: 37n } });
    const result = await revokeDuringBudgetWait(f, f.adminUser.id, () => generateWhatsAppAnswer({
      organizationId: f.org.id, storeId: f.store.id, incoming: "Hello",
      profile: whatsappProfileSchema.parse({}),
      knowledge: whatsappKnowledgeSchema.parse({ storeName: "Synthetic store" }), firstReply: true,
    }), "whatsapp");
    expect(result).toMatchObject({ status: "rejected", reason: { message: "aiConsentRequired" } });
    expect(network).not.toHaveBeenCalled();
    expect((await prisma.whatsAppWorkerState.findUniqueOrThrow({ where: { id } })).spentMicros).toBe(37n);
    expect(await prisma.whatsAppMonth.count({ where: { organizationId: f.org.id } })).toBe(0);
  }, 18_000);

  it("keeps voice withdrawal actionable, releases both unused reserves and retries/replays the same audio once", async () => {
    const f = await fixture();
    const conversation = await createBaamConversation(f.ctx, { locale: "en" });
    const run = () => transcribeBaamAudio(f.ctx, conversation.id, wav(), "audio/wav", "en");
    const result = await revokeDuringBudgetWait(f, f.managerUser.id, run);
    expect(result).toMatchObject({ status: "rejected", reason: { message: "aiConsentRequired" } });
    expect(network).not.toHaveBeenCalled();
    expect(await usage(f, "aiVendorBudgetMinor")).toMatchObject({ used: 0, reserved: 0 });
    expect(await usage(f, "ai")).toMatchObject({ used: 0, reserved: 0 });
    expect(await prisma.baamTranscription.findFirstOrThrow({ where: { conversationId: conversation.id } }))
      .toMatchObject({ status: "FAILED", errorCode: "aiConsentRequired" });
    await consent(f, f.managerUser.id, true);
    network.mockResolvedValue(Response.json({ text: "Synthetic voice request", languages: [{ code: "en" }] }));
    const transcript = await run();
    expect((await run()).id).toBe(transcript.id);
    expect(network).toHaveBeenCalledOnce();
    expect(await usage(f, "ai")).toMatchObject({ used: 1, reserved: 0 });
    expect((await usage(f, "aiVendorBudgetMinor")).used).toBeGreaterThan(0);
  }, 18_000);

  it("releases an image reserve after withdrawal during its real budget wait and returns the consent error", async () => {
    const f = await fixture();
    vi.stubEnv("AI_PROVIDER", "openai"); // Deterministic retouch has no optional DeepSeek analysis.
    const request = await imageRequest(f);
    const result = await revokeDuringBudgetWait(f, f.managerUser.id,
      () => withAiPrivacyIdentity({ userId: f.managerUser.id, organizationId: f.org.id },
        () => callOpenAiImageEnhancement(request)));
    expect(result).toMatchObject({ status: "rejected", reason: { message: "aiConsentRequired" } });
    expect(network).not.toHaveBeenCalled();
    expect(await usage(f, "imageVendorBudgetMinor")).toMatchObject({ used: 0, reserved: 0 });
  }, 18_000);

  it("does not turn an explicit image rate-limit into a new paid attempt after consent withdrawal", async () => {
    const f = await fixture();
    vi.stubEnv("AI_PROVIDER", "openai");
    const request = await imageRequest(f);
    network.mockImplementationOnce(async () => {
      await consent(f, f.managerUser.id, false);
      return Response.json({ error: { type: "rate_limit_error" } }, { status: 429 });
    });
    await expect(withAiPrivacyIdentity({ userId: f.managerUser.id, organizationId: f.org.id },
      () => callOpenAiImageEnhancement(request))).rejects.toThrow("aiConsentRequired");
    expect(network).toHaveBeenCalledOnce();
    expect(await usage(f, "imageVendorBudgetMinor")).toMatchObject({ used: 0, reserved: 0 });
    const attempts = await prisma.subscriptionUsageReservation.findMany({
      where: { organizationId: f.org.id, resource: "imageVendorBudgetMinor" },
    });
    expect(attempts).toHaveLength(2);
    expect(attempts.map((attempt) => attempt.actualUnits)).toEqual([0, 0]);
  });

  it("retains an uncertain dispatched image expense and never buys an automatic transport retry", async () => {
    const f = await fixture();
    vi.stubEnv("AI_PROVIDER", "openai");
    const request = await imageRequest(f);
    network.mockRejectedValue(new Error("Synthetic lost image response"));
    await expect(withAiPrivacyIdentity({ userId: f.managerUser.id, organizationId: f.org.id },
      () => callOpenAiImageEnhancement(request))).rejects.toThrow("productImageStudioProviderFailed");
    expect(network).toHaveBeenCalledOnce();
    expect((await usage(f, "imageVendorBudgetMinor")).used).toBeGreaterThan(0);
    expect((await usage(f, "imageVendorBudgetMinor")).reserved).toBe(0);
  });

  it("retains a dispatched voice expense despite a lost response while releasing the failed customer operation", async () => {
    const f = await fixture();
    const conversation = await createBaamConversation(f.ctx, { locale: "en" });
    network.mockRejectedValue(new Error("Synthetic lost voice response"));
    await expect(transcribeBaamAudio(f.ctx, conversation.id, wav(), "audio/wav", "en"))
      .rejects.toThrow("Synthetic lost voice response");
    expect(network).toHaveBeenCalledOnce();
    expect((await usage(f, "aiVendorBudgetMinor")).used).toBeGreaterThan(0);
    expect(await usage(f, "ai")).toMatchObject({ used: 0, reserved: 0 });
  });
});
