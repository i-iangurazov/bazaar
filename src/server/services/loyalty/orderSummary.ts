import { availablePoints, type LoyaltyTx } from "./ledger";

/** Callers authorize access to the order's organization and store first. */
export async function getLoyaltyOrderSummary(
  tx: LoyaltyTx,
  organizationId: string,
  customerOrderId: string,
) {
  const application = await tx.loyaltyOrderApplication.findFirst({
    where: { customerOrderId, organizationId },
  });
  if (!application) return null;
  const [member, account, entries] = await Promise.all([
    tx.loyaltyMember.findFirst({
      where: { id: application.memberId, organizationId },
      select: { id: true, displayName: true, email: true, phoneNormalized: true },
    }),
    tx.loyaltyAccount.findFirst({ where: { id: application.accountId, organizationId } }),
    tx.loyaltyLedgerEntry.findMany({
      where: { customerOrderId, organizationId },
      orderBy: { createdAt: "asc" },
      select: { id: true, type: true, points: true, createdAt: true },
    }),
  ]);
  const released = application.status === "RELEASED";
  return {
    status: application.status,
    member: member
      ? {
          memberId: member.id,
          displayName: member.displayName ?? member.email ?? member.phoneNormalized,
          email: member.email,
          phone: member.phoneNormalized,
        }
      : null,
    balancePoints: account?.balancePoints ?? 0,
    availablePoints: account ? await availablePoints(tx, account.id) : 0,
    memberDiscountKgs: released ? 0 : Number(application.memberDiscountKgs),
    pointsSpent: released ? 0 : application.pointsSpent,
    pointsEarned: entries
      .filter((entry) => entry.type === "EARN")
      .reduce((sum, entry) => sum + entry.points, 0),
    plannedPoints: released ? 0 : application.pointsEarned,
    hasEarned: entries.some((entry) => entry.type === "EARN"),
    entries: entries.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
  };
}
