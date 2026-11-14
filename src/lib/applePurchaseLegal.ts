import { legalPublicationState, LEGAL_TERMS_VERSION } from "./legalPublication";
import { legalDraftPreviewAllowed } from "./legalPreview";
import { assertRuntimeEnvConfigured } from "@/server/config/runtime";

// The common version is frozen into existing financial records. This scoped
// revision supplements it without reinterpreting already authorised purchases.
export const APPLE_PURCHASE_TERMS_REVISION = "2026-11-13-v1";
export const APPLE_PURCHASE_TERMS_PATH = `/legal/apple-purchases/${APPLE_PURCHASE_TERMS_REVISION}`;
export const APPLE_PURCHASE_TERMS_URL = `https://www.bazaar.kg${APPLE_PURCHASE_TERMS_PATH}`;

export function applePurchaseLegalPublication(env: Record<string, string | undefined> = process.env) {
  const common = legalPublicationState(env);
  const approved = env.APPLE_LEGAL_RELEASE_APPROVED === APPLE_PURCHASE_TERMS_REVISION;
  return { ...common, published: common.published && approved, revision: APPLE_PURCHASE_TERMS_REVISION,
    missing: [...common.missing, ...(!approved ? ["appleLegalApproval"] : [])] };
}

/** Local review or the complete existing isolated Preview runtime, never a
 * production flag shortcut. No final legal approval is inferred from a draft. */
export function applePurchaseLegalPreviewAllowed(host: string | null) {
  if (legalDraftPreviewAllowed(process.env, host)) return true;
  if (process.env.VERCEL_ENV !== "preview" || process.env.HARDENING_PREVIEW_GUARD !== "1") return false;
  try {
    const env = assertRuntimeEnvConfigured();
    return !env.isBuildPhase && env.vercelEnv === "preview" && env.hardeningPreviewGuard &&
      env.imageStorageProvider === "vercel-blob" && env.exportStorageProvider === "vercel-blob";
  } catch { return false; }
}

export function newApplePurchaseLegalConsent(environment: "Sandbox" | "Production", requestedRevision: string | undefined,
  env: Record<string, string | undefined> = process.env) {
  const publication = applePurchaseLegalPublication(env);
  if (!publication.published) return { allowed: environment === "Sandbox" && requestedRevision === undefined, consent: null };
  if (requestedRevision !== APPLE_PURCHASE_TERMS_REVISION) return { allowed: false, consent: null };
  return { allowed: true, consent: { version: 1 as const, revision: APPLE_PURCHASE_TERMS_REVISION,
    termsVersion: LEGAL_TERMS_VERSION, termsUrl: APPLE_PURCHASE_TERMS_URL } };
}
