import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  authenticatedAuthLifecycleFixture,
  authenticatedAuthLifecycleRawTokens,
} from "../e2e/authenticated/auth-lifecycle-contract";

describe("authenticated auth-lifecycle fixture contract", () => {
  it("uses unique, opaque, QA-only lifecycle identities", () => {
    expect(new Set(authenticatedAuthLifecycleRawTokens).size).toBe(
      authenticatedAuthLifecycleRawTokens.length,
    );
    for (const rawToken of authenticatedAuthLifecycleRawTokens) {
      expect(rawToken.length).toBeGreaterThanOrEqual(32);
      expect(rawToken).toMatch(/^qa-bazaar-/);
    }
    for (const record of [
      authenticatedAuthLifecycleFixture.reset,
      authenticatedAuthLifecycleFixture.verify,
      authenticatedAuthLifecycleFixture.invite,
    ]) {
      expect(record.userId).toMatch(/^qa_bazaar_auth_user_/);
      expect(record.email).toMatch(/^qa-bazaar-.*@auth-e2e\.test$/);
    }
    expect(authenticatedAuthLifecycleFixture.signup.email).toMatch(/^qa-bazaar-.*@auth-e2e\.test$/);
    expect(authenticatedAuthLifecycleFixture.signup.name).toMatch(/^QA-BAZAAR(?:-| )/);
    expect(authenticatedAuthLifecycleFixture.signup.organizationName).toMatch(/^QA-BAZAAR(?:-| )/);
    expect(authenticatedAuthLifecycleFixture.signup.storeName).toMatch(/^QA-BAZAAR(?:-| )/);
  });

  it("is wired through the guarded authenticated seeder", () => {
    const mainSeeder = readFileSync("scripts/playwright-authenticated-fixture.ts", "utf8");
    expect(mainSeeder).toContain(
      'import { seedAuthenticatedAuthLifecycleFixtures } from "./playwright-authenticated-auth-lifecycle-fixture"',
    );
    expect(mainSeeder).toContain("await seedAuthenticatedAuthLifecycleFixtures(prisma)");
    expect(mainSeeder).toContain("ALLOW_AUTHENTICATED_E2E_SEED");
    expect(mainSeeder).toContain('process.env.NODE_ENV === "production"');
    const config = readFileSync("playwright.authenticated.config.ts", "utf8");
    expect(config).toContain('SIGNUP_MODE: "open"');
    expect(config).toContain('EMAIL_PROVIDER: "log"');
  });

  it("acknowledges only the exact intentional registration validation response", () => {
    const fixtureSource = readFileSync(
      "tests/e2e/authenticated/auth-lifecycle-test-fixtures.ts",
      "utf8",
    );
    const acceptanceSource = readFileSync(
      "tests/e2e/authenticated/authenticated-acceptance-auth-lifecycle.spec.ts",
      "utf8",
    );
    expect(fixtureSource).toContain("expectAuthLifecycleHttpError");
    expect(fixtureSource).toContain("readProcedures(new URL(response.url())).includes(procedure)");
    expect(fixtureSource).toContain("audit.consoleErrors.splice(consoleIndex, 1)");
    expect(acceptanceSource).toContain('procedure: "publicAuth.registerBusiness"');
    expect(acceptanceSource).toContain("status: 400");
  });
});
