import { describe, expect, it, vi } from "vitest";

import {
  getSafeSeedFailureMessage,
  resolveDevelopmentSeedConfiguration,
  runWithDevelopmentSeedConfiguration,
  type SeedEnvironment,
} from "../../prisma/seed-config";

const strongPassword = (marker: string) => `Xy9!${marker.repeat(20)}Zz8@`;

const validEnvironment = (): Record<string, string> => ({
  NODE_ENV: "test",
  PLATFORM_OWNER_EMAILS: "local-owner@seed.invalid",
  SEED_DEMO_DATA: "1",
  SEED_ADMIN_EMAIL: "local-a@seed.invalid",
  SEED_ADMIN_PASSWORD: strongPassword("a"),
  SEED_MANAGER_EMAIL: "local-b@seed.invalid",
  SEED_MANAGER_PASSWORD: strongPassword("b"),
  SEED_STAFF_EMAIL: "local-c@seed.invalid",
  SEED_STAFF_PASSWORD: strongPassword("c"),
  SEED_PLATFORM_OWNER_EMAIL: "local-owner@seed.invalid",
  SEED_PLATFORM_OWNER_PASSWORD: strongPassword("d"),
});

const expectRejectedBeforeOperation = async (environment: SeedEnvironment, message: RegExp) => {
  const operation = vi.fn(async () => "written");

  await expect(runWithDevelopmentSeedConfiguration(environment, operation)).rejects.toThrow(
    message,
  );
  expect(operation).not.toHaveBeenCalled();
};

describe("development seed configuration", () => {
  it("resolves explicit local credentials and invokes the operation once", async () => {
    const environment = validEnvironment();
    environment.SEED_ADMIN_EMAIL = "LOCAL-A@SEED.INVALID";
    const operation = vi.fn(async (configuration) => configuration.users.admin.email);

    await expect(runWithDevelopmentSeedConfiguration(environment, operation)).resolves.toBe(
      "local-a@seed.invalid",
    );
    expect(operation).toHaveBeenCalledOnce();
  });

  it("rejects production, deployment, implicit, and unclassified targets before any operation", async () => {
    await expectRejectedBeforeOperation(
      { ...validEnvironment(), NODE_ENV: "production" },
      /development or test/i,
    );
    await expectRejectedBeforeOperation(
      { ...validEnvironment(), VERCEL_ENV: "preview" },
      /Vercel deployment/i,
    );
    await expectRejectedBeforeOperation(
      { ...validEnvironment(), SEED_DEMO_DATA: "0" },
      /explicitly opt in/i,
    );
    const environmentWithoutNodeEnv = validEnvironment();
    delete environmentWithoutNodeEnv.NODE_ENV;
    await expectRejectedBeforeOperation(environmentWithoutNodeEnv, /development or test/i);
  });

  it("requires every seeded email and password before any operation", async () => {
    for (const variableName of [
      "SEED_ADMIN_EMAIL",
      "SEED_ADMIN_PASSWORD",
      "SEED_MANAGER_EMAIL",
      "SEED_MANAGER_PASSWORD",
      "SEED_STAFF_EMAIL",
      "SEED_STAFF_PASSWORD",
      "SEED_PLATFORM_OWNER_EMAIL",
      "SEED_PLATFORM_OWNER_PASSWORD",
    ]) {
      const environment = validEnvironment();
      delete environment[variableName];
      await expectRejectedBeforeOperation(environment, new RegExp(variableName));
    }
  });

  it("rejects weak, reused, and identity-derived passwords before any operation", async () => {
    await expectRejectedBeforeOperation(
      { ...validEnvironment(), SEED_ADMIN_PASSWORD: "Too-short1!" },
      /20-128 characters/i,
    );

    const reusedEnvironment = validEnvironment();
    reusedEnvironment.SEED_PLATFORM_OWNER_PASSWORD = reusedEnvironment.SEED_ADMIN_PASSWORD;
    await expectRejectedBeforeOperation(reusedEnvironment, /unique password/i);

    await expectRejectedBeforeOperation(
      {
        ...validEnvironment(),
        SEED_ADMIN_EMAIL: "distinctive-identity@seed.invalid",
        SEED_ADMIN_PASSWORD: "Distinctive-Identity9!XyZ",
      },
      /account identifier/i,
    );
  });

  it("requires unique identities and a matching platform-owner allowlist", async () => {
    await expectRejectedBeforeOperation(
      { ...validEnvironment(), SEED_MANAGER_EMAIL: "local-a@seed.invalid" },
      /unique email/i,
    );
    await expectRejectedBeforeOperation(
      { ...validEnvironment(), PLATFORM_OWNER_EMAILS: "someone-else@seed.invalid" },
      /must include SEED_PLATFORM_OWNER_EMAIL/i,
    );
  });

  it("never includes supplied secrets in safe failure output", () => {
    const runtimeSecret = strongPassword("z");
    const message = getSafeSeedFailureMessage(new Error(`failure involving ${runtimeSecret}`));

    expect(message).not.toContain(runtimeSecret);
    expect(message).toMatch(/were not logged/i);
  });

  it("does not return partial configuration for invalid input", () => {
    const environment = validEnvironment();
    environment.SEED_STAFF_PASSWORD = "invalid";

    expect(() => resolveDevelopmentSeedConfiguration(environment)).toThrow();
  });
});
