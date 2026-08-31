import { createHash } from "node:crypto";

import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import type { Locator } from "@playwright/test";

import {
  cleanupAuthenticatedEmployeeInvitationFixtures,
  prepareAuthenticatedEmployeeInvitationFixtures,
} from "../../../scripts/playwright-authenticated-employee-invitation-fixture";
import { assertAuthenticatedE2EDatabaseUrl } from "./contract";
import { authenticatedEmployeeInvitationFixture } from "./employee-invitation-contract";
import {
  assertCleanEmployeeInvitationAudit,
  attachEmployeeInvitationAuditOnFailure,
  employeeInvitationMutationCount,
  expectInvalidEmployeeInviteDetails,
  expect,
  test,
  type EmployeeInvitationAudit,
  type EmployeeInvitationMutationProcedure,
} from "./employee-invitation-test-fixtures";

const fixture = authenticatedEmployeeInvitationFixture;
const datasourceUrl = assertAuthenticatedE2EDatabaseUrl(process.env.E2E_AUTH_DATABASE_URL);
const prisma = new PrismaClient({ datasourceUrl });
const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");

test.describe.configure({ mode: "serial" });

const rapidClick = async (locator: Locator) => {
  await expect(locator).toBeVisible();
  await expect(locator).toBeEnabled();
  await locator.evaluate((node) => {
    const button = node as HTMLButtonElement;
    button.click();
    button.click();
  });
};

const assertMutationCount = async (
  audit: EmployeeInvitationAudit,
  procedure: EmployeeInvitationMutationProcedure,
  expectedCount: number,
) => {
  await expect.poll(() => employeeInvitationMutationCount(audit, procedure)).toBe(expectedCount);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(employeeInvitationMutationCount(audit, procedure)).toBe(expectedCount);
};

let prepared = false;

test.beforeAll(async () => {
  await prepareAuthenticatedEmployeeInvitationFixtures(prisma);
  prepared = true;
});

test.afterEach(async ({ employeeInvitationAudit }, testInfo) => {
  await attachEmployeeInvitationAuditOnFailure(testInfo, employeeInvitationAudit);
});

test.afterAll(async () => {
  try {
    if (prepared) await cleanupAuthenticatedEmployeeInvitationFixtures(prisma);
  } finally {
    await prisma.$disconnect();
  }
});

