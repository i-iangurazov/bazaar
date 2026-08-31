import {
  authenticatedE2EAccounts,
  authenticatedE2EIds,
  authenticatedE2ESeedPrefix,
} from "./contract";

export const authenticatedEmployeeInvitationFixture = {
  organizationId: authenticatedE2EIds.primaryOrganization,
  creatorEmail: authenticatedE2EAccounts.admin.email,
  creatorId: "qa_bazaar_auth_user_admin",
  assignedStoreId: authenticatedE2EIds.primaryStore,
  deniedStoreId: authenticatedE2EIds.secondaryStore,
  assignedStoreLabel: "QA-BAZAAR Primary Store (QA-AUTH-PRIMARY)",
  invitedUser: {
    id: "qa_bazaar_employee_invitation_user",
    email: "qa-bazaar-employee-invitation@auth-e2e.test",
    name: `${authenticatedE2ESeedPrefix} Employee Invitation Acceptance`,
    password: "QA-BAZAAR-Employee-Invite-2026!",
    initialRole: "STAFF" as const,
    assignedRole: "MANAGER" as const,
    preferredLocale: "en" as const,
  },
  expiredInvite: {
    id: "qa_bazaar_employee_invitation_expired",
    email: "qa-bazaar-expired-employee-invitation@auth-e2e.test",
    rawToken: "qa-bazaar-expired-employee-invitation-token-2026",
    role: "STAFF" as const,
    expiresAt: new Date("2020-01-01T00:00:00.000Z"),
  },
  malformedToken: "qa-bazaar-malformed-employee-invitation-2026",
} as const;
