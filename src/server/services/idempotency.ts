import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

import { AppError } from "@/server/services/errors";

export type IdempotencyContext = {
  key: string;
  route: string;
  userId: string;
  request?: Prisma.InputJsonValue;
};

const hashJson = (value: Prisma.InputJsonValue) =>
  createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");

export const withIdempotency = async <T>(
  tx: Prisma.TransactionClient,
  context: IdempotencyContext,
  handler: () => Promise<T>,
): Promise<{ result: T; replayed: boolean }> => {
  const requestHash = context.request === undefined ? null : hashJson(context.request);
  const existing = await tx.idempotencyKey.findUnique({
    where: {
      key_route_userId: {
        key: context.key,
        route: context.route,
        userId: context.userId,
      },
    },
  });

  if (existing && requestHash && existing.responseHash !== requestHash) {
    throw new AppError("idempotencyKeyPayloadMismatch", "CONFLICT", 409);
  }

  if (existing?.response) {
    return { result: existing.response as T, replayed: true };
  }

  if (existing && !existing.response) {
    throw new AppError("requestInProgress", "CONFLICT", 409);
  }

  try {
    await tx.idempotencyKey.create({
      data: {
        key: context.key,
        route: context.route,
        userId: context.userId,
      },
    });
  } catch (error) {
    const isUniqueViolation =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002";
    if (!isUniqueViolation) {
      throw error;
    }
    const retry = await tx.idempotencyKey.findUnique({
      where: {
        key_route_userId: {
          key: context.key,
          route: context.route,
          userId: context.userId,
        },
      },
    });
    if (retry && requestHash && retry.responseHash !== requestHash) {
      throw new AppError("idempotencyKeyPayloadMismatch", "CONFLICT", 409);
    }
    if (retry?.response) {
      return { result: retry.response as T, replayed: true };
    }
    throw error instanceof AppError ? error : new AppError("requestInProgress", "CONFLICT", 409);
  }

  const result = await handler();

  const response = result as Prisma.InputJsonValue;
  await tx.idempotencyKey.update({
    where: {
      key_route_userId: {
        key: context.key,
        route: context.route,
        userId: context.userId,
      },
    },
    data: {
      response,
      responseHash: requestHash ?? hashJson(response),
    },
  });

  return { result, replayed: false };
};
