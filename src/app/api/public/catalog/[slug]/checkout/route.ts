import { z } from "zod";

import { createCatalogCheckoutOrder } from "@/server/services/bazaarCatalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const checkoutSchema = z.object({
  customerName: z.string().trim().min(1).max(160),
  customerPhone: z.string().trim().min(1).max(64),
  comment: z.string().trim().max(2_000).optional().nullable(),
  lines: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        variantId: z.string().trim().min(1).optional().nullable(),
        qty: z.number().int().min(1),
      }),
    )
    .min(1),
});

const toMessage = (value: unknown) => (value instanceof Error ? value.message : "genericMessage");

export const POST = async (request: Request, context: { params: { slug: string } }) => {
  const body = await request.json().catch(() => null);
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ message: "invalidInput" }, { status: 400 });
  }

  try {
    const order = await createCatalogCheckoutOrder({
      slug: context.params.slug,
      customerName: parsed.data.customerName,
      customerPhone: parsed.data.customerPhone,
      comment: parsed.data.comment ?? null,
      lines: parsed.data.lines,
    });
    return Response.json(
      {
        order: {
          id: order.id,
          number: order.number,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    const message = toMessage(error);
    if (
      message === "invalidInput" ||
      message === "invalidQuantity" ||
      message === "salesOrderEmpty"
    ) {
      return Response.json({ message }, { status: 400 });
    }
    if (message === "catalogNotFound" || message === "productNotFound" || message === "variantNotFound") {
      return Response.json({ message }, { status: 404 });
    }
    return Response.json({ message: "genericMessage" }, { status: 500 });
  }
};
