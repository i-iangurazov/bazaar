import { authenticatedE2EIds, authenticatedE2ESeedPrefix } from "./contract";

export const authenticatedAuthLifecycleFixture = {
  organizationId: authenticatedE2EIds.primaryOrganization,
  storeId: authenticatedE2EIds.primaryStore,
  reset: {
    userId: "qa_bazaar_auth_user_password_reset_lifecycle",
    tokenId: "qa_bazaar_auth_token_password_reset_lifecycle",
    email: "qa-bazaar-password-reset-lifecycle@auth-e2e.test",
    name: `${authenticatedE2ESeedPrefix} Password Reset Lifecycle`,
    rawToken: "qa-bazaar-password-reset-lifecycle-token-2026",
    initialPassword: "QA-BAZAAR-Reset-Initial-2026!",
    nextPassword: "QA-BAZAAR-Reset-Next-2026!",
  },
  verify: {
    userId: "qa_bazaar_auth_user_email_verify_lifecycle",
    tokenId: "qa_bazaar_auth_token_email_verify_lifecycle",
    email: "qa-bazaar-email-verify-lifecycle@auth-e2e.test",
    name: `${authenticatedE2ESeedPrefix} Email Verify Lifecycle`,
    rawToken: "qa-bazaar-email-verify-lifecycle-token-2026",
    password: "QA-BAZAAR-Verify-2026!",
  },
  invite: {
    userId: "qa_bazaar_auth_user_invite_lifecycle",
    inviteId: "qa_bazaar_auth_invite_lifecycle",
    email: "qa-bazaar-invite-lifecycle@auth-e2e.test",
    seededName: `${authenticatedE2ESeedPrefix} Invite Lifecycle Seed`,
    acceptedName: `${authenticatedE2ESeedPrefix} Чакыруу Өмүр Цикли`,
    rawToken: "qa-bazaar-invite-lifecycle-token-2026",
    password: "QA-BAZAAR-Invite-2026!",
    role: "STAFF" as const,
  },
  signup: {
    email: "qa-bazaar-open-signup-lifecycle@auth-e2e.test",
    name: `${authenticatedE2ESeedPrefix} Open Signup Lifecycle`,
    password: "QA-BAZAAR-Open-Signup-2026!",
    organizationName: `${authenticatedE2ESeedPrefix} Open Signup Organization`,
    storeName: `${authenticatedE2ESeedPrefix} Open Signup Store`,
    storeCodeInput: " qa open 1 ",
    normalizedStoreCode: "QA-OPEN-1",
    invalidStoreCode: "!!",
    inn: "123456789012",
    phone: "+996555010299",
  },
} as const;

export const authenticatedAuthLifecycleRawTokens = [
  authenticatedAuthLifecycleFixture.reset.rawToken,
  authenticatedAuthLifecycleFixture.verify.rawToken,
  authenticatedAuthLifecycleFixture.invite.rawToken,
] as const;
