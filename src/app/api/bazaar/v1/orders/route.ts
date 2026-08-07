import { z } from "zod";

import {
  authenticateBazaarApiRequest,
  createBazaarApiOrderOperation,
  listBazaarApiOrders,
} from "@/server/services/bazaarApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const orderSchema = z.object({
  externalId: z.string().trim().min(1).max(160).optional().nullable(),
  customerName: z.string().trim().max(160).optional().nullable(),
  customerEmail: z.string().trim().email().max(254).optional().nullable(),
  customerPhone: z.string().trim().max(64).optional().nullable(),
  customerAddress: z.string().trim().max(512).optional().nullable(),
  comment: z.string().trim().max(2_000).optional().nullable(),
  lines: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        variantId: z.string().trim().min(1).optional().nullable(),
        qty: z.number().int().min(1),
      }),
    )
    .min(1)
    .max(500),
});

const ordersQuerySchema = z.object({
  status: z.string().trim().max(64).optional().nullable(),
  orderNumber: z.string().trim().max(80).optional().nullable(),
  number: z.string().trim().max(80).optional().nullable(),
  externalOrderId: z.string().trim().min(1).max(160).optional().nullable(),
  externalId: z.string().trim().min(1).max(160).optional().nullable(),
  dateFrom: z.string().trim().max(80).optional().nullable(),
  dateTo: z.string().trim().max(80).optional().nullable(),
  storeId: z.string().trim().max(128).optional().nullable(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().trim().max(256).optional().nullable(),
});

const toStatus = (message: string) => {
  if (message === "apiUnauthorized") {
    return 401;
  }
  if (
    message === "invalidInput" ||
    message === "invalidExternalOrderId" ||
    message === "idempotencyKeyRequired" ||
    message === "invalidQuantity" ||
    message === "salesOrderEmpty"
  ) {
    return 400;
  }
  if (
    message === "storeNotFound" ||
    message === "productNotFound" ||
    message === "variantNotFound"
  ) {
    return 404;
  }
  if (
    message === "externalOrderIdConflict" ||
    message === "operationRequestIdentityMismatch" ||
    message === "operationRequestPayloadMismatch" ||
    message === "operationRequestUnavailable" ||
    message === "operationRequestReconciliationRequired" ||
    message === "requestInProgress"
  ) {
    return 409;
  }
  return 500;
};

const parseDateQuery = (value: string | null | undefined, endOfDay = false) => {
  const normalized = value?.trim();
  if (!normalized) {
    return { ok: true as const, value: null };
  }
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(normalized);
  const date = new Date(
    dateOnly
      ? `${normalized}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`
      : normalized,
  );
  if (Number.isNaN(date.getTime())) {
    return { ok: false as const, value: null };
  }
  return { ok: true as const, value: date };
};

export const GET = async (request: Request) => {
  const url = new URL(request.url);
  const parsed = ordersQuerySchema.safeParse({
    status: url.searchParams.get("status"),
    orderNumber: url.searchParams.get("orderNumber"),
    number: url.searchParams.get("number"),
    externalOrderId: url.searchParams.get("externalOrderId"),
    externalId: url.searchParams.get("externalId"),
    dateFrom: url.searchParams.get("dateFrom"),
    dateTo: url.searchParams.get("dateTo"),
    storeId: url.searchParams.get("storeId"),
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor"),
  });
  if (!parsed.success) {
    return Response.json({ message: "invalidInput" }, { status: 400 });
  }

  const dateFrom = parseDateQuery(parsed.data.dateFrom);
  const dateTo = parseDateQuery(parsed.data.dateTo, true);
  if (!dateFrom.ok || !dateTo.ok) {
    return Response.json({ message: "invalidInput" }, { status: 400 });
  }

  try {
    const auth = await authenticateBazaarApiRequest(request);
    const result = await listBazaarApiOrders({
      organizationId: auth.organizationId,
      storeId: auth.storeId,
      status: parsed.data.status,
      orderNumber: parsed.data.orderNumber ?? parsed.data.number,
      externalOrderId: parsed.data.externalOrderId ?? parsed.data.externalId,
      dateFrom: dateFrom.value,
      dateTo: dateTo.value,
      storeIdFilter: parsed.data.storeId,
      limit: parsed.data.limit,
      cursor: parsed.data.cursor,
    });
    return Response.json(result, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "genericMessage";
    return Response.json({ message }, { status: toStatus(message) });
  }
};

export const POST = async (request: Request) => {
  const body = await request.json().catch(() => null);
  const parsed = orderSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ message: "invalidInput" }, { status: 400 });
  }

  try {
    const auth = await authenticateBazaarApiRequest(request);
    const suppliedIdempotencyKey = request.headers.get("idempotency-key")?.trim();
    const idempotencyKey =
      suppliedIdempotencyKey ||
      (parsed.data.externalId ? `external:${parsed.data.externalId}` : null);
    if (!idempotencyKey) {
      return Response.json({ message: "idempotencyKeyRequired" }, { status: 400 });
    }
    const operation = await createBazaarApiOrderOperation({
      organizationId: auth.organizationId,
      storeId: auth.storeId,
      apiKeyId: auth.apiKeyId,
      idempotencyKey,
      externalId: parsed.data.externalId,
      customerName: parsed.data.customerName,
      customerEmail: parsed.data.customerEmail,
      customerPhone: parsed.data.customerPhone,
      customerAddress: parsed.data.customerAddress,
      comment: parsed.data.comment,
      lines: parsed.data.lines,
    });
    return Response.json(operation.response, {
      status: operation.responseStatus,
      headers: {
        "idempotency-replayed": String(operation.replayed),
        "operation-request-id": operation.operationRequestId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "genericMessage";
    return Response.json({ message }, { status: toStatus(message) });
  }
};
