import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as RuntimeConfig from "@/server/config/runtime";

const log = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock("@/server/logging", () => ({ getLogger: () => log }));
vi.mock("@/server/config/runtime", async (original) => ({
  ...(await original<typeof RuntimeConfig>()),
  assertExternalProviderCallAllowed: vi.fn(),
  isProductionRuntime: () => true,
}));

import { prisma } from "@/server/db/prisma";
import {
  getSessionMember,
  requestJoinOtp,
  verifyJoinOtp,
} from "@/server/services/loyalty/memberAuth";
import { upsertLoyaltyProgram } from "@/server/services/loyalty/program";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { POST as requestOtp } from "@/app/api/loyalty/otp/request/route";
import { POST as verifyOtp } from "@/app/api/loyalty/otp/verify/route";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const post = (body: unknown) =>
  new Request("https://example.invalid/api/loyalty/otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describeDb("loyalty real email delivery branch", () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
    fetch.mockReset();
    // Exercise the deployed branch: the ordinary NODE_ENV=test OTP shortcut is off.
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOYALTY_OTP_DEV_OUTBOX", "0");
    vi.stubEnv("EMAIL_PROVIDER", "resend");
    vi.stubEnv("RESEND_API_KEY", "synthetic-provider-key");
    vi.stubEnv("EMAIL_FROM", "test@example.invalid");
    vi.stubGlobal("fetch", fetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  async function fixture() {
    const f = await seedBase({ plan: "BUSINESS" });
    const program = await upsertLoyaltyProgram(prisma, f.org.id, {
      enabled: true,
      storeIds: [f.store.id],
    });
    const link = await prisma.loyaltyProgramStore.findFirstOrThrow({
      where: { programId: program.id },
    });
    return {
      ...f,
      input: { programStoreId: link.id, email: `shopper-${randomUUID()}@example.invalid` },
    };
  }
  const sentCode = () => {
    const payload = JSON.parse(fetch.mock.calls.at(-1)![1]!.body as string);
    return { payload, code: payload.text.match(/\b\d{6}\b/)![0] as string };
  };

  it("requires provider acceptance, sends the actual code and restores the same card after cookie loss", async () => {
    const f = await fixture();
    fetch.mockImplementation(async (url, init) => {
      expect(String(url)).toBe("https://api.resend.com/emails");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer synthetic-provider-key");
      return json({ id: "synthetic-message" });
    });
    const requested = await requestOtp(post(f.input));
    expect(requested.status).toBe(200);
    expect(await requested.json()).toEqual({ delivered: true, expiresInMinutes: 10 });
    const first = sentCode();
    expect(first.payload.to).toEqual([f.input.email]);
    expect(first.payload.from).toBe("test@example.invalid");
    const challenge = await prisma.loyaltyOtpChallenge.findFirstOrThrow();
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get("Idempotency-Key")).toBe(
      `loyalty-otp-${challenge.id}`,
    );
    expect(challenge.codeHash).not.toBe(first.code);
    const verified = await verifyOtp(post({ ...f.input, code: first.code }));
    expect(verified.status).toBe(200);
    expect(await verified.json()).toEqual({ ok: true });
    const cookie = verified.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    const token = cookie.match(/loyalty_session=([a-f0-9]{64})/)![1];
    const member = await getSessionMember(token);
    const signedIn = { token, memberId: member!.member.id };
    expect(member?.member.email).toBe(f.input.email);
    await prisma.loyaltyAccount.update({
      where: { memberId: signedIn.memberId },
      data: { balancePoints: 37 },
    });
    await requestJoinOtp(f.input);
    const second = await verifyJoinOtp({ ...f.input, code: sentCode().code });
    expect(second.memberId).toBe(signedIn.memberId);
    expect((await getSessionMember(second.token))?.account.balancePoints).toBe(37);
    expect(await prisma.loyaltyMember.count()).toBe(1);
    expect(await prisma.user.count({ where: { email: f.input.email } })).toBe(0);
  });

  it("releases failed-send quota, reports a safe error and permits the next successful send", async () => {
    const f = await fixture();
    fetch.mockImplementation(async () =>
      json(
        {
          name: "validation_error",
          message: "The example.invalid domain is not verified. private recipient and OTP",
        },
        403,
      ),
    );
    for (let index = 0; index < 5; index++) {
      const failed = await requestOtp(post(f.input));
      expect(failed.status).toBe(503);
      expect(await failed.json()).toEqual({ message: "emailDeliveryFailed" });
      expect(await prisma.loyaltyOtpChallenge.count()).toBe(0);
    }
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "sender_domain_not_verified", providerStatus: 403 }),
      expect.any(String),
    );
    expect(JSON.stringify(log.error.mock.calls)).not.toContain(f.input.email);
    expect(JSON.stringify(log.error.mock.calls)).not.toContain("private recipient and OTP");
    fetch.mockResolvedValue(json({ id: "recovered-message" }));
    expect(await requestJoinOtp(f.input)).toMatchObject({ delivered: true });
    await verifyJoinOtp({ ...f.input, code: sentCode().code });
    // Request protection still applies even though delivery failures no longer consume the ten-minute quota.
    await expect(requestJoinOtp(f.input)).rejects.toMatchObject({
      message: "loyaltyOtpRateLimited",
      status: 429,
    });
  });

  it("keeps an earlier delivered code usable after a subsequent send fails", async () => {
    const f = await fixture();
    fetch.mockResolvedValueOnce(json({ id: "first-message" }));
    await requestJoinOtp(f.input);
    const firstCode = sentCode().code;
    fetch.mockResolvedValue(json({ message: "API key is suspended" }, 403));
    await expect(requestJoinOtp(f.input)).rejects.toMatchObject({ status: 503 });
    const failedCode = sentCode().code;
    expect(await prisma.loyaltyOtpChallenge.count()).toBe(1);
    if (failedCode !== firstCode) {
      await expect(verifyJoinOtp({ ...f.input, code: failedCode })).rejects.toMatchObject({
        message: "loyaltyOtpInvalid",
      });
    }
    expect(await verifyJoinOtp({ ...f.input, code: firstCode })).toHaveProperty("token");
  });

  it("does not authenticate a pending code before the provider accepts delivery", async () => {
    const f = await fixture();
    let accept!: (response: Response) => void;
    fetch.mockReturnValue(
      new Promise<Response>((resolve) => {
        accept = resolve;
      }),
    );
    const sending = requestJoinOtp(f.input);
    const settled = sending.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const code = sentCode().code;
    await expect(verifyJoinOtp({ ...f.input, code })).rejects.toMatchObject({
      message: "loyaltyOtpExpired",
    });
    accept(json({ id: "accepted-pending" }));
    expect(await settled).toHaveProperty("value.delivered", true);
    expect(await verifyJoinOtp({ ...f.input, code })).toHaveProperty("token");
  });

  it("does not claim delivery when only a log sink is configured", async () => {
    const f = await fixture();
    vi.stubEnv("EMAIL_PROVIDER", "log");
    await expect(requestJoinOtp(f.input)).rejects.toMatchObject({
      message: "emailDeliveryFailed",
      status: 503,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(await prisma.loyaltyOtpChallenge.count()).toBe(0);
  });
});
