import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";

export async function getLoyaltyHistory(organizationId: string, accountId: string, storeIds?: string[]) {
  if (storeIds && !storeIds.length) return [];
  const scoped = storeIds ? await Promise.all([
    prisma.$queryRaw<Array<{ id: string }>>`SELECT e.id FROM "LoyaltyLedgerEntry" e JOIN "CustomerOrder" o ON o.id = e."customerOrderId" WHERE e."organizationId" = ${organizationId} AND e."accountId" = ${accountId} AND o."organizationId" = ${organizationId} AND o."storeId" IN (${Prisma.join(storeIds)}) ORDER BY e."createdAt" DESC LIMIT 50`,
    prisma.$queryRaw<Array<{ id: string }>>`SELECT r.id FROM "LoyaltyReservation" r JOIN "CustomerOrder" o ON o.id = r."customerOrderId" WHERE r."organizationId" = ${organizationId} AND r."accountId" = ${accountId} AND o."organizationId" = ${organizationId} AND o."storeId" IN (${Prisma.join(storeIds)}) ORDER BY r."createdAt" DESC LIMIT 50`,
  ]) : null;
  const [entries, reservations] = await Promise.all([
    prisma.loyaltyLedgerEntry.findMany({ where: { organizationId, accountId, ...(scoped ? { id: { in: scoped[0].map(row => row.id) } } : {}) }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.loyaltyReservation.findMany({ where: { organizationId, accountId, ...(scoped ? { id: { in: scoped[1].map(row => row.id) } } : {}) }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const ids = [...new Set([...entries, ...reservations].flatMap((row) => row.customerOrderId ? [row.customerOrderId] : []))];
  const [orders, returns] = await Promise.all([
    prisma.customerOrder.findMany({ where: { organizationId, id: { in: ids }, ...(storeIds ? { storeId: { in: storeIds } } : {}) }, select: { id: true, number: true, isPosSale: true } }),
    prisma.saleReturn.findMany({ where: { organizationId, id: { in: entries.flatMap((row) => row.saleReturnId ? [row.saleReturnId] : []) }, ...(storeIds ? { storeId: { in: storeIds } } : {}) }, select: { id: true, number: true } }),
  ]);
  const orderMap = new Map(orders.map((row) => [row.id, row])); const returnMap = new Map(returns.map((row) => [row.id, row]));
  const reference = (orderId: string | null, returnId: string | null = null) => {
    const order = orderId ? orderMap.get(orderId) : null; const refund = returnId ? returnMap.get(returnId) : null;
    return { reference: refund?.number ?? order?.number ?? null, href: order ? order.isPosSale ? `/api/pos/receipts/${order.id}/pdf` : `/sales/orders/${order.id}` : null };
  };
  const history = entries.filter((entry) => !storeIds || (entry.customerOrderId && orderMap.has(entry.customerOrderId))).map((entry) => ({ id: entry.id, type: String(entry.type), points: entry.points, balanceAfter: entry.balanceAfter as number | null, createdAt: entry.createdAt.toISOString(), ...reference(entry.customerOrderId, entry.saleReturnId) }));
  for (const row of reservations) {
    if (storeIds && (!row.customerOrderId || !orderMap.has(row.customerOrderId))) continue;
    const ref = reference(row.customerOrderId);
    history.push({ id: `${row.id}:reserve`, type: "RESERVE", points: -row.points, balanceAfter: null, createdAt: row.createdAt.toISOString(), ...ref });
    const expired = row.status === "EXPIRED" || (row.status === "ACTIVE" && row.expiresAt <= new Date());
    if (row.status === "RELEASED" || expired) history.push({ id: `${row.id}:release`, type: expired ? "EXPIRE" : "RELEASE", points: row.points, balanceAfter: null, createdAt: (row.releasedAt ?? row.expiresAt).toISOString(), ...ref });
  }
  return history.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
}
