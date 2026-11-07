import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanFeature } from "@/lib/billing/plans";
const mock = vi.hoisted(() => ({ org: vi.fn(), active: vi.fn(), access: vi.fn(), actor: vi.fn() }));
vi.mock("@/server/services/planLimits", () => ({
  getOrganizationPlan: mock.org,
  assertTrialActive: mock.active,
  resolveOrganizationAccessState: mock.access,
}));
vi.mock("@/server/db/prisma", () => ({ prisma: { user: { findFirst: mock.actor } } }));
import {
  assertProductExportAccess,
  assertProductImportAccess,
  assertReadableFeature,
} from "@/server/billing/coreAccess";
function organization(version = "2026-11", features: Partial<Record<PlanFeature, boolean>> = {}) {
  return {
    billingCatalogVersion: version,
    subscriptionStatus: "ACTIVE",
    entitlements: { features },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.access.mockReturnValue({ hasAccess: false });
  mock.actor.mockResolvedValue({ role: "ADMIN", isOrgOwner: true });
});
describe("commercial core access", () => {
  it("retains new-catalog historical analytics after expiry without opening missing features", async () => {
    mock.org.mockResolvedValue(organization("2026-11", { analytics: true }));
    await expect(assertReadableFeature("org", "analytics")).resolves.toBeTruthy();
    mock.org.mockResolvedValue(organization("2026-11", { analytics: false }));
    await expect(assertReadableFeature("org", "analytics")).rejects.toThrow(
      "featureLockedAnalytics",
    );
  });
  it("preserves old analytics expiry rules and denies cancelled subscriptions", async () => {
    mock.org.mockResolvedValue(organization("2026-10", { analytics: true }));
    await expect(assertReadableFeature("org", "analytics")).rejects.toThrow("subscriptionInactive");
    mock.org.mockResolvedValue({
      ...organization("2026-11", { analytics: true }),
      subscriptionStatus: "CANCELED",
    });
    await expect(assertReadableFeature("org", "analytics")).rejects.toThrow("subscriptionInactive");
  });
  it("does not introduce expiry restrictions on previously ungated legacy modules", async () => {
    mock.org.mockResolvedValue(organization("2026-10", { assortments: true }));
    await expect(assertReadableFeature("org", "assortments")).resolves.toBeTruthy();
  });
  it("lets only new Starter use initial import while preserving the old Starter import gate", async () => {
    mock.active.mockResolvedValue(organization("2026-11", { initialImport: true, imports: false }));
    await expect(assertProductImportAccess("org")).resolves.toMatchObject({ initialOnly: true });
    mock.active.mockResolvedValue(organization("2026-10", { imports: false, initialImport: true }));
    await expect(assertProductImportAccess("org")).rejects.toThrow("featureLockedImports");
    mock.active.mockResolvedValue(organization("2026-11", { imports: true, initialImport: true }));
    await expect(assertProductImportAccess("org")).resolves.toMatchObject({ initialOnly: false });
  });
  it("keeps own raw export after expiry but never gives it to ordinary staff", async () => {
    mock.org.mockResolvedValue(organization("2026-11", { exports: false, rawDataExport: true }));
    await expect(
      assertProductExportAccess({ organizationId: "org", actorId: "owner" }),
    ).resolves.toBeUndefined();
    mock.actor.mockResolvedValue({ role: "MANAGER", isOrgOwner: false });
    await expect(
      assertProductExportAccess({ organizationId: "org", actorId: "staff" }),
    ).rejects.toThrow("forbidden");
    expect(mock.actor).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "staff", organizationId: "org", isActive: true } }),
    );
  });
  it("preserves legacy raw export behavior and Business exports", async () => {
    mock.org.mockResolvedValue(organization("2026-10", { exports: false }));
    await expect(assertProductExportAccess({ organizationId: "org" })).resolves.toBeUndefined();
    mock.org.mockResolvedValue(organization("2026-11", { exports: true }));
    await expect(assertProductExportAccess({ organizationId: "org" })).resolves.toBeUndefined();
    expect(mock.actor).not.toHaveBeenCalled();
  });
});
