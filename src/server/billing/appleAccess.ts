import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { PLAN_CODES } from "@/lib/billing/plans";
import { planDefinitionSchema } from "./contractTerms";
const preservedSchema = z.object({ version: z.literal(1), plan: z.enum(PLAN_CODES), endsAt: z.string().datetime(), entitlements: planDefinitionSchema });
/** An immutable acknowledgement of access already approved before Apple was used.
 * It is not a payment, invoice, or claim that Apple bought the earlier period. */
export async function applePreservedAccess(db: Prisma.TransactionClient, organizationId: string, now = new Date()) {
  const rows = await db.$queryRaw<{ access: unknown }[]>`
    SELECT "offerSnapshot"->'preservedAccess' AS access FROM "ApplePurchaseIntent"
    WHERE "organizationId" = ${organizationId} AND scope = 'SUBSCRIPTION'
      AND jsonb_typeof("offerSnapshot"->'preservedAccess') = 'object'
      AND "offerSnapshot"->'preservedAccess'->>'endsAt' > ${now.toISOString()}`;
  const grants = rows.map((r) => preservedSchema.safeParse(r.access)).flatMap((r) => r.success ? [r.data] : []);
  grants.sort((a, b) => new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime());
  return grants[0] ?? null;
}
export async function captureApplePreservedAccess(db: Prisma.TransactionClient, org: {
  id: string; plan: string; currentPeriodEndsAt: Date | null; subscriptionBillingMode: string;
  entitlements: z.infer<typeof planDefinitionSchema>;
}) {
  if (org.subscriptionBillingMode !== "SELF_SERVE" || !org.currentPeriodEndsAt || org.currentPeriodEndsAt <= new Date()) return null;
  const backed = await db.subscriptionPeriod.findFirst({ where: { organizationId: org.id, revokedAt: null, dependencyRevokedAt: null, endsAt: org.currentPeriodEndsAt }, select: { id: true } });
  if (backed) return null;
  return preservedSchema.parse({ version: 1, plan: org.plan, endsAt: org.currentPeriodEndsAt.toISOString(), entitlements: org.entitlements });
}
