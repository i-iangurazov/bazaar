import type { Prisma } from "@prisma/client";
import { LIFETIME_ORGANIZATION_IDS } from "./lifetimeOrganizations";
import { readPurchaseSnapshot } from "./purchaseSnapshot";

type Organization = {
  id: string;
  subscriptionStatus: string;
  subscriptionContract: { lifetimeAccess: boolean } | null;
};
type Period = {
  id: string;
  organizationId: string;
  startsAt: Date;
  endsAt: Date;
  createdAt: Date;
  purchaseSnapshot: unknown;
  invoice: {
    organizationId: string;
    status: string;
    isTest: boolean;
    currency: string;
    paidAt: Date | null;
    providerPaymentId: string | null;
    amountMinor: number;
    events: { state: string; source: string }[];
  };
};

// A normalized, verified paid subscription value, not cash received this month,
// list-price potential, profit, or a promise that manual access has been paid.
export function summarizeConfirmedPaidMrr(
  organizations: Organization[],
  periods: Period[],
  now: Date,
) {
  const orgs = new Map(organizations.map((org) => [org.id, org]));
  const latest = new Map<string, Period>();
  const started = periods
    .filter((period) => period.startsAt <= now)
    .sort(
      (a, b) =>
        b.startsAt.getTime() - a.startsAt.getTime() ||
        b.createdAt.getTime() - a.createdAt.getTime() ||
        b.id.localeCompare(a.id),
    );
  for (const period of started)
    if (!latest.has(period.organizationId)) latest.set(period.organizationId, period);
  let monthlyMinor = 0;
  let organizationsPaid = 0;
  for (const period of latest.values()) {
    const org = orgs.get(period.organizationId);
    const invoice = period.invoice;
    if (
      !org ||
      org.subscriptionStatus !== "ACTIVE" ||
      org.subscriptionContract?.lifetimeAccess ||
      LIFETIME_ORGANIZATION_IDS.has(org.id) ||
      period.endsAt <= now ||
      invoice.organizationId !== org.id ||
      invoice.status !== "PAID" ||
      invoice.isTest ||
      invoice.currency !== "KGS" ||
      !invoice.paidAt ||
      invoice.paidAt > now ||
      !invoice.providerPaymentId ||
      invoice.amountMinor <= 0 ||
      !invoice.events.some(
        (event) => event.state === "PAID" && ["CALLBACK", "RECONCILIATION"].includes(event.source),
      )
    )
      continue;
    try {
      const purchase = readPurchaseSnapshot(period.purchaseSnapshot);
      if (purchase && purchase.organizationId !== org.id) continue;
      // A renewal invoice contains the whole prepaid term. An upgrade invoice
      // contains only the difference after credit, so use the replacement plan's
      // frozen monthly price with its original term discount, including add-ons.
      const value = purchase
        ? purchase.kind === "UPGRADE"
          ? Math.round((purchase.monthlyMinor * (10_000 - purchase.discountBps)) / 10_000)
          : Math.round(invoice.amountMinor / purchase.months)
        : invoice.amountMinor; // Original gateway invoices were one-month grants.
      if (!Number.isSafeInteger(value) || value <= 0) continue;
      monthlyMinor += value;
      organizationsPaid += 1;
    } catch {
      // Invalid historical snapshots require review, not fabricated revenue.
    }
  }
  return { organizationsPaid, confirmedPaidMrrKgs: monthlyMinor / 100 };
}

export async function getConfirmedPaidMrr(
  db: Prisma.TransactionClient,
  organizations: Organization[],
  now = new Date(),
) {
  const periods = await db.subscriptionPeriod.findMany({
    where: { startsAt: { lte: now }, endsAt: { gt: now } },
    select: {
      id: true,
      organizationId: true,
      startsAt: true,
      endsAt: true,
      createdAt: true,
      purchaseSnapshot: true,
      invoice: {
        select: {
          organizationId: true,
          status: true,
          isTest: true,
          currency: true,
          paidAt: true,
          providerPaymentId: true,
          amountMinor: true,
          events: {
            where: { state: "PAID", source: { in: ["CALLBACK", "RECONCILIATION"] } },
            select: { state: true, source: true },
            take: 1,
          },
        },
      },
    },
  });
  return summarizeConfirmedPaidMrr(organizations, periods, now);
}