test("BZR-REQ-0188/0116/0117 admin creates one scoped invite and the employee accepts, signs in, and remains role-bound", async ({
  page: adminPage,
  signedOutEmployeePage: page,
  employeeInvitationAudit,
}) => {
  await adminPage.goto("/settings/users", { waitUntil: "domcontentloaded" });
  await expect(adminPage.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
  await expect(adminPage.getByRole("heading", { name: "Invites" })).toBeVisible();

  const emailInput = adminPage.getByLabel("Email", { exact: true });
  const createInvite = adminPage.getByRole("button", { name: "Create invite", exact: true });
  await createInvite.click();
  await expect(adminPage.getByText("Enter a valid email.", { exact: true })).toBeVisible();
  await expect(emailInput).toHaveAttribute("aria-invalid", "true");
  expect(employeeInvitationMutationCount(employeeInvitationAudit, "invites.create")).toBe(0);

  await emailInput.fill("malformed-address");
  await createInvite.click();
  await expect(adminPage.getByText("Enter a valid email.", { exact: true })).toBeVisible();
  expect(employeeInvitationMutationCount(employeeInvitationAudit, "invites.create")).toBe(0);

  await emailInput.fill(fixture.invitedUser.email);
  await adminPage.getByLabel("Role", { exact: true }).click();
  await adminPage.getByRole("option", { name: "Manager", exact: true }).click();
  await adminPage.getByLabel(fixture.assignedStoreLabel, { exact: true }).check();
  await rapidClick(createInvite);
  await assertMutationCount(employeeInvitationAudit, "invites.create", 1);
  await expect(adminPage.getByText("Invite created.", { exact: true })).toBeVisible();

  const inviteLinkText = (
    await adminPage.locator("code").filter({ hasText: "/invite/" }).last().textContent()
  )?.trim();
  if (!inviteLinkText) throw new Error("The Users UI did not expose the newly created QA invite.");
  const inviteToken = inviteLinkText.slice(inviteLinkText.lastIndexOf("/") + 1);
  const inviteTokenHash = hashToken(inviteToken);

  const [creator, pendingInvites, invitedBeforeAcceptance] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { email: fixture.creatorEmail },
      select: { id: true },
    }),
    prisma.inviteToken.findMany({
      where: { email: fixture.invitedUser.email },
      select: {
        id: true,
        organizationId: true,
        email: true,
        role: true,
        storeIds: true,
        tokenHash: true,
        expiresAt: true,
        acceptedAt: true,
        createdById: true,
      },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: fixture.invitedUser.id },
      select: { organizationId: true, role: true },
    }),
  ]);
  expect(pendingInvites).toHaveLength(1);
  const pendingInvite = pendingInvites[0]!;
  expect(pendingInvite).toMatchObject({
    organizationId: fixture.organizationId,
    email: fixture.invitedUser.email,
    role: fixture.invitedUser.assignedRole,
    storeIds: [fixture.assignedStoreId],
    tokenHash: inviteTokenHash,
    acceptedAt: null,
    createdById: creator.id,
  });
  expect(pendingInvite.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1_000);
  expect(pendingInvite.expiresAt.getTime()).toBeLessThan(Date.now() + 8 * 24 * 60 * 60 * 1_000);
  expect(invitedBeforeAcceptance).toEqual({
    organizationId: null,
    role: fixture.invitedUser.initialRole,
  });

  const createAudits = await prisma.auditLog.findMany({
    where: { entity: "InviteToken", entityId: pendingInvite.id },
    orderBy: { createdAt: "asc" },
  });
  expect(createAudits).toHaveLength(1);
  expect(createAudits[0]).toMatchObject({
    organizationId: fixture.organizationId,
    actorId: creator.id,
    action: "INVITE_CREATE",
    before: null,
    after: expect.objectContaining({
      email: fixture.invitedUser.email,
      role: fixture.invitedUser.assignedRole,
      storeIds: [fixture.assignedStoreId],
    }),
  });
  expect(JSON.stringify(createAudits)).not.toContain(inviteToken);
  expect(JSON.stringify(createAudits)).not.toContain(fixture.invitedUser.password);

  await page.goto(`/invite/${encodeURIComponent(inviteToken)}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { level: 1, name: "Accept invite" })).toBeVisible();
  await expect(
    page.getByText(`Role: ${fixture.invitedUser.assignedRole}`, { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Accept invite", exact: true }).click();
  await expect(page.getByText("Name is required.", { exact: true })).toBeVisible();
  await expect(page.getByText("At least 8 characters.", { exact: true })).toBeVisible();
  expect(employeeInvitationMutationCount(employeeInvitationAudit, "publicAuth.acceptInvite")).toBe(
    0,
  );

  await page.getByLabel("Name", { exact: true }).fill(fixture.invitedUser.name);
  await page.getByLabel("Password", { exact: true }).fill(fixture.invitedUser.password);
  await page.getByRole("combobox", { name: "Language", exact: true }).click();
  await page.getByRole("option", { name: "EN", exact: true }).click();
  await rapidClick(page.getByRole("button", { name: "Accept invite", exact: true }));
  await assertMutationCount(employeeInvitationAudit, "publicAuth.acceptInvite", 1);
  expect(employeeInvitationAudit.allowedLocaleWrites).toBe(1);
  await expect(page.getByRole("heading", { level: 1, name: "Welcome!" })).toBeVisible();

  const [acceptedUser, acceptedInvite, accessRows, authTokens, invitationAudits] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: fixture.invitedUser.id },
        select: {
          organizationId: true,
          email: true,
          name: true,
          passwordHash: true,
          role: true,
          preferredLocale: true,
          emailVerifiedAt: true,
          isActive: true,
        },
      }),
      prisma.inviteToken.findUniqueOrThrow({
        where: { id: pendingInvite.id },
        select: { acceptedAt: true },
      }),
      prisma.userStoreAccess.findMany({
        where: { userId: fixture.invitedUser.id },
        select: { organizationId: true, storeId: true },
      }),
      prisma.authToken.findMany({
        where: { userId: fixture.invitedUser.id },
        select: { id: true },
      }),
      prisma.auditLog.findMany({
        where: { entity: "InviteToken", entityId: pendingInvite.id },
        orderBy: { createdAt: "asc" },
      }),
    ]);
  expect(acceptedUser).toMatchObject({
    organizationId: fixture.organizationId,
    email: fixture.invitedUser.email,
    name: fixture.invitedUser.name,
    role: fixture.invitedUser.assignedRole,
    preferredLocale: fixture.invitedUser.preferredLocale,
    emailVerifiedAt: expect.any(Date),
    isActive: true,
  });
  expect(await bcrypt.compare(fixture.invitedUser.password, acceptedUser.passwordHash)).toBe(true);
  expect(acceptedInvite.acceptedAt).toBeInstanceOf(Date);
  expect(accessRows).toEqual([
    { organizationId: fixture.organizationId, storeId: fixture.assignedStoreId },
  ]);
  expect(authTokens).toEqual([]);
  expect(invitationAudits.map((audit) => audit.action)).toEqual(["INVITE_CREATE", "INVITE_ACCEPT"]);
  expect(JSON.stringify(invitationAudits)).not.toContain(inviteToken);
  expect(JSON.stringify(invitationAudits)).not.toContain(fixture.invitedUser.password);

  await expectInvalidEmployeeInviteDetails({
    page,
    audit: employeeInvitationAudit,
    action: async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(
        page.getByText("The invite is invalid or expired.", { exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0);
    },
  });

  await expectInvalidEmployeeInviteDetails({
    page,
    audit: employeeInvitationAudit,
    action: async () => {
      await page.goto(`/invite/${encodeURIComponent(fixture.expiredInvite.rawToken)}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.getByText("The invite is invalid or expired.", { exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
    },
  });

  await expectInvalidEmployeeInviteDetails({
    page,
    audit: employeeInvitationAudit,
    action: async () => {
      await page.goto(`/invite/${encodeURIComponent(fixture.malformedToken)}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.getByText("The invite is invalid or expired.", { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Accept invite", exact: true })).toHaveCount(0);
    },
  });
  expect(employeeInvitationMutationCount(employeeInvitationAudit, "publicAuth.acceptInvite")).toBe(
    1,
  );

  await page.goto("/login?next=/dashboard", { waitUntil: "commit" });
  const invitedEmailInput = page.getByLabel("Email", { exact: true });
  const invitedPasswordInput = page.getByLabel("Password", { exact: true });
  await invitedEmailInput.fill(fixture.invitedUser.email);
  await invitedPasswordInput.fill(fixture.invitedUser.password);
  await expect(page.locator("form[data-login-form]")).toHaveAttribute("data-hydrated", "true");
  await page.getByRole("button", { name: "Show password", exact: true }).press("Enter");
  await expect(invitedPasswordInput).toHaveAttribute("type", "text");
  await expect(invitedEmailInput).toHaveValue(fixture.invitedUser.email);
  await expect(invitedPasswordInput).toHaveValue(fixture.invitedUser.password);
  await page.getByRole("button", { name: "Hide password", exact: true }).press("Enter");
  await expect(invitedPasswordInput).toHaveAttribute("type", "password");
  await expect(invitedEmailInput).toHaveValue(fixture.invitedUser.email);
  await expect(invitedPasswordInput).toHaveValue(fixture.invitedUser.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  expect(employeeInvitationAudit.allowedCredentialCallbacks).toBe(1);
  const dashboardReload = await page.reload({ waitUntil: "domcontentloaded" });
  expect(dashboardReload).not.toBeNull();
  expect(dashboardReload!.status()).toBeLessThan(500);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();

  const session = await page.evaluate(async () => {
    const response = await fetch("/api/auth/session", { credentials: "same-origin" });
    return response.json() as Promise<{
      user?: { email?: string; role?: string; organizationId?: string; emailVerified?: boolean };
    }>;
  });
  expect(session.user).toMatchObject({
    email: fixture.invitedUser.email,
    role: fixture.invitedUser.assignedRole,
    organizationId: fixture.organizationId,
    emailVerified: true,
  });

  const storesResponse = await page.evaluate(async () => {
    const input = encodeURIComponent(JSON.stringify({ 0: { json: null } }));
    const response = await fetch(`/api/trpc/stores.list?batch=1&input=${input}`, {
      credentials: "same-origin",
    });
    return { status: response.status, text: await response.text() };
  });
  expect(storesResponse.status).toBe(200);
  expect(storesResponse.text).toContain(fixture.assignedStoreId);
  expect(storesResponse.text).not.toContain(fixture.deniedStoreId);

  await page.goto("/settings/users", { waitUntil: "domcontentloaded" });
  await expect.poll(() => new URL(page.url()).pathname).toBe("/dashboard");
  expect(new URL(page.url()).searchParams.get("from")).toBe("/settings/users");
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Users" })).toHaveCount(0);

  await assertMutationCount(employeeInvitationAudit, "invites.create", 1);
  await assertMutationCount(employeeInvitationAudit, "publicAuth.acceptInvite", 1);
  assertCleanEmployeeInvitationAudit(employeeInvitationAudit);
});
