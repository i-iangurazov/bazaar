import bcrypt from "bcryptjs";
import { encode } from "next-auth/jwt";
import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ remove: vi.fn(), upload: vi.fn(), download: vi.fn(), keepAlive: vi.fn() }));
vi.mock("@/server/services/productImageStorage", () => ({ deleteManagedAccountAsset: storage.remove,
  uploadProductImageBuffer: storage.upload, downloadRemoteImage: storage.download }));
vi.mock("@/server/config/startupChecks", () => ({ assertStartupConfigured: vi.fn() }));
vi.mock("@/server/jobs", () => ({ runJob: vi.fn() }));
vi.mock("@/server/jobs/background", () => ({ keepBackgroundTaskAlive: storage.keepAlive }));

import { prisma } from "@/server/db/prisma";
import { getAuthTokenFromCookieHeader } from "@/server/auth/token";
import { createAuthToken } from "@/server/services/authTokens";
import { deleteOwnAccount, getAccountDeletionPreview } from "@/server/services/accountDeletion";
import { eraseAccountAssets } from "@/server/services/accountErasureAssets";
import { assertAiConsent, getAiConsent, updateAiConsent, withAiPrivacyIdentity } from "@/server/services/aiPrivacy";
import { appendBaamMessage } from "@/server/services/baamConversations";
import { resetUserPassword, setUserActive, updateUser } from "@/server/services/users";
import { userSettingsRouter } from "@/server/trpc/routers/userSettings";
import { AI_PRIVACY_CONSENT_VERSION } from "@/lib/aiPrivacy";
import { adoptBaamProductPhoto, baamProductPhotoReference, encryptBaamMedia } from "@/server/services/baamPrivateMedia";
import { getLogger } from "@/server/logging";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const password = "Synthetic-erasure-password-2026";
const scope = (user: { id: string; organizationId: string | null }) => ({
  userId: user.id, organizationId: user.organizationId!, requestId: "synthetic-erasure-request",
});
const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("own-account deletion and explicit AI privacy consent", () => {
  beforeEach(async () => { await resetDatabase(); storage.remove.mockReset().mockResolvedValue(undefined);
    storage.upload.mockReset(); storage.keepAlive.mockReset(); process.env.BAAM_MEDIA_ENCRYPTION_KEY = Buffer.alloc(32, 23).toString("base64"); });

  it("erases identity and private histories, revokes old sessions and recovery, retains inventory and operation receipts", async () => {
    const f = await seedBase({ plan: "BUSINESS" });
    const user = await prisma.user.update({ where: { id: f.staffUser.id }, data: {
      passwordHash: await bcrypt.hash(password, 4), phone: "+996000000000", jobTitle: "Synthetic private job",
      signupAttribution: { campaign: "synthetic-private" },
      aiConsentVersion: AI_PRIVACY_CONSENT_VERSION, aiConsentGrantedAt: new Date(),
    } });
    const token = await encode({ secret: process.env.NEXTAUTH_SECRET!, token: { sub: user.id, sessionVersion: user.sessionVersion } });
    await createAuthToken({ userId: user.id, email: user.email, purpose: "PASSWORD_RESET", expiresInMinutes: 30 });
    await prisma.mobileDevice.create({ data: { userId: user.id, organizationId: f.org.id, platform: "IOS", installationId: "synthetic-installation", tokenEncrypted: "synthetic-encrypted", tokenHash: "a".repeat(64), appVersion: "1", buildNumber: "1" } });
    const conversation = await prisma.baamConversation.create({ data: { userId: user.id, organizationId: f.org.id, title: "Private title" } });
    await prisma.baamMessage.create({ data: { conversationId: conversation.id, sequence: 1, role: "user", text: "Synthetic private text" } });
    await prisma.baamAttachment.create({ data: { conversationId: conversation.id, name: "private.png", mimeType: "image/png", url: `/uploads/imported-products/${f.org.id}/products/unassigned/private.png` } });
    const movement = await prisma.stockMovement.create({ data: { storeId: f.store.id, productId: f.product.id, type: "RECEIVE", qtyDelta: 2, createdById: user.id, unitCostKgs: "12.34", lineTotalKgs: "24.68" } });
    await prisma.idempotencyKey.create({ data: { key: "private-test-operation", route: "inventory.stockReceivingReviewed", userId: user.id, response: { movementId: movement.id, status: "POSTED" } } });
    await prisma.auditLog.create({ data: { organizationId: f.org.id, actorId: user.id, action: "USER_PROFILE_UPDATE", entity: "User", entityId: user.id, before: { email: user.email, phone: user.phone }, after: { name: user.name }, requestId: "synthetic-profile-before" } });

    await expect(deleteOwnAccount({ ...scope(user), password, confirmation: "DELETE" })).resolves.toEqual({ deleted: true });
    const erased = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(erased).toMatchObject({ name: "Deleted account", isActive: false, isOrgOwner: false, phone: null, jobTitle: null, emailVerifiedAt: null, signupAttribution: null, aiConsentVersion: null });
    expect(erased.deletedAt).toBeInstanceOf(Date);
    expect(erased.email).toMatch(/^deleted\+.+@deleted\.invalid$/);
    expect(await bcrypt.compare(password, erased.passwordHash)).toBe(false);
    expect(await getAuthTokenFromCookieHeader(`next-auth.session-token=${token}`)).toBeNull();
    expect(await prisma.authToken.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.mobileDevice.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.userStoreAccess.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.baamMessage.count({ where: { conversationId: conversation.id } })).toBe(0);
    expect(await prisma.baamAttachment.count({ where: { conversationId: conversation.id } })).toBe(0);
    expect((await prisma.baamConversation.findUniqueOrThrow({ where: { id: conversation.id } })).title).toBe("");
    const retained = await prisma.stockMovement.findUniqueOrThrow({ where: { id: movement.id } });
    expect(retained.createdById).toBe(user.id);
    expect(retained.lineTotalKgs?.toFixed(2)).toBe("24.68");
    expect(await prisma.idempotencyKey.findUnique({ where: { key_route_userId: { key: "private-test-operation", route: "inventory.stockReceivingReviewed", userId: user.id } } })).not.toBeNull();
    expect((await prisma.auditLog.findFirstOrThrow({ where: { requestId: "synthetic-profile-before" } })).before).toBeNull();
    await expect(prisma.$transaction((tx) => appendBaamMessage(tx, { conversationId: conversation.id, role: "assistant", text: "late private response" }))).rejects.toThrow();
    await eraseAccountAssets();
    expect(storage.remove).toHaveBeenCalledOnce();
    expect(await prisma.accountErasureAsset.count()).toBe(0);
  });

  it("does not erase on a wrong password and does not allow deletion of another organization", async () => {
    const f = await seedBase({ plan: "BUSINESS" });
    await prisma.user.update({ where: { id: f.staffUser.id }, data: { passwordHash: await bcrypt.hash(password, 4) } });
    await expect(deleteOwnAccount({ ...scope(f.staffUser), password: "wrong", confirmation: "DELETE" })).rejects.toThrow("accountPasswordIncorrect");
    await expect(deleteOwnAccount({ ...scope(f.staffUser), organizationId: "another-organization", password, confirmation: "DELETE" })).rejects.toThrow("userNotFound");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: f.staffUser.id } })).deletedAt).toBeNull();
  });

  it("requires an intentional in-organization owner handoff and grants the chosen colleague full responsibility", async () => {
    const f = await seedBase({ plan: "BUSINESS" });
    await prisma.user.update({ where: { id: f.adminUser.id }, data: { passwordHash: await bcrypt.hash(password, 4) } });
    expect((await getAccountDeletionPreview(scope(f.adminUser))).requiresSuccessor).toBe(true);
    await expect(deleteOwnAccount({ ...scope(f.adminUser), password, confirmation: "DELETE", successorUserId: "foreign-user" })).rejects.toThrow("accountSuccessorRequired");
    await deleteOwnAccount({ ...scope(f.adminUser), password, confirmation: "DELETE", successorUserId: f.managerUser.id });
    const successor = await prisma.user.findUniqueOrThrow({ where: { id: f.managerUser.id } });
    expect(successor).toMatchObject({ role: "ADMIN", isOrgOwner: true, isActive: true, deletedAt: null, sessionVersion: f.managerUser.sessionVersion + 1 });
    expect(await prisma.userStoreAccess.count({ where: { userId: successor.id } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: f.cashierUser.id } })).isActive).toBe(true);
  });

  it("permits a sole owner's immediate exit and permanently prevents administrator or recovery restoration", async () => {
    const f = await seedBase({ plan: "BUSINESS" });
    await prisma.user.update({ where: { id: f.adminUser.id }, data: { passwordHash: await bcrypt.hash(password, 4) } });
    await prisma.user.updateMany({ where: { organizationId: f.org.id, id: { not: f.adminUser.id } }, data: { isActive: false } });
    expect(await getAccountDeletionPreview(scope(f.adminUser))).toMatchObject({ requiresSuccessor: false, soleOwner: true });
    await deleteOwnAccount({ ...scope(f.adminUser), password, confirmation: "DELETE" });
    expect(await prisma.organization.findUnique({ where: { id: f.org.id } })).not.toBeNull();
    const adminInput = { userId: f.adminUser.id, organizationId: f.org.id, actorId: f.managerUser.id, requestId: "synthetic-reactivation" };
    await expect(setUserActive({ ...adminInput, isActive: true })).rejects.toThrow("userNotFound");
    await expect(resetUserPassword({ ...adminInput, password })).rejects.toThrow("userNotFound");
    await expect(updateUser({ ...adminInput, email: "restored@example.invalid", name: "Restored", role: "ADMIN", preferredLocale: "ru" })).rejects.toThrow("userNotFound");
    await expect(createAuthToken({ userId: f.adminUser.id, email: f.adminUser.email, purpose: "PASSWORD_RESET", expiresInMinutes: 30 })).rejects.toThrow("tokenInvalid");
    // The database also protects against an overlooked future administrator route.
    await expect(prisma.user.update({ where: { id: f.adminUser.id }, data: { deletedAt: null, isActive: true } })).rejects.toThrow();
  });

  it("keeps erasure and AI privacy controls usable after a paid plan expires", async () => {
    const f = await seedBase({ plan: "BUSINESS" });
    await prisma.organization.update({ where: { id: f.org.id }, data: { subscriptionBillingMode: "SELF_SERVE", subscriptionStatus: "CANCELED", currentPeriodEndsAt: new Date("2020-01-01") } });
    await prisma.user.update({ where: { id: f.staffUser.id }, data: { passwordHash: await bcrypt.hash(password, 4) } });
    const caller = userSettingsRouter.createCaller({ prisma, user: { id: f.staffUser.id, email: f.staffUser.email, organizationId: f.org.id, role: f.staffUser.role, isPlatformOwner: false, isOrgOwner: false }, impersonator: null, impersonationSessionId: null, ip: null, requestId: "synthetic-expired-erasure", logger: getLogger() });
    expect(await caller.aiConsent()).toMatchObject({ granted: false });
    expect(await caller.accountDeletionPreview()).toMatchObject({ requiresSuccessor: false });
    expect(await caller.deleteMyAccount({ password, confirmation: "DELETE" })).toEqual({ deleted: true });
    expect(storage.keepAlive).toHaveBeenCalledOnce();
    await expect(storage.keepAlive.mock.calls[0]?.[0]).resolves.toBeUndefined();
  });

  it("requires explicit versioned consent, blocks missing or impersonated identities, and checks revocation again on retry", async () => {
    const f = await seedBase({ plan: "BUSINESS" });
    const identity = { userId: f.managerUser.id, organizationId: f.org.id };
    expect(await getAiConsent(identity)).toMatchObject({ granted: false });
    await expect(assertAiConsent(identity)).rejects.toThrow("aiConsentRequired");
    await expect(updateAiConsent({ ...identity, granted: true, version: "obsolete", requestId: "synthetic-consent" })).rejects.toThrow("accountConsentChanged");
    await updateAiConsent({ ...identity, granted: true, version: AI_PRIVACY_CONSENT_VERSION, requestId: "synthetic-consent" });
    await expect(withAiPrivacyIdentity(identity, () => assertAiConsent())).resolves.toEqual(identity);
    await expect(withAiPrivacyIdentity({ ...identity, impersonating: true }, () => assertAiConsent(identity))).rejects.toThrow("aiConsentRequired");
    await withAiPrivacyIdentity(identity, async () => {
      await assertAiConsent();
      await updateAiConsent({ ...identity, granted: false, version: AI_PRIVACY_CONSENT_VERSION, requestId: "synthetic-revoke" });
      await expect(assertAiConsent()).rejects.toThrow("aiConsentRequired");
    });
    await expect(assertAiConsent()).rejects.toThrow("aiConsentRequired");
    await updateAiConsent({ ...identity, granted: true, version: AI_PRIVACY_CONSENT_VERSION, requestId: "synthetic-regrant" });
    expect(await getAiConsent(identity)).toMatchObject({ granted: true });
  });

  it("retries unavailable storage and preserves assets referenced by company records or another person", async () => {
    const f = await seedBase({ plan: "BUSINESS" });
    const retainedUrl = `/uploads/imported-products/${f.org.id}/products/unassigned/shared.png`;
    await prisma.productImage.create({ data: { organizationId: f.org.id, productId: f.product.id, url: retainedUrl } });
    await prisma.accountErasureAsset.createMany({ data: [retainedUrl, `/uploads/imported-products/${f.org.id}/products/unassigned/private.png`].map((url) => ({ organizationId: f.org.id, url })) });
    storage.remove.mockRejectedValueOnce(new Error("Synthetic storage outage"));
    expect((await eraseAccountAssets()).details).toMatchObject({ retained: 1, retrying: 1 });
    const pending = await prisma.accountErasureAsset.findFirstOrThrow();
    expect(pending.attemptCount).toBe(1);
    await prisma.accountErasureAsset.update({ where: { id: pending.id }, data: { nextAttemptAt: new Date(0) } });
    storage.remove.mockResolvedValue(undefined);
    expect((await eraseAccountAssets()).details.deleted).toBe(1);
    expect(await prisma.productImage.count({ where: { url: retainedUrl } })).toBe(1);
    expect(await prisma.accountErasureAsset.count()).toBe(0);
  });

  it("keeps BAAM-only media encrypted, restricts adoption to its owner, and preserves an explicitly adopted company photo on erasure", async () => {
    const f = await seedBase({ plan: "BUSINESS" });
    await prisma.user.update({ where: { id: f.staffUser.id }, data: { passwordHash: await bcrypt.hash(password, 4) } });
    const conversation = await prisma.baamConversation.create({ data: { userId: f.staffUser.id, organizationId: f.org.id, title: "Private image" } });
    const bytes = Buffer.from("synthetic-image-bytes");
    const envelope = encryptBaamMedia(bytes, { organizationId: f.org.id, conversationId: conversation.id, mimeType: "image/png" });
    const attachment = await prisma.baamAttachment.create({ data: { conversationId: conversation.id, name: "private.png", mimeType: "image/png", url: envelope } });
    const context = (user: typeof f.staffUser) => ({ prisma, user: { id: user.id, organizationId: f.org.id, email: user.email, role: user.role, isOrgOwner: user.isOrgOwner, isPlatformOwner: false }, impersonator: null, impersonationSessionId: null, ip: null, requestId: "synthetic-private-adoption", logger: getLogger() });
    await expect(adoptBaamProductPhoto(context(f.managerUser), baamProductPhotoReference(attachment.id))).rejects.toThrow("baamAttachmentNotFound");
    expect(storage.upload).not.toHaveBeenCalled();
    const companyUrl = `/uploads/imported-products/${f.org.id}/products/${f.product.id}/adopted.png`;
    storage.upload.mockResolvedValue({ url: companyUrl, managed: true });
    expect(await adoptBaamProductPhoto(context(f.staffUser), baamProductPhotoReference(attachment.id), f.product.id)).toBe(companyUrl);
    expect(storage.upload).toHaveBeenCalledWith(expect.objectContaining({ buffer: bytes, organizationId: f.org.id, productId: f.product.id }));
    await prisma.productImage.create({ data: { organizationId: f.org.id, productId: f.product.id, url: companyUrl } });
    await deleteOwnAccount({ ...scope(f.staffUser), password, confirmation: "DELETE" });
    expect(await prisma.baamAttachment.count({ where: { id: attachment.id } })).toBe(0);
    expect(await prisma.accountErasureAsset.count()).toBe(0);
    expect(await prisma.productImage.count({ where: { url: companyUrl } })).toBe(1);
  });
});
