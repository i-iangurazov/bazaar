import { z } from "zod";

import {
  authenticateBazaarApiRequest,
  createBazaarApiOrder,
} from "@/server/services/bazaarApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const orderSchema = z.object({
  externalId: z.string().trim().max(160).optional().nullable(),
  customerName: z.string().trim().max(160).optional().nullable(),
  customerEmail: z.string().trim().email().max(254).optional().nullable(),
  customerPhone: z.string().trim().max(64).optional().nullable(),
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

const toStatus = (message: string) => {
  if (message === "apiUnauthorized") {
    return 401;
  }
  if (
    message === "invalidInput" ||
    message === "invalidQuantity" ||
    message === "salesOrderEmpty"
  ) {
    return 400;
  }
  if (message === "storeNotFound" || message === "productNotFound" || message === "variantNotFound") {
    return 404;
  }
  return 500;
};

export const POST = async (request: Request) => {
  const body = await request.json().catch(() => null);
  const parsed = orderSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ message: "invalidInput" }, { status: 400 });
  }

  try {
    const auth = await authenticateBazaarApiRequest(request);
    const order = await createBazaarApiOrder({
      organizationId: auth.organizationId,
      storeId: auth.storeId,
      externalId: parsed.data.externalId,
      customerName: parsed.data.customerName,
      customerEmail: parsed.data.customerEmail,
      customerPhone: parsed.data.customerPhone,
      comment: parsed.data.comment,
      lines: parsed.data.lines,
    });
    return Response.json({ order }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "genericMessage";
    return Response.json({ message }, { status: toStatus(message) });
  }
};
