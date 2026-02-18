import { AppError } from "@/server/services/errors";
import { connectorPullQueue } from "@/server/services/kkmConnector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const errorResponse = (error: unknown) => {
  if (error instanceof AppError) {
    return Response.json({ message: error.message }, { status: error.status });
  }
  return Response.json({ message: "genericMessage" }, { status: 500 });
};

export const GET = async (request: Request) => {
  const token = request.headers.get("x-connector-token") ?? "";
  if (!token) {
    return Response.json({ message: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "");
  const limit = Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : undefined;

  try {
    const items = await connectorPullQueue({ token, limit });
    return Response.json({ items }, { status: 200 });
  } catch (error) {
    return errorResponse(error);
  }
};
