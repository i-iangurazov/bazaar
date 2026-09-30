import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import {
  getCardView,
  getSessionMember,
  issueCardToken,
  requestJoinOtp,
  resolveJoinTarget,
  revokeSession,
  verifyCardToken,
  verifyJoinOtp,
} from "@/server/services/loyalty/memberAuth";
import { upsertLoyaltyProgram } from "@/server/services/loyalty/program";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("loyalty member auth", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  const fixture = async () => {
    const base = await seedBase({ plan: "BUSINESS" });
    const program = await upsertLoyaltyProgram(prisma, base.org.id, {
      enabled: true,
      storeIds: [base.store.id],
    });
    const link = await prisma.loyaltyProgramStore.findFirstOrThrow({
      where: { programId: program.id, storeId: base.store.id },
    });
    return { ...base, program, programStoreId: link.id };
  };

  it("logs a customer in with an emailed one-time code and a separate session", async () => {
    const { programStoreId, org } = await fixture();
    const email = "shopper@example.invalid";
    const requested = await requestJoinOtp({ programStoreId, email });
    expect(requested.delivered).toBe(true);
    expect(requested.code).toMatch(/^\d{6}$/); // returned only in test runtime

    const session = await verifyJoinOtp({ programStoreId, email, code: requested.code! });
    expect(session.token).toHaveLength(64);
    const context = await getSessionMember(session.token);
    expect(context?.member.email).toBe(email);
    expect(context?.program.organizationId).toBe(org.id);
    // No staff session or role is granted to the customer.
    expect(await prisma.user.count({ where: { email } })).toBe(0);

    await revokeSession(session.token);
    expect(await getSessionMember(session.token)).toBeNull();
  });

  it("rejects a reused or wrong code", async () => {
    const { programStoreId } = await fixture();
    const email = "shopper2@example.invalid";
    const requested = await requestJoinOtp({ programStoreId, email });

    await expect(verifyJoinOtp({ programStoreId, email, code: "000000" })).rejects.toMatchObject({
      message: "loyaltyOtpInvalid",
    });
    await verifyJoinOtp({ programStoreId, email, code: requested.code! });
    await expect(
      verifyJoinOtp({ programStoreId, email, code: requested.code! }),
    ).rejects.toMatchObject({ message: "loyaltyOtpExpired" });
  });

  it("issues a short-lived customer QR that the register consumes once", async () => {
    const { programStoreId, org } = await fixture();
    const email = "shopper3@example.invalid";
    const requested = await requestJoinOtp({ programStoreId, email });
    const session = await verifyJoinOtp({ programStoreId, email, code: requested.code! });

    const card = await issueCardToken(session.token);
    const verified = await verifyCardToken(card.token, org.id);
    expect(verified.member.email).toBe(email);
    expect(verified.availablePoints).toBe(0);

    await expect(verifyCardToken(card.token, org.id)).rejects.toMatchObject({
      message: "loyaltyCardUsed",
    });
    // A token from another organization is never accepted.
    const other = await issueCardToken(session.token);
    await expect(verifyCardToken(other.token, "other-org")).rejects.toMatchObject({
      message: "loyaltyCardInvalid",
    });
  });

  it("exposes the join target only while the programme is enabled for that store", async () => {
    const base = await seedBase({ plan: "BUSINESS" });
    const program = await upsertLoyaltyProgram(prisma, base.org.id, { storeIds: [base.store.id] });
    const link = await prisma.loyaltyProgramStore.findFirstOrThrow({
      where: { programId: program.id, storeId: base.store.id },
    });
    const disabled = await resolveJoinTarget(link.id);
    expect(disabled?.enabled).toBe(false);
    await expect(requestJoinOtp({ programStoreId: link.id, email: "x@example.invalid" })).rejects.toMatchObject({
      message: "loyaltyDisabled",
    });
  });

  it("shows the card balance and an empty history without internal ids", async () => {
    const { programStoreId } = await fixture();
    const email = "shopper4@example.invalid";
    const requested = await requestJoinOtp({ programStoreId, email });
    const session = await verifyJoinOtp({ programStoreId, email, code: requested.code! });
    const view = await getCardView(session.token);
    expect(view.balancePoints).toBe(0);
    expect(view.availablePoints).toBe(0);
    expect(view.history).toEqual([]);
    expect(view.rules.memberDiscountPercent).toBe(5);
  });
});
