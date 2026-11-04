// Draft access is deliberately independent of payment configuration and seller
// data. Even a completed seller record or an accidentally set flag cannot make
// these drafts public in a production build or on a hosted preview deployment.
export const legalDraftPreviewAllowed = (
  env: Record<string, string | undefined>,
  host: string | null,
) => {
  if (
    env.NODE_ENV !== "development" ||
    env.BAZAAR_LEGAL_PREVIEW !== "1" ||
    (env.VERCEL && env.VERCEL !== "0") ||
    env.VERCEL_ENV
  )
    return false;
  return /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host ?? "");
};
