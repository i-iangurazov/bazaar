// Bump when recipients, purposes or the scope of sharing materially change.
export const AI_PRIVACY_CONSENT_VERSION = "2026-11-11";

export const hasCurrentAiConsent = (user: {
  aiConsentVersion: string | null;
  aiConsentGrantedAt: Date | null;
  aiConsentRevokedAt: Date | null;
  deletedAt: Date | null;
  isActive: boolean;
}) => Boolean(
  user.isActive && !user.deletedAt &&
  user.aiConsentVersion === AI_PRIVACY_CONSENT_VERSION &&
  user.aiConsentGrantedAt &&
  (!user.aiConsentRevokedAt || user.aiConsentGrantedAt > user.aiConsentRevokedAt),
);
