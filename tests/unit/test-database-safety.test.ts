import { describe, expect, it } from "vitest";

import {
  assertSafeTestDatabaseReset,
  HARDENING_TEST_DATABASE_ALLOWLIST,
} from "../helpers/testDatabaseSafety";

const validEnvironment = (databaseName = "bazaar_hardening_agent4_platform") => ({
  NODE_ENV: "test",
  RUN_DB_TESTS: "1",
  ALLOW_TEST_DB_RESET: "1",
  EXPECTED_TEST_DB_NAME: databaseName,
  DATABASE_URL: `postgresql://inventory:inventory@localhost:5432/${databaseName}?schema=public`,
});

describe("test database destructive-operation guard", () => {
  it.each([...HARDENING_TEST_DATABASE_ALLOWLIST])(
    "accepts the explicitly allowlisted local database %s",
    (databaseName) => {
      expect(assertSafeTestDatabaseReset({ env: validEnvironment(databaseName) })).toEqual({
        databaseUrl: expect.stringContaining(`/${databaseName}`),
        databaseName,
        host: "localhost",
      });
    },
  );

  it("requires NODE_ENV=test", () => {
    expect(() =>
      assertSafeTestDatabaseReset({
        env: { ...validEnvironment(), NODE_ENV: "development" },
      }),
    ).toThrow('NODE_ENV must be exactly "test"');
  });

  it("requires the explicit DB-test execution flag", () => {
    expect(() =>
      assertSafeTestDatabaseReset({
        env: { ...validEnvironment(), RUN_DB_TESTS: "0" },
      }),
    ).toThrow('RUN_DB_TESTS must be exactly "1"');
  });

  it("requires the explicit destructive reset flag", () => {
    expect(() =>
      assertSafeTestDatabaseReset({
        env: { ...validEnvironment(), ALLOW_TEST_DB_RESET: undefined },
      }),
    ).toThrow('ALLOW_TEST_DB_RESET must be exactly "1"');
  });

  it("requires an expected database identity", () => {
    expect(() =>
      assertSafeTestDatabaseReset({
        env: { ...validEnvironment(), EXPECTED_TEST_DB_NAME: "" },
      }),
    ).toThrow("EXPECTED_TEST_DB_NAME must be explicitly set");
  });

  it("rejects a database outside the hardening allowlist", () => {
    expect(() =>
      assertSafeTestDatabaseReset({
        env: validEnvironment("inventory_test"),
      }),
    ).toThrow("is not in the hardening database allowlist");
  });

  it("rejects a URL whose database does not match the expected identity", () => {
    expect(() =>
      assertSafeTestDatabaseReset({
        env: {
          ...validEnvironment(),
          DATABASE_URL:
            "postgresql://inventory:inventory@localhost:5432/bazaar_hardening_agent1_pos",
        },
      }),
    ).toThrow("Database identity mismatch");
  });

  it("rejects Production execution even with an allowlisted database", () => {
    expect(() =>
      assertSafeTestDatabaseReset({
        env: { ...validEnvironment(), VERCEL_ENV: "production" },
      }),
    ).toThrow("VERCEL_ENV=production");
  });

  it("rejects a host identified as Production", () => {
    expect(() =>
      assertSafeTestDatabaseReset({
        env: {
          ...validEnvironment(),
          DATABASE_URL:
            "postgresql://inventory:inventory@db.example.test:5432/bazaar_hardening_agent4_platform",
          HARDENING_TEST_DB_HOST_ALLOWLIST: "db.example.test",
          PRODUCTION_DATABASE_HOSTS: "db.example.test",
        },
      }),
    ).toThrow("is identified as Production");
  });

  it("rejects a non-local host that was not explicitly allowlisted", () => {
    expect(() =>
      assertSafeTestDatabaseReset({
        env: {
          ...validEnvironment(),
          DATABASE_URL:
            "postgresql://inventory:inventory@db.example.test:5432/bazaar_hardening_agent4_platform",
        },
      }),
    ).toThrow("must be explicitly listed in HARDENING_TEST_DB_HOST_ALLOWLIST");
  });

  it("accepts an explicitly allowlisted non-Production test host", () => {
    const identity = assertSafeTestDatabaseReset({
      env: {
        ...validEnvironment(),
        DATABASE_URL:
          "postgresql://inventory:inventory@db.example.test:5432/bazaar_hardening_agent4_platform",
        HARDENING_TEST_DB_HOST_ALLOWLIST: "db.example.test",
        PRODUCTION_DATABASE_HOSTS: "prod.example.test",
      },
    });

    expect(identity.host).toBe("db.example.test");
  });

  it("does not include database credentials in failure output", () => {
    expect(() =>
      assertSafeTestDatabaseReset({
        env: {
          ...validEnvironment(),
          DATABASE_URL:
            "postgresql://private-user:private-password@localhost:5432/bazaar_hardening_agent1_pos",
        },
      }),
    ).toThrowError(/Database identity mismatch/);

    try {
      assertSafeTestDatabaseReset({
        env: {
          ...validEnvironment(),
          DATABASE_URL:
            "postgresql://private-user:private-password@localhost:5432/bazaar_hardening_agent1_pos",
        },
      });
    } catch (error) {
      expect(String(error)).not.toContain("private-user");
      expect(String(error)).not.toContain("private-password");
    }
  });
});
