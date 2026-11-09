import type { TRPCClientErrorLike } from "@trpc/client";
import type { AppRouter } from "@/server/trpc/routers/_app";
import { featureFromErrorDetails, featureLockError } from "@/lib/billing/featureLocks";

export const translateError = (
  tErrors: { (key: string): string; has?: (key: string) => boolean },
  error: TRPCClientErrorLike<AppRouter> | null | undefined,
) => {
  if (!error) {
    return "";
  }

  const messageKey = error.message;
  const normalizedKey = messageKey.startsWith("errors.") ? messageKey.replace("errors.", "") : messageKey;
  if (normalizedKey && tErrors.has?.(normalizedKey)) {
    const failure = featureLockError(normalizedKey);
    const feature = failure && !failure.feature ? featureFromErrorDetails(error.data?.details) : null;
    if (feature && tErrors.has?.(`featureNames.${feature}`)) {
      return `${tErrors(`featureNames.${feature}`)}: ${tErrors(normalizedKey)}`;
    }
    return tErrors(normalizedKey);
  }

  if (error.data?.code === "UNAUTHORIZED") {
    return tErrors("unauthorized");
  }

  if (error.data?.code === "FORBIDDEN") {
    return tErrors("forbidden");
  }

  if (error.data?.code === "BAD_REQUEST" && tErrors.has?.("invalidInput")) {
    return tErrors("invalidInput");
  }

  if (error.data?.code === "CONFLICT" && tErrors.has?.("requestInProgress")) {
    return tErrors("requestInProgress");
  }

  return tErrors.has?.("genericMessage") ? tErrors("genericMessage") : error.message;
};
