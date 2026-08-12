import { CustomerOrderEmailStatus, CustomerOrderEmailType, type Prisma } from "@prisma/client";

const normalizeRecipientEmail = (value?: string | null) => {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
};

export const orderConfirmationEmailOperationKey = (customerOrderId: string) =>
  `customer-order-confirmation:${customerOrderId}`;

export const ownerOrderNotificationOperationKey = (customerOrderId: string, ownerId: string) =>
  `owner-new-order:${customerOrderId}:${ownerId}`;

export const queueOrderConfirmationEmailTx = (
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    storeId: string;
    customerOrderId: string;
    recipientEmail?: string | null;
    triggeredById?: string | null;
  },
) =>
  tx.customerOrderEmailLog.upsert({
    where: { operationKey: orderConfirmationEmailOperationKey(input.customerOrderId) },
    create: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      customerOrderId: input.customerOrderId,
      type: CustomerOrderEmailType.CONFIRMATION,
      status: CustomerOrderEmailStatus.QUEUED,
      recipientEmail: normalizeRecipientEmail(input.recipientEmail),
      operationKey: orderConfirmationEmailOperationKey(input.customerOrderId),
      nextAttemptAt: new Date(),
      triggeredById: input.triggeredById ?? null,
    },
    update: {},
  });

export const queueOwnerOrderNotificationTx = async (
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    storeId: string;
    customerOrderId: string;
  },
) => {
  const owner = await tx.user.findFirst({
    where: {
      organizationId: input.organizationId,
      isOrgOwner: true,
      isActive: true,
      emailVerifiedAt: { not: null },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, email: true },
  });
  const recipientEmail = normalizeRecipientEmail(owner?.email);
  if (!owner || !recipientEmail) return null;
  const operationKey = ownerOrderNotificationOperationKey(input.customerOrderId, owner.id);
  return tx.customerOrderEmailLog.upsert({
    where: { operationKey },
    create: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      customerOrderId: input.customerOrderId,
      type: CustomerOrderEmailType.OWNER_NOTIFICATION,
      status: CustomerOrderEmailStatus.QUEUED,
      recipientEmail,
      operationKey,
      nextAttemptAt: new Date(),
    },
    update: {},
  });
};
