import { CustomerOrderEmailStatus, CustomerOrderEmailType, type Prisma } from "@prisma/client";

const normalizeRecipientEmail = (value?: string | null) => {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
};

export const orderConfirmationEmailOperationKey = (customerOrderId: string) =>
  `customer-order-confirmation:${customerOrderId}`;

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
