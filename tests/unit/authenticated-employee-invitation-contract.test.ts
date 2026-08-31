import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { authenticatedEmployeeInvitationFixture } from "../e2e/authenticated/employee-invitation-contract";
import { authenticatedE2EIds, authenticatedE2ESeedPrefix } from "../e2e/authenticated/contract";

const readSource = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

describe("authenticated employee-invitation acceptance contract", () => {
  it("owns one deterministic standalone employee and an isolated expired-token boundary", () => {
    const fixture = authenticatedEmployeeInvitationFixture;
    expect(fixture.organizationId).toBe(authenticatedE2EIds.primaryOrganization);
    expect(fixture.assignedStoreId).toBe(authenticatedE2EIds.primaryStore);
    expect(fixture.deniedStoreId).toBe(authenticatedE2EIds.secondaryStore);
    expect(fixture.assignedStoreId).not.toBe(fixture.deniedStoreId);
    expect(fixture.invitedUser.name.startsWith(authenticatedE2ESeedPrefix)).toBe(true);
    expect(fixture.invitedUser.email).toMatch(/^qa-bazaar-.+@auth-e2e\.test$/);
    expect(fixture.invitedUser.initialRole).not.toBe(fixture.invitedUser.assignedRole);
    expect(fixture.expiredInvite.expiresAt.getTime()).toBeLessThan(Date.now());
    expect(fixture.expiredInvite.rawToken.length).toBeGreaterThanOrEqual(10);
    expect(fixture.malformedToken).not.toBe(fixture.expiredInvite.rawToken);
  });

  it("synchronously deduplicates the Users invite form and uses app-owned validation", () => {
    const usersPage = readSource("src/app/(app)/settings/users/page.tsx");
    expect(usersPage).toContain("const inviteSubmitInFlightRef = useRef(false)");
    expect(usersPage).toContain("if (inviteSubmitInFlightRef.current) return");
    expect(usersPage).toContain("inviteSubmitInFlightRef.current = true");
    expect(usersPage).toContain("inviteSubmitInFlightRef.current = false");
    expect(usersPage.indexOf("inviteSubmitInFlightRef.current = true")).toBeLessThan(
      usersPage.indexOf("inviteMutation.mutate({"),
    );
    expect(usersPage).toContain("onSubmit={inviteForm.handleSubmit(handleInviteSubmit)}");
    expect(usersPage).toMatch(
      /onSubmit=\{inviteForm\.handleSubmit\(handleInviteSubmit\)\}[\s\S]*?noValidate/,
    );
  });

  it("fails closed on ownership collisions and deletes only exact QA invitation records", () => {
    const seeder = readSource("scripts/playwright-authenticated-employee-invitation-fixture.ts");
    expect(seeder).toContain("assertEmployeeInvitationBaseOwnership");
    expect(seeder).toContain("Refusing employee-invitation user ownership collision");
    expect(seeder).toContain("Refusing employee-invitation token ownership collision");
    expect(seeder).toContain("Refusing employee-invitation audit collision");
    expect(seeder).toContain("Employee-invitation cleanup left QA-owned database residue");
    expect(seeder).toContain("await cleanupAuthenticatedEmployeeInvitationFixtures(prisma)");
    expect(seeder).not.toMatch(/\b(?:TRUNCATE|DROP\s+(?:DATABASE|SCHEMA|TABLE))\b/i);
    expect(seeder).not.toContain("deleteMany({})");
  });

  it("allows only invite creation, acceptance, locale, and one credential callback", () => {
    const auditFixture = readSource("tests/e2e/authenticated/employee-invitation-test-fixtures.ts");
    const acceptance = readSource(
      "tests/e2e/authenticated/authenticated-acceptance-employee-invitation.spec.ts",
    );
    const invitePage = readSource("src/app/invite/[token]/page.tsx");
    const playwrightConfig = readSource("playwright.authenticated.config.ts");

    expect(auditFixture).toContain('"invites.create"');
    expect(auditFixture).toContain('"publicAuth.acceptInvite"');
    expect(auditFixture).toContain('url.pathname === "/api/locale"');
    expect(auditFixture).toContain('url.pathname === "/api/auth/callback/credentials"');
    expect(auditFixture).toContain("audit.externalRequests.push");
    expect(auditFixture).toContain("audit.blockedLocalMutations.push");
    expect(auditFixture).toContain('await route.abort("blockedbyclient")');
    expect(auditFixture).toContain("await browser.newContext({");
    expect(auditFixture).toContain("signedOutEmployeePage");
    expect(auditFixture).toContain("await context.close()");
    expect(auditFixture).not.toContain("postData");
    expect(auditFixture).not.toContain("request.body");

    expect(acceptance).toContain("prepareAuthenticatedEmployeeInvitationFixtures(prisma)");
    expect(acceptance).toContain("cleanupAuthenticatedEmployeeInvitationFixtures(prisma)");
    expect(acceptance).toContain("signedOutEmployeePage: page");
    expect(acceptance).toContain("hashToken(inviteToken)");
    expect(acceptance).toContain("INVITE_CREATE");
    expect(acceptance).toContain("INVITE_ACCEPT");
    expect(acceptance).toContain("fixture.expiredInvite.rawToken");
    expect(acceptance).toContain("fixture.malformedToken");
    expect(acceptance).toContain("fixture.deniedStoreId");
    expect(acceptance).not.toMatch(/console\.(?:log|info|warn|error)/);
    expect(invitePage).toContain("setEmailVerificationRequired(!result.user.emailVerifiedAt)");
    expect(invitePage).toContain(
      'emailVerificationRequired\n                  ? t("acceptedHint")',
    );

    expect(playwrightConfig).toContain('EMAIL_PROVIDER: "log"');
    expect(playwrightConfig).toContain('HARDENING_EXTERNAL_PROVIDER_MODE: "disabled"');
    expect(playwrightConfig).toContain('RESEND_API_KEY: ""');
  });
});
