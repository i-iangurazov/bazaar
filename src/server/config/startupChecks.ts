import { assertEmailConfigured } from "@/server/services/email";
import { assertProductImageStorageConfigured } from "@/server/services/productImageStorage";
import { assertRedisConfigured } from "@/server/redis";
import { isProductionRuntime } from "@/server/config/runtime";
import { isEmailVerificationRequired } from "@/server/config/auth";

let checked = false;

export const assertStartupConfigured = () => {
  if (checked || !isProductionRuntime()) {
    return;
  }
  assertRedisConfigured();
  assertProductImageStorageConfigured();
  if (isEmailVerificationRequired()) {
    assertEmailConfigured();
  }
  checked = true;
};
