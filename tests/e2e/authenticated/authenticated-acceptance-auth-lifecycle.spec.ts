import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import type { Locator, Page } from "@playwright/test";

import { authenticatedAuthLifecycleFixture } from "./auth-lifecycle-contract";
import {
  assertCleanAuthLifecycleAudit,
  attachAuthLifecycleAuditOnFailure,
  expect,
  expectAuthLifecycleHttpError,
  mutationRequestCount,
  test,
  type AuthLifecycleAudit,
  type AuthLifecycleMutationProcedure,
} from "./auth-lifecycle-test-fixtures";
import {
  assertAuthenticatedE2EBaseUrl,
  assertAuthenticatedE2EDatabaseUrl,
  authenticatedE2ESeedPrefix,
} from "./contract";

const fixture = authenticatedAuthLifecycleFixture;
const prisma = new PrismaClient({
  datasourceUrl: assertAuthenticatedE2EDatabaseUrl(process.env.E2E_AUTH_DATABASE_URL),
});

test.describe.configure({ mode: "serial" });

const prepareSignedOutEnglishPage = async (page: Page, baseURL: string | undefined) => {
  const origin = assertAuthenticatedE2EBaseUrl(baseURL);
  await page.context().clearCookies();
  await page
    .context()
    .addCookies([
      { name: "NEXT_LOCALE", value: "en", url: origin, httpOnly: true, sameSite: "Lax" },
    ]);
};

const rapidClick = async (locator: Locator) => {
  await expect(locator).toBeVisible();
  await expect(locator).toBeEnabled();
  await locator.evaluate((node) => {
    const button = node as HTMLButtonElement;
    button.click();
    button.click();
  });
};

const assertSingleMutation = async (
  audit: AuthLifecycleAudit,
  procedure: AuthLifecycleMutationProcedure,
) => {
  await assertMutationCount(audit, procedure, 1);
};

const assertMutationCount = async (
  audit: AuthLifecycleAudit,
  procedure: AuthLifecycleMutationProcedure,
  expectedCount: number,
) => {
  await expect.poll(() => mutationRequestCount(audit, procedure)).toBe(expectedCount);
  await new Promise((resolve) => setTimeout(resolve, 250));
  expect(
    mutationRequestCount(audit, procedure),
    `${procedure} must run exactly ${expectedCount} time(s)`,
  ).toBe(expectedCount);
};

test.afterEach(async ({ authLifecycleAudit }, testInfo) => {
  await attachAuthLifecycleAuditOnFailure(testInfo, authLifecycleAudit);
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("valid password-reset token validates, mutates once, and becomes non-actionable", async ({
  baseURL,
  page,
  authLifecycleAudit,
}) => {
  await prepareSignedOutEnglishPage(page, baseURL);
  await page.goto(`/reset/${fixture.reset.rawToken}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "New password" })).toBeVisible();

  const password = page.getByLabel("New password", { exact: true });
  await password.fill("short");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("At least 8 characters.", { exact: true })).toBeVisible();
  expect(mutationRequestCount(authLifecycleAudit, "publicAuth.resetPassword")).toBe(0);

  await password.fill(fixture.reset.nextPassword);
  await rapidClick(page.getByRole("button", { name: "Save", exact: true }));
  await assertSingleMutation(authLifecycleAudit, "publicAuth.resetPassword");
  await expect(
    page.getByRole("status").getByText("Password updated.", { exact: true }),
  ).toBeVisible();

  const [user, token] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: fixture.reset.userId },
      select: { passwordHash: true },
    }),
    prisma.authToken.findUniqueOrThrow({
      where: { id: fixture.reset.tokenId },
      select: { usedAt: true },
    }),
  ]);
  expect(await bcrypt.compare(fixture.reset.nextPassword, user.passwordHash)).toBe(true);
  expect(token.usedAt).toBeInstanceOf(Date);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { level: 1, name: "Reset link unavailable" }),
  ).toBeVisible();
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
  assertCleanAuthLifecycleAudit(authLifecycleAudit);
});

test("valid email-verification token commits once and exposes only the safe next action", async ({
  baseURL,
  page,
  authLifecycleAudit,
}) => {
  await prepareSignedOutEnglishPage(page, baseURL);
  await page.goto(`/verify/${fixture.verify.rawToken}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "Email confirmation" })).toBeVisible();
  await expect(page.getByText("Email confirmed. You can sign in.", { exact: true })).toBeVisible();
  await assertSingleMutation(authLifecycleAudit, "publicAuth.verifyEmail");
  await expect(page.getByRole("button", { name: "Go to sign in", exact: true })).toBeVisible();

  const [user, token] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: fixture.verify.userId },
      select: { emailVerifiedAt: true },
    }),
    prisma.authToken.findUniqueOrThrow({
      where: { id: fixture.verify.tokenId },
      select: { usedAt: true },
    }),
  ]);
  expect(user.emailVerifiedAt).toBeInstanceOf(Date);
  expect(token.usedAt).toBeInstanceOf(Date);
  await expect(page.locator("body")).not.toContainText(fixture.verify.rawToken);
  assertCleanAuthLifecycleAudit(authLifecycleAudit);
});

