import { AppError } from "@/server/services/errors";
import { connectorPushResult } from "@/server/services/kkmConnector";

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

  const body = (await request.json().catch(() => null)) as
    | {
        receiptId?: string;
        status?: "SENT" | "FAILED";
        providerReceiptId?: string | null;
        fiscalNumber?: string | null;
        qr?: string | null;
        errorMessage?: string | null;
      }
    | null;

  if (!body?.receiptId || (body.status !== "SENT" && body.status !== "FAILED")) {
    return Response.json({ message: "invalidInput" }, { status: 400 });
  }

  try {
    const result = await connectorPushResult({
      token,
      receiptId: body.receiptId,
      status: body.status,
      providerReceiptId: body.providerReceiptId ?? null,
      fiscalNumber: body.fiscalNumber ?? null,
      qr: body.qr ?? null,
      errorMessage: body.errorMessage ?? null,
    });
    return Response.json(result, { status: 200 });
  } catch (error) {
    return errorResponse(error);
  }
};
