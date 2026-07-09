import {
  authenticateBazaarApiRequest,
  getBazaarApiOrder,
} from "@/server/services/bazaarApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: {
    id: string;
  };
};

const toStatus = (message: string) => {
  if (message === "apiUnauthorized") {
    return 401;
  }
  if (message === "invalidInput") {
    return 400;
  }
  if (message === "orderNotFound") {
    return 404;
  }
  return 500;
};

const errorBody = (message: string) => {
  if (message === "orderNotFound") {
    return { error: "ORDER_NOT_FOUND" };
  }
  return { message };
};

export const GET = async (request: Request, { params }: RouteParams) => {
  try {
    const auth = await authenticateBazaarApiRequest(request);
    const order = await getBazaarApiOrder({
      organizationId: auth.organizationId,
      storeId: auth.storeId,
      identifier: params.id,
    });
    return Response.json({ order }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "genericMessage";
    return Response.json(errorBody(message), { status: toStatus(message) });
  }
};
