import { assertEmailConfigured } from "@/server/services/email";
import { assertProductImageStorageConfigured } from "@/server/services/productImageStorage";
import { assertRedisConfigured, assertRedisReady } from "@/server/redis";
import { isProductionRuntime } from "@/server/config/runtime";
import { isEmailVerificationRequired } from "@/server/config/auth";

let checked = false;
let pendingCheck: Promise<void> | null = null;

const assertDatabaseConfigured = () => {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required in production.");
  }
  try {
    const parsed = new URL(databaseUrl);
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") {
      throw new Error("DATABASE_URL cannot point to localhost in production.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("localhost")) {
      throw error;
    }
    throw new Error("DATABASE_URL is invalid.");
  }
};

export const assertStartupConfigured = async () => {
  if (checked || !isProductionRuntime()) {
    return;
  }

  if (pendingCheck) {
    return pendingCheck;
  }

  pendingCheck = (async () => {
    assertDatabaseConfigured();
    assertRedisConfigured();
    await assertRedisReady();
    assertProductImageStorageConfigured();
    if (isEmailVerificationRequired()) {
      assertEmailConfigured();
    }
    checked = true;
  })();

  try {
    await pendingCheck;
  } catch (error) {
    pendingCheck = null;
    throw error;
  }
};
