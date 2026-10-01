import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { getSessionMember, LOYALTY_SESSION_COOKIE } from "@/server/services/loyalty/memberAuth";
import { approveLoyaltyConsent } from "@/server/services/loyalty/consent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const identity = () => getSessionMember(cookies().get(LOYALTY_SESSION_COOKIE)?.value ?? "");
export async function GET() {
  const context = await identity();
  if (!context) return Response.json({ message: "loyaltyUnauthorized" }, { status: 401 });
  const requests = await prisma.loyaltyRedemptionConsent.findMany({
    where: { organizationId: context.member.organizationId, memberId: context.member.id, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" }, take: 10,
    select: { id: true, customerOrderId: true, points: true, payableKgs: true, approvedAt: true, expiresAt: true },
  });
  const orders = await prisma.customerOrder.findMany({ where: { id: { in: requests.map((r) => r.customerOrderId) }, organizationId: context.member.organizationId, status: "DRAFT" }, select: { id: true, number: true, store: { select: { name: true } } } });
  const byId = new Map(orders.map((order) => [order.id, order]));
  return Response.json(requests.flatMap((request) => {
    const order = byId.get(request.customerOrderId);
    return order ? [{ id: request.id, number: order.number, store: order.store.name, points: request.points, payableKgs: Number(request.payableKgs), approved: Boolean(request.approvedAt), expiresAt: request.expiresAt }] : [];
  }));
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ message: "forbidden" }, { status: 403 });
  const context = await identity();
  if (!context) return Response.json({ message: "loyaltyUnauthorized" }, { status: 401 });
  const parsed = z.object({ id: z.string() }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: "invalidInput" }, { status: 400 });
  const approved = await approveLoyaltyConsent(cookies().get(LOYALTY_SESSION_COOKIE)?.value ?? "", parsed.data.id);
  return Response.json({ approved }, { status: approved ? 200 : 409 });
}
