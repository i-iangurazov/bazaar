import { Prisma } from "@prisma/client";

import { AppError } from "@/server/services/errors";
import {
  OPERATION_FAILURE_AMBIGUOUS,
  OPERATION_FAILURE_SAFE_BEFORE_EFFECTS,
  type OperationFailureDecision,
} from "@/server/services/operationRequests";

/**
 * A handler-thrown domain error or a known Prisma transaction error rolls the
 * interactive transaction back before the OperationRequest failure is
 * finalized. Unknown client/runtime errors remain ambiguous because the caller
 * cannot prove whether PostgreSQL committed before the connection failed.
 */
export const classifyDatabaseOperationFailure = (
  error: unknown,
  responseCode: string,
): OperationFailureDecision => {
  const safelyRolledBack =
    error instanceof AppError ||
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientValidationError ||
    error instanceof Prisma.PrismaClientInitializationError;

  return {
    classification: safelyRolledBack
      ? OPERATION_FAILURE_SAFE_BEFORE_EFFECTS
      : OPERATION_FAILURE_AMBIGUOUS,
    responseCode,
    responseStatus: 500,
  };
};
