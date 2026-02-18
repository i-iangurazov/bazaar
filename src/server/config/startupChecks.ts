import { assertEmailConfigured } from "@/server/services/email";
import { assertProductImageStorageConfigured } from "@/server/services/productImageStorage";
import { assertRedisConfigured, assertRedisReady } from "@/server/redis";
import { assertRuntimeEnvConfigured, isProductionRuntime } from "@/server/config/runtime";
import { isEmailVerificationRequired } from "@/server/config/auth";

let checked = false;
let pendingCheck: Promise<void> | null = null;

export const assertStartupConfigured = async () => {
  if (checked || !isProductionRuntime()) {
    return;
  }

  if (pendingCheck) {
    return pendingCheck;
  }

  pendingCheck = (async () => {
    assertRuntimeEnvConfigured();
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
