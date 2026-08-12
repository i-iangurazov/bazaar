import { z } from "zod";

import {
  isValidOptionalCustomerAddress,
  isValidOptionalCustomerPhone,
} from "@/lib/customerContact";

import { authenticateBazaarApiRequest, createBazaarApiCustomer } from "@/server/services/bazaarApi";
import { mapBazaarApiError } from "@/app/api/bazaar/v1/error-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const customerSchema = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().min(1).max(64).refine(isValidOptionalCustomerPhone),
  address: z.string().trim().max(512).refine(isValidOptionalCustomerAddress).optional().nullable(),
});

export const POST = async (request: Request) => {
  const body = await request.json().catch(() => null);
  const parsed = customerSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ message: "invalidInput" }, { status: 400 });
  }

  try {
    const auth = await authenticateBazaarApiRequest(request);
    const result = await createBazaarApiCustomer({
      organizationId: auth.organizationId,
      storeId: auth.storeId,
      apiKeyId: auth.apiKeyId,
      name: parsed.data.name,
      email: parsed.data.email,
      phone: parsed.data.phone,
      address: parsed.data.address,
    });
    return Response.json(result, { status: result.action === "created" ? 201 : 200 });
  } catch (error) {
    const mapped = mapBazaarApiError(error, "customers.create");
    return Response.json({ message: mapped.message }, { status: mapped.status });
  }
};
