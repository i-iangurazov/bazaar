import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { assertUserCanAccessStore, listAccessibleStores } from "@/server/services/storeAccess";
import {
  getOrganizationPlan,
  hasActivePaidOrApprovedSubscription,
} from "@/server/services/planLimits";
import type { AuthUser } from "@/server/trpc/trpc";
import { whatsappKnowledgeSchema, whatsappProfileSchema } from "@/lib/whatsapp-ai";

export type WhatsAppDb = PrismaClient | Prisma.TransactionClient;
export type WhatsAppActor = Pick<AuthUser, "id" | "organizationId">;

export async function whatsappActor(actor: WhatsAppActor, db: WhatsAppDb = prisma, admin = false) {
  const current = await db.user.findFirst({
    where: { id: actor.id, organizationId: actor.organizationId, isActive: true },
    select: { id: true, organizationId: true, role: true, isOrgOwner: true },
  });
  if (
    !current?.organizationId ||
    !["ADMIN", "MANAGER"].includes(current.role) ||
    (admin && current.role !== "ADMIN" && !current.isOrgOwner)
  )
    throw new AppError("forbidden", "FORBIDDEN", 403);
  return { ...current, organizationId: current.organizationId };
}

export async function whatsappAccess(
  actor: WhatsAppActor,
  storeId: string,
  options: { admin?: boolean; active?: boolean } = {},
  db: WhatsAppDb = prisma,
) {
  const user = await whatsappActor(actor, db, options.admin);
  await assertUserCanAccessStore(db, user, storeId);
  const org = await getOrganizationPlan(user.organizationId, db);
  const entitled = org.plan === "BUSINESS" || org.plan === "ENTERPRISE" || org.lifetimeAccess;
  const active = hasActivePaidOrApprovedSubscription(org);
  if (options.active && (!entitled || !active))
    throw new AppError("whatsappPlanRequired", "FORBIDDEN", 403);
  return { user, org, entitled, active };
}

export async function whatsappStores(actor: WhatsAppActor) {
  const user = await whatsappActor(actor);
  const stores = await listAccessibleStores(prisma, user);
  return stores.map(({ id, name, currencyCode }) => ({ id, name, currencyCode }));
}

export async function whatsappConnection(
  actor: WhatsAppActor,
  storeId: string,
  options: { admin?: boolean; active?: boolean } = {},
  db: WhatsAppDb = prisma,
) {
  const access = await whatsappAccess(actor, storeId, options, db);
  const connection = await db.whatsAppConnection.findUnique({
    where: { organizationId_storeId: { organizationId: actor.organizationId, storeId } },
  });
  return { ...access, connection };
}

export async function ensureWhatsAppDraft(actor: WhatsAppActor, storeId: string) {
  await whatsappAccess(actor, storeId, { active: true });
  const store = await prisma.store.findFirstOrThrow({
    where: { id: storeId, organizationId: actor.organizationId },
  });
  return prisma.whatsAppConnection.upsert({
    where: { organizationId_storeId: { organizationId: actor.organizationId, storeId } },
    create: {
      organizationId: actor.organizationId,
      storeId,
      profile: whatsappProfileSchema.parse({}),
      knowledge: whatsappKnowledgeSchema.parse({ storeName: store.name }),
    },
    update: {},
  });
}

/** One advisory lock for quota, invoice grants and cancellation; never hold over HTTP. */
export async function whatsappOrganizationLock<T>(
  organizationId: string,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp:${organizationId}`}, 0))`;
      return run(tx);
    },
    { timeout: 15000 },
  );
}

export async function whatsappConversationAccess(
  actor: WhatsAppActor,
  conversationId: string,
  options: { active?: boolean } = {},
) {
  const conversation = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, organizationId: actor.organizationId },
  });
  if (!conversation) throw new AppError("recordNotFound", "NOT_FOUND", 404);
  await whatsappAccess(actor, conversation.storeId, options);
  return conversation;
}
