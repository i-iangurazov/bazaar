import { AppError } from "@/server/services/errors";
import { connectorHeartbeat } from "@/server/services/kkmConnector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const errorResponse = (error: unknown) => {
  if (error instanceof AppError) {
    return Response.json({ message: error.message }, { status: error.status });
  }
  return Response.json({ message: "genericMessage" }, { status: 500 });
};

export const POST = async (request: Request) => {
  const token = request.headers.get("x-connector-token") ?? "";
  if (!token) {
    return Response.json({ message: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await connectorHeartbeat(token);
    return Response.json(result, { status: 200 });
  } catch (error) {
    return errorResponse(error);
  }
};
