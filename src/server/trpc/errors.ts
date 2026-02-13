import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";

import { AppError } from "@/server/services/errors";

type TrpcErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_SERVER_ERROR";

const toTRPCCode = (code: string): TrpcErrorCode => {
  const allowed: TrpcErrorCode[] = [
    "BAD_REQUEST",
    "UNAUTHORIZED",
    "FORBIDDEN",
    "NOT_FOUND",
    "CONFLICT",
    "INTERNAL_SERVER_ERROR",
  ];
  return allowed.includes(code as TrpcErrorCode) ? (code as TrpcErrorCode) : "BAD_REQUEST";
};

const isInfraConnectionError = (error: unknown) => {
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const maybeCode = (error as Error & { code?: string }).code ?? "";
  if (["ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ECONNRESET"].includes(maybeCode)) {
    return true;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("timed out") ||
    message.includes("can't reach database server") ||
    message.includes("connection refused") ||
    message.includes("connection terminated") ||
    message.includes("p1001") ||
    message.includes("p1002")
  );
};

export const toTRPCError = (error: unknown) => {
  if (error instanceof TRPCError) {
    return error;
  }
  if (error instanceof AppError) {
    return new TRPCError({
      code: toTRPCCode(error.code),
      message: error.message,
    });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return new TRPCError({ code: "CONFLICT", message: "uniqueConstraintViolation" });
    }
    if (error.code === "P2025") {
      return new TRPCError({ code: "NOT_FOUND", message: "recordNotFound" });
    }
    if (error.code === "P2003") {
      return new TRPCError({ code: "BAD_REQUEST", message: "foreignKeyViolation" });
    }
  }
  if (error instanceof Prisma.PrismaClientValidationError) {
    return new TRPCError({ code: "BAD_REQUEST", message: "validationError" });
  }

  if (isInfraConnectionError(error)) {
    return new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "serviceUnavailable",
    });
  }

  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "genericMessage",
  });
};
