import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ findUser: vi.fn() }));
vi.mock("@/server/db/prisma", () => ({ prisma: { user: { findUnique: db.findUser } } }));
vi.mock("@/server/config/runtime", () => ({ assertExternalProviderCallAllowed: vi.fn() }));

import { AI_PRIVACY_CONSENT_VERSION } from "@/lib/aiPrivacy";
import { withAiPrivacyIdentity } from "@/server/services/aiPrivacy";
import { fetchAiResponse } from "@/server/services/aiProvider";

const identity = { userId: "synthetic-user", organizationId: "synthetic-org" };
const config = { provider: "deepseek" as const, model: "synthetic-model", apiKey: "synthetic-key", url: "https://api.deepseek.com/responses" };
const user = () => ({ id: identity.userId, organizationId: identity.organizationId,
  isActive: true, deletedAt: null as Date | null, aiConsentVersion: AI_PRIVACY_CONSENT_VERSION,
  aiConsentGrantedAt: new Date("2026-11-01T00:00:00Z"), aiConsentRevokedAt: null as Date | null });

describe("explicit AI consent at the external network boundary", () => {
  const network = vi.fn();
  beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", network); network.mockResolvedValue(Response.json({ output: [] })); db.findUser.mockResolvedValue(user()); });
  afterEach(() => vi.unstubAllGlobals());

  it("does not send a byte without an initiating identity or without current permission", async () => {
    await expect(fetchAiResponse(config, { input: "private" }, AbortSignal.timeout(1000))).rejects.toThrow("aiConsentRequired");
    db.findUser.mockResolvedValue({ ...user(), aiConsentVersion: null });
    await expect(withAiPrivacyIdentity(identity, () => fetchAiResponse(config, { input: "private" }, AbortSignal.timeout(1000)))).rejects.toThrow("aiConsentRequired");
    expect(network).not.toHaveBeenCalled();
  });

  it("rechecks permission between attempts, and rejects another organization, impersonation or erased identity", async () => {
    await withAiPrivacyIdentity(identity, async () => {
      await fetchAiResponse(config, { input: "permitted" }, AbortSignal.timeout(1000));
      db.findUser.mockResolvedValue({ ...user(), aiConsentRevokedAt: new Date("2026-11-10T00:00:00Z") });
      await expect(fetchAiResponse(config, { input: "revoked" }, AbortSignal.timeout(1000))).rejects.toThrow("aiConsentRequired");
    });
    expect(network).toHaveBeenCalledOnce();
    for (const record of [ { ...user(), organizationId: "other-org" }, { ...user(), deletedAt: new Date() }, { ...user(), isActive: false } ]) {
      db.findUser.mockResolvedValue(record);
      await expect(withAiPrivacyIdentity(identity, () => fetchAiResponse(config, { input: "private" }, AbortSignal.timeout(1000)))).rejects.toThrow("aiConsentRequired");
    }
    db.findUser.mockResolvedValue(user());
    await expect(withAiPrivacyIdentity({ ...identity, impersonating: true }, () => fetchAiResponse(config, { input: "private" }, AbortSignal.timeout(1000)))).rejects.toThrow("aiConsentRequired");
    expect(network).toHaveBeenCalledOnce();
  });

  it("keeps concurrent request identities separate", async () => {
    db.findUser.mockImplementation(async ({ where }: { where: { id: string } }) => where.id === identity.userId ? user() : null);
    const results = await Promise.allSettled([
      withAiPrivacyIdentity(identity, () => fetchAiResponse(config, { input: "permitted" }, AbortSignal.timeout(1000))),
      withAiPrivacyIdentity({ ...identity, userId: "unapproved-user" }, () => fetchAiResponse(config, { input: "private" }, AbortSignal.timeout(1000))),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    expect(network).toHaveBeenCalledOnce();
  });
});
