import { randomUUID } from "node:crypto";
import type { CredentialsConfig } from "next-auth/providers/credentials";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { hardeningPreviewEnv } from "../helpers/hardeningPreviewEnv";

const describeDb = shouldRunDbTests ? describe : describe.skip;
describeDb("complete newcomer signup in the owned isolated Preview boundary", () => {
  beforeEach(async () => { await resetDatabase(); vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("persists full business fields and trial7 then authenticates without mail or new payment access", async () => {
    const protectedFixture = await seedBase({ plan: "BUSINESS" });
    const beforeProtected = await prisma.organization.findUniqueOrThrow({ where: { id: protectedFixture.org.id } });
    const databaseUrl = process.env.DATABASE_TEST_URL ?? process.env.DATABASE_URL!;
    for (const [key, value] of Object.entries(hardeningPreviewEnv(databaseUrl))) vi.stubEnv(key, value);
    const network = vi.fn(() => { throw new Error("No external provider in isolated signup tests"); }); vi.stubGlobal("fetch", network);
    const email = await import("@/server/services/email"), send = vi.spyOn(email, "sendVerificationEmail");
    const { createTestCaller } = await import("../helpers/context"), caller = createTestCaller();
    const address = `synthetic-signup-${randomUUID()}@example.invalid`, password = "Synthetic-signup-only123!";
    const started = Date.now();
    expect(await caller.publicAuth.signupMode()).toMatchObject({ mode: "open", trialDays: 7, trialPreviewEnabled: true });
    const signup = await caller.publicAuth.signup({ email: address, password, name: "Synthetic newcomer", preferredLocale: "kg" });
    expect(signup.nextPath).toMatch(/^\/register-business\//);
    const token = signup.nextPath!.split("/").at(-1)!;
    const registered = await caller.publicAuth.registerBusiness({ token, orgName: " New synthetic company ", storeName: " New test store ", storeCode: "test shop",
      legalEntityType: "IP", legalName: " Synthetic entrepreneur ", inn: "12345678901234", address: " Synthetic address ", phone: " +996555010200 " });
    expect(registered).toMatchObject({ requiresEmailVerification: false, verificationEmailSent: true });
    expect(registered).not.toHaveProperty("verifyLink"); expect(send).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
    const user = await prisma.user.findUniqueOrThrow({ where: { email: address } });
    expect(user).toMatchObject({ organizationId: registered.organizationId, role: "ADMIN", isActive: true, isOrgOwner: true, preferredLocale: "kg" });
    expect(user.emailVerifiedAt).not.toBeNull();
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: registered.organizationId }, include: { subscriptionContract: true } });
    expect(org).toMatchObject({ name: "New synthetic company", plan: "STARTER", subscriptionBillingMode: "SELF_SERVE", subscriptionStatus: "ACTIVE" });
    expect(org.currentPeriodEndsAt).toEqual(org.trialEndsAt);
    expect(org.trialEndsAt!.getTime()).toBeGreaterThanOrEqual(started + 7 * 86400000);
    expect(org.trialEndsAt!.getTime()).toBeLessThanOrEqual(Date.now() + 7 * 86400000);
    expect(org.subscriptionContract).toMatchObject({ catalogVersion: "2026-11", lifetimeAccess: false });
    expect(org.subscriptionContract?.trialOffer).not.toBeNull();
    expect(await prisma.store.findUniqueOrThrow({ where: { id: registered.storeId } })).toMatchObject({ organizationId: org.id, name: "New test store", code: "TEST-SHOP",
      legalEntityType: "IP", legalName: "Synthetic entrepreneur", inn: "12345678901234", address: "Synthetic address", phone: "+996555010200" });
    expect(await prisma.unit.count({ where: { organizationId: org.id } })).toBe(4);
    expect(await prisma.authToken.count({ where: { userId: user.id, type: "EMAIL_VERIFY" } })).toBe(0);
    const { authOptions } = await import("@/server/auth/nextauth");
    const authorized = await (authOptions.providers[0] as CredentialsConfig).options.authorize!({ email: address, password }, { headers: { "x-real-ip": "198.51.100.241" } });
    expect(authorized).toMatchObject({ id: user.id, organizationId: org.id, role: "ADMIN" });
    expect(await prisma.subscriptionInvoice.count({ where: { organizationId: org.id } })).toBe(0);
    expect(await prisma.subscriptionPeriod.count({ where: { organizationId: org.id } })).toBe(0);
    expect(await prisma.applePurchaseIntent.count({ where: { organizationId: org.id } })).toBe(0);
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: protectedFixture.org.id } })).toEqual(beforeProtected);
    expect(network).not.toHaveBeenCalled();
  });
});
