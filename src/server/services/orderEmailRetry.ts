import { EmailProviderError } from "@/server/services/email";

export const ORDER_EMAIL_MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 60_000;
const MAX_DATE_MS = 8_640_000_000_000_000;

/** A durable retry must not run before either our backoff or the provider's delay. */
export const resolveOrderEmailRetryAt = (input: {
  hasClaim: boolean;
  attemptCount: number;
  error: unknown;
  now?: Date;
}): Date | null => {
  if (
    !input.hasClaim ||
    !Number.isInteger(input.attemptCount) ||
    input.attemptCount < 1 ||
    input.attemptCount >= ORDER_EMAIL_MAX_ATTEMPTS
  )
    return null;

  const retryAfterMs = input.error instanceof EmailProviderError ? input.error.retryAfterMs : null;
  const providerDelay =
    retryAfterMs !== null && Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : 0;
  const delay = Math.max(RETRY_BASE_MS * 2 ** (input.attemptCount - 1), providerDelay);
  const now = (input.now ?? new Date()).getTime();
  // An unrepresentable provider deadline must not become an invalid DB value or
  // be shortened into an automatic retry before the requested time.
  if (!Number.isFinite(now) || delay > MAX_DATE_MS - now) return null;
  return new Date(now + delay);
};
