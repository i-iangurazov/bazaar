import { assertRuntimeEnvConfigured, getRuntimeEnv, isProductionRuntime } from "@/server/config/runtime";

export const isEmailVerificationSkipped = () => {
  const env = getRuntimeEnv();
  if (!env.skipEmailVerification) return false;
  if (!isProductionRuntime()) return true;
  // A Vercel Preview also runs NODE_ENV=production. Its explicit test skip is
  // safe only inside the complete existing isolated-runtime boundary. Requiring
  // both Blob providers makes that boundary validate project and both store pins.
  if (env.vercelEnv !== "preview" || !env.hardeningPreviewGuard ||
    env.imageStorageProvider !== "vercel-blob" || env.exportStorageProvider !== "vercel-blob") return false;
  try {
    assertRuntimeEnvConfigured();
    return true;
  } catch {
    return false;
  }
};

export const isEmailVerificationRequired = () => !isEmailVerificationSkipped();
