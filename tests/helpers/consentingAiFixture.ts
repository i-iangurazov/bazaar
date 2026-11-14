import { AI_PRIVACY_CONSENT_VERSION } from "@/lib/aiPrivacy";
import { prisma } from "@/server/db/prisma";
import { seedBase as seedWithoutAiConsent } from "./db";

// Existing AI-domain regression scenarios explicitly model people who reviewed
// and accepted the new notice. The shared default fixture remains unconsented.
export const seedConsentingAiFixture = async (options?: Parameters<typeof seedWithoutAiConsent>[0]) => {
  const fixture = await seedWithoutAiConsent(options);
  await prisma.user.updateMany({
    where: { organizationId: fixture.org.id },
    data: { aiConsentVersion: AI_PRIVACY_CONSENT_VERSION, aiConsentGrantedAt: new Date(), aiConsentRevokedAt: null },
  });
  return fixture;
};
