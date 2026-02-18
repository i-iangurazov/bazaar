import { getRuntimeEnv, isProductionRuntime } from "@/server/config/runtime";

export const isEmailVerificationSkipped = () =>
  !isProductionRuntime() && getRuntimeEnv().skipEmailVerification;

export const isEmailVerificationRequired = () => !isEmailVerificationSkipped();
