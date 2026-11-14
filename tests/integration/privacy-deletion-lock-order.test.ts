import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";
import { AI_PRIVACY_CONSENT_VERSION } from "@/lib/aiPrivacy";
import { prisma } from "@/server/db/prisma";
import { deleteOwnAccount } from "@/server/services/accountDeletion";
import { updateAiConsent } from "@/server/services/aiPrivacy";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};
const outcome = <T>(promise: Promise<T>) => promise.then(
  (value) => ({ status: "fulfilled" as const, value }),
  (reason: unknown) => ({ status: "rejected" as const, reason }),
);
const blockingWaiter = async (pid: number) => {
  const rows = await prisma.$queryRaw<Array<{ pid: number }>>`
    SELECT pid FROM pg_stat_activity
    WHERE datname = current_database() AND ${pid} = ANY(pg_blocking_pids(pid))
    ORDER BY pid
  `;
  return rows[0]?.pid;
};
const waitFor = async (read: () => Promise<boolean>) => {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (await read()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Synthetic privacy lock orchestration did not reach its expected wait");
};

describeDb("privacy changes concurrent with sole-owner erasure", () => {
  beforeEach(resetDatabase);

  it("commits consent withdrawal and account erasure without a User/AuditLog organization lock cycle", async () => {
    const fixture = await seedBase({ plan: "BUSINESS" });
    const password = "Synthetic-private-deletion-2026";
    await prisma.user.update({ where: { id: fixture.adminUser.id }, data: {
      passwordHash: await bcrypt.hash(password, 4),
      aiConsentVersion: AI_PRIVACY_CONSENT_VERSION, aiConsentGrantedAt: new Date(),
    } });
    await prisma.user.updateMany({
      where: { organizationId: fixture.org.id, id: { not: fixture.adminUser.id } },
      data: { isActive: false },
    });
    // The first ordered user is held independently so deletion has obtained its
    // organization lock but has not yet locked the consenting owner. Both
    // application operations below use their real transactions and FK checks.
    const blocker = await prisma.user.create({ data: {
      id: `000-privacy-blocker-${randomUUID()}`, organizationId: fixture.org.id,
      email: `privacy-blocker-${randomUUID()}@test.local`, name: "Inactive synthetic blocker",
      passwordHash: "unusable-synthetic-hash", role: "STAFF", isActive: false,
    } });
    const held = deferred(), release = deferred();
    let holderPid = 0;
    const holder = outcome(prisma.$transaction(async (tx) => {
      holderPid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0].pid;
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${blocker.id} FOR UPDATE`;
      held.resolve();
      await release.promise;
    }, { timeout: 12_000 }));
    await held.promise;
    let deletion: ReturnType<typeof outcome<{ deleted: true }>> | undefined;
    let withdrawal: ReturnType<typeof outcome<Awaited<ReturnType<typeof updateAiConsent>>>> | undefined;
    try {
      deletion = outcome(deleteOwnAccount({
        userId: fixture.adminUser.id, organizationId: fixture.org.id,
        password, confirmation: "DELETE", requestId: "synthetic-erasure-lock-order",
      }));
      let deletingPid: number | undefined;
      await waitFor(async () => Boolean(deletingPid = await blockingWaiter(holderPid)));
      let withdrawalSettled = false;
      withdrawal = outcome(updateAiConsent({
        userId: fixture.adminUser.id, organizationId: fixture.org.id,
        granted: false, version: AI_PRIVACY_CONSENT_VERSION,
        requestId: "synthetic-withdrawal-lock-order",
      })).then((result) => { withdrawalSettled = true; return result; });
      // Under the old locking order this observes the consent transaction
      // waiting on deletion's organization FK. Releasing the first user then
      // exposes a real PostgreSQL deadlock, rather than a mocked lock failure.
      await waitFor(async () => withdrawalSettled || Boolean(await blockingWaiter(deletingPid!)));
    } finally {
      release.resolve();
      expect((await holder).status).toBe("fulfilled");
    }
    const results = await Promise.all([deletion!, withdrawal!]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    const erased = await prisma.user.findUniqueOrThrow({ where: { id: fixture.adminUser.id } });
    expect(erased).toMatchObject({ isActive: false, isOrgOwner: false, aiConsentVersion: null });
    expect(erased.deletedAt).toBeInstanceOf(Date);
    expect(erased.aiConsentRevokedAt).toBeInstanceOf(Date);
    expect(await prisma.product.findUnique({ where: { id: fixture.product.id } })).not.toBeNull();
    expect(await prisma.auditLog.count({ where: {
      organizationId: fixture.org.id, action: "AI_PRIVACY_CONSENT_REVOKE",
    } })).toBe(1);
    expect(await prisma.auditLog.count({ where: {
      organizationId: fixture.org.id, action: "ACCOUNT_DELETED",
    } })).toBe(1);
  }, 18_000);
});