test("valid invite validates, de-duplicates acceptance, assigns role/store, and consumes once", async ({
  baseURL,
  page,
  authLifecycleAudit,
}) => {
  await prepareSignedOutEnglishPage(page, baseURL);
  await page.goto(`/invite/${fixture.invite.rawToken}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "Accept invite" })).toBeVisible();
  await expect(page.getByText(`Role: ${fixture.invite.role}`, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Accept invite", exact: true }).click();
  await expect(page.getByText("Name is required.", { exact: true })).toBeVisible();
  await expect(page.getByText("At least 8 characters.", { exact: true })).toBeVisible();
  expect(mutationRequestCount(authLifecycleAudit, "publicAuth.acceptInvite")).toBe(0);

  await page.getByLabel("Name", { exact: true }).fill(fixture.invite.acceptedName);
  await page.getByLabel("Password", { exact: true }).fill(fixture.invite.password);
  await rapidClick(page.getByRole("button", { name: "Accept invite", exact: true }));
  await assertSingleMutation(authLifecycleAudit, "publicAuth.acceptInvite");
  await expect(page.getByRole("heading", { level: 1, name: "Welcome!" })).toBeVisible();
  expect(authLifecycleAudit.allowedLocaleWrites).toHaveLength(1);

  const [user, invite, storeAccess, verificationTokens] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: fixture.invite.userId },
      select: {
        organizationId: true,
        email: true,
        name: true,
        role: true,
        preferredLocale: true,
      },
    }),
    prisma.inviteToken.findUniqueOrThrow({
      where: { id: fixture.invite.inviteId },
      select: { acceptedAt: true },
    }),
    prisma.userStoreAccess.findMany({
      where: { userId: fixture.invite.userId },
      select: { organizationId: true, storeId: true },
    }),
    prisma.authToken.findMany({
      where: { userId: fixture.invite.userId, type: "EMAIL_VERIFY" },
      select: { id: true, usedAt: true },
    }),
  ]);
  expect(user).toEqual({
    organizationId: fixture.organizationId,
    email: fixture.invite.email,
    name: fixture.invite.seededName,
    role: fixture.invite.role,
    preferredLocale: "ru",
  });
  expect(invite.acceptedAt).toBeInstanceOf(Date);
  expect(storeAccess).toEqual([
    { organizationId: fixture.organizationId, storeId: fixture.storeId },
  ]);
  expect(verificationTokens).toEqual([{ id: expect.any(String), usedAt: null }]);
  await expect(page.locator("body")).not.toContainText(fixture.invite.rawToken);
  await expect(page.locator("body")).not.toContainText(authenticatedE2ESeedPrefix + "-secret");
  assertCleanAuthLifecycleAudit(authLifecycleAudit);
});

test("open signup and business registration validate, recover, commit once, and require verification", async ({
  baseURL,
  page,
  authLifecycleAudit,
}) => {
  await prepareSignedOutEnglishPage(page, baseURL);
  const signup = fixture.signup;
  await page.goto("/signup", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "Sign up" })).toBeVisible();

  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByText("Name is required.", { exact: true })).toBeVisible();
  await expect(page.getByText("Enter a valid email.", { exact: true })).toBeVisible();
  await expect(page.getByText("At least 8 characters.", { exact: true })).toBeVisible();
  expect(mutationRequestCount(authLifecycleAudit, "publicAuth.signup")).toBe(0);

  await page.getByLabel("Name", { exact: true }).fill(signup.name);
  await page.getByLabel("Email", { exact: true }).fill(signup.email);
  await page.getByLabel("Password", { exact: true }).fill(signup.password);
  await page.getByRole("combobox", { name: "Language", exact: true }).click();
  await page.getByRole("option", { name: "EN", exact: true }).click();
  await rapidClick(page.getByRole("button", { name: "Create account", exact: true }));
  await assertSingleMutation(authLifecycleAudit, "publicAuth.signup");
  await expect(
    page.getByRole("heading", { level: 1, name: "Business registration" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/register-business\/[A-Za-z0-9_-]{10,}$/);

  const userAfterSignup = await prisma.user.findUniqueOrThrow({
    where: { email: signup.email },
    select: {
      id: true,
      organizationId: true,
      name: true,
      passwordHash: true,
      preferredLocale: true,
      emailVerifiedAt: true,
    },
  });
  expect(userAfterSignup).toMatchObject({
    organizationId: null,
    name: signup.name,
    preferredLocale: "en",
    emailVerifiedAt: null,
  });
  expect(await bcrypt.compare(signup.password, userAfterSignup.passwordHash)).toBe(true);
  const registrationToken = await prisma.authToken.findFirstOrThrow({
    where: { userId: userAfterSignup.id, type: "REGISTRATION" },
    select: { id: true, usedAt: true },
  });
  expect(registrationToken.usedAt).toBeNull();

  await page.getByRole("button", { name: "Create business", exact: true }).click();
  await expect(page.getByText("Organization name is required.", { exact: true })).toBeVisible();
  await expect(page.getByText("Store name is required.", { exact: true })).toBeVisible();
  await expect(page.getByText("Store code is required.", { exact: true })).toBeVisible();
  expect(mutationRequestCount(authLifecycleAudit, "publicAuth.registerBusiness")).toBe(0);

  await page.getByLabel("Organization", { exact: true }).fill(`  ${signup.organizationName}  `);
  await page.getByLabel("First store", { exact: true }).fill(`  ${signup.storeName}  `);
  await page.getByLabel("Store code", { exact: true }).fill(signup.invalidStoreCode);
  await page.getByLabel("TIN", { exact: true }).fill(signup.inn);
  await page.getByLabel("Phone", { exact: true }).fill(signup.phone);
  await expectAuthLifecycleHttpError({
    page,
    audit: authLifecycleAudit,
    procedure: "publicAuth.registerBusiness",
    status: 400,
    action: () => page.getByRole("button", { name: "Create business", exact: true }).click(),
  });
  await assertMutationCount(authLifecycleAudit, "publicAuth.registerBusiness", 1);
  await expect(page.getByText("Invalid store code", { exact: true }).first()).toBeVisible();
  expect(authLifecycleAudit.acknowledgedHttpErrors).toEqual([
    {
      procedure: "publicAuth.registerBusiness",
      status: 400,
      statusText: "Bad Request",
    },
  ]);
  await expect(
    prisma.authToken.findUniqueOrThrow({ where: { id: registrationToken.id } }),
  ).resolves.toMatchObject({ usedAt: null });
  await expect(
    prisma.user.findUniqueOrThrow({ where: { id: userAfterSignup.id } }),
  ).resolves.toMatchObject({ organizationId: null });
  await expect(
    prisma.organization.count({ where: { name: signup.organizationName } }),
  ).resolves.toBe(0);

  await page.getByLabel("Store code", { exact: true }).fill(signup.storeCodeInput);
  await rapidClick(page.getByRole("button", { name: "Create business", exact: true }));
  await assertMutationCount(authLifecycleAudit, "publicAuth.registerBusiness", 2);
  await expect(
    page.getByText("Business created. Confirm your email from the link, then sign in.", {
      exact: true,
    }),
  ).toBeVisible();

  const completedUser = await prisma.user.findUniqueOrThrow({
    where: { id: userAfterSignup.id },
    select: {
      organizationId: true,
      isOrgOwner: true,
      role: true,
      emailVerifiedAt: true,
    },
  });
  expect(completedUser).toMatchObject({
    organizationId: expect.any(String),
    isOrgOwner: true,
    role: "ADMIN",
    emailVerifiedAt: null,
  });
  const organizationId = completedUser.organizationId as string;
  const [organization, stores, authTokens, auditActions] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true, plan: true, subscriptionStatus: true },
    }),
    prisma.store.findMany({
      where: { organizationId },
      select: { name: true, code: true, inn: true, phone: true },
    }),
    prisma.authToken.findMany({
      where: { userId: userAfterSignup.id },
      orderBy: { createdAt: "asc" },
      select: { type: true, usedAt: true },
    }),
    prisma.auditLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      select: { action: true },
    }),
  ]);
  expect(organization).toEqual({
    name: signup.organizationName,
    plan: "STARTER",
    subscriptionStatus: "ACTIVE",
  });
  expect(stores).toEqual([
    {
      name: signup.storeName,
      code: signup.normalizedStoreCode,
      inn: signup.inn,
      phone: signup.phone,
    },
  ]);
  expect(authTokens).toEqual([
    { type: "REGISTRATION", usedAt: expect.any(Date) },
    { type: "EMAIL_VERIFY", usedAt: null },
  ]);
  expect(auditActions.map(({ action }) => action)).toEqual([
    "ORG_SIGNUP_COMPLETE",
    "STORE_CREATE",
    "AUTH_TOKEN_CREATE",
  ]);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { level: 1, name: "Registration link unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Create business", exact: true })).toHaveCount(0);
  expect(authLifecycleAudit.allowedLocaleWrites).toHaveLength(1);
  assertCleanAuthLifecycleAudit(authLifecycleAudit);
});
