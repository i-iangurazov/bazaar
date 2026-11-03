import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/server/services/email", () => ({ sendVerificationEmail: vi.fn() }));
vi.mock("@/server/config/startupChecks", () => ({ assertStartupConfigured: vi.fn() }));
import { prisma } from "@/server/db/prisma";
import { createSignup, requestAccess, registerBusinessFromToken } from "@/server/services/signup";
import { acquisitionFromSearch } from "@/lib/acquisition";
import { publicAuthRouter } from "@/server/trpc/routers/publicAuth";
import { createContext } from "@/server/trpc/trpc";

const prefix = `ig-test-${randomUUID()}`;
const attribution = acquisitionFromSearch(
  new URLSearchParams(
    "utm_source=instagram&utm_medium=organic_social&utm_campaign=kg_store_launch_202611&utm_content=r01_ru",
  ),
)!;
const organizations: string[] = [];
beforeAll(async () => {
  if (process.env.DATABASE_URL !== "postgresql://bazaar_test@127.0.0.1:55443/bazaar_hardening_ci")
    throw new Error("Dedicated temporary database required");
  const [identity] = await prisma.$queryRaw<
    { db: string; username: string }[]
  >`SELECT current_database() AS db, current_user AS username`;
  expect(identity).toEqual({ db: "bazaar_hardening_ci", username: "bazaar_test" });
});
afterAll(async () => {
  await prisma.accessRequest.deleteMany({ where: { email: { startsWith: prefix } } });
  const users = await prisma.user.findMany({
    where: { email: { startsWith: prefix } },
    select: { id: true },
  });
  await prisma.authToken.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: organizations } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
  await prisma.store.deleteMany({ where: { organizationId: { in: organizations } } });
  await prisma.unit.deleteMany({ where: { organizationId: { in: organizations } } });
  await prisma.organization.deleteMany({ where: { id: { in: organizations } } });
  await prisma.$disconnect();
});
describe("persisted signup source in isolated database", () => {
  it("persists a request once and does not overwrite first source on retry", async () => {
    const email = `${prefix}-lead@example.invalid`;
    const first = await requestAccess({ email, orgName: "Synthetic test store", attribution });
    const retry = await requestAccess({
      email,
      attribution: { ...attribution, utm_content: "other" },
    });
    expect(retry.id).toBe(first.id);
    expect(retry.signupAttribution).toEqual(attribution);
    expect(await prisma.accessRequest.count({ where: { email } })).toBe(1);
  });
  it.each(["ru", "kg", "en"])(
    "retains %s signup attribution through business creation and resumption",
    async (locale) => {
      const input = {
        email: `${prefix}-${locale}@example.invalid`,
        password: "Synthetic-password-123",
        name: "Synthetic user",
        preferredLocale: locale,
        requestId: randomUUID(),
        attribution,
      };
      const signup = await createSignup(input);
      expect(signup.nextPath).toMatch(/^\/register-business\//);
      const resumed = await createSignup({
        ...input,
        attribution: { ...attribution, utm_content: "later" },
      });
      const user = await prisma.user.findUniqueOrThrow({ where: { email: input.email } });
      expect(user.signupAttribution).toEqual(attribution);
      expect(user.organizationId).toBeNull();
      const registered = await registerBusinessFromToken({
        token: resumed.nextPath!.split("/").at(-1)!,
        orgName: "Synthetic IG store",
        storeName: "Test store",
        storeCode: `IG-${locale}`,
        requestId: randomUUID(),
      });
      organizations.push(registered.organizationId);
      const persisted = await prisma.user.findUniqueOrThrow({ where: { id: registered.userId } });
      expect(persisted.signupAttribution).toEqual(attribution);
      expect(persisted.isOrgOwner).toBe(true);
      expect(
        await prisma.store.count({ where: { organizationId: registered.organizationId } }),
      ).toBe(1);
      const organization = await prisma.organization.findUniqueOrThrow({
        where: { id: registered.organizationId },
      });
      expect(organization.plan).toBe("STARTER");
      await expect(createSignup(input)).rejects.toThrow("accountAlreadyExists");
    },
  );
  it("keeps untagged requests unattributed", async () => {
    const request = await requestAccess({ email: `${prefix}-direct@example.invalid` });
    expect(request.signupAttribution).toBeNull();
  });
  it("reads cookie server-side, respects GPC and returns only a lead acknowledgement", async () => {
    for (const optedOut of [false, true]) {
      const cookie = `bazaar_acquisition=${encodeURIComponent(JSON.stringify(attribution))}`;
      const req = new Request("http://localhost:3120/api/trpc", {
        headers: { cookie, ...(optedOut ? { "sec-gpc": "1" } : {}) },
      });
      const ctx = await createContext({ req, resHeaders: new Headers(), info: {} } as Parameters<
        typeof createContext
      >[0]);
      const caller = publicAuthRouter.createCaller(ctx);
      const email = `${prefix}-router-${optedOut}@example.invalid`;
      expect(await caller.requestAccess({ email })).toEqual({ sent: true });
      const saved = await prisma.accessRequest.findFirstOrThrow({ where: { email } });
      expect(saved.signupAttribution).toEqual(optedOut ? null : attribution);
    }
  });
});
