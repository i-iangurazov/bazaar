import { createHash, randomUUID } from "node:crypto";
import {
  OperationRequestPrincipalType,
  OperationRequestStatus,
  Prisma,
  type OperationRequest,
} from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";

export const OPERATION_RESPONSE_MAX_BYTES = 32 * 1024;
// OperationRequest rows are replay windows, not permanent business identity.
// Internal/public commands default to 30 days. Bazaar API order creation must
// pass a 90-day expiresAt; its permanent identity is CustomerOrder.externalOrderId.
export const OPERATION_DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const OPERATION_BAZAAR_API_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

const DEFAULT_LEASE_DURATION_MS = 60_000;
const MIN_LEASE_DURATION_MS = 1_000;
const MAX_LEASE_DURATION_MS = 15 * 60 * 1000;
const MAX_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
export const OPERATION_FAILURE_SAFE_BEFORE_EFFECTS = "SAFE_BEFORE_EFFECTS";
export const OPERATION_FAILURE_AMBIGUOUS = "AMBIGUOUS";

const principalPrefixByType = {
  [OperationRequestPrincipalType.AUTHENTICATED_USER]: "user",
  [OperationRequestPrincipalType.API_KEY]: "api-key",
  [OperationRequestPrincipalType.ANONYMOUS_CATALOG]: "catalog",
} satisfies Record<OperationRequestPrincipalType, string>;

const sensitiveResponseKeyPattern =
  /(password|passwd|secret|token|apikey|authorization|cookie|credential|privatekey|cardnumber|cvv|cvc)/i;
const responseCodePattern = /^[A-Za-z0-9_.:-]+$/;
const responsePathPattern = /^[A-Za-z0-9_]+(?:\[\])?(?:\.[A-Za-z0-9_]+(?:\[\])?)*$/;

export type OperationPrincipal = {
  type: OperationRequestPrincipalType;
  id: string;
};

export type OperationPayload = {
  version: string;
  value: Prisma.InputJsonValue;
};

export type OperationFailureClassification =
  | typeof OPERATION_FAILURE_SAFE_BEFORE_EFFECTS
  | typeof OPERATION_FAILURE_AMBIGUOUS;

export type OperationFailureDecision = {
  classification: OperationFailureClassification;
  responseCode: string;
  responseStatus?: number;
};

export type OperationHandlerResult<TResponse extends Prisma.InputJsonObject> = {
  response: TResponse;
  responseStatus: number;
  responseCode?: string | null;
  resource?: {
    type: string;
    id: string;
  } | null;
};

export type RunOperationRequestInput = {
  organizationId: string;
  storeId?: string | null;
  scope: string;
  principal: OperationPrincipal;
  idempotencyKey: string;
  payload: OperationPayload;
  allowedResponsePaths: readonly string[];
  expiresAt?: Date;
  leaseDurationMs?: number;
  classifyFailure?: (error: unknown) => OperationFailureDecision;
};

export type OperationRequestResult<TResponse extends Prisma.InputJsonObject> = {
  operationRequestId: string;
  response: TResponse;
  responseStatus: number;
  responseCode: string | null;
  resource: { type: string; id: string } | null;
  replayed: boolean;
};

type ValidatedOperationInput = {
  organizationId: string;
  storeId: string | null;
  scope: string;
  principalType: OperationRequestPrincipalType;
  principalKey: string;
  idempotencyKey: string;
  requestFingerprint: string;
  allowedResponsePaths: ReadonlySet<string>;
  expiresAt: Date;
  leaseDurationMs: number;
  classifyFailure?: (error: unknown) => OperationFailureDecision;
};

type OperationExecutionClaim<TResponse extends Prisma.InputJsonObject> =
  | {
      kind: "execute";
      operationRequestId: string;
      leaseToken: string;
    }
  | {
      kind: "replay";
      result: OperationRequestResult<TResponse>;
    };

class SafeOperationFailure extends AppError {
  public readonly operationResponseCode: string;

  constructor(message: string, responseCode = message) {
    super(message, "INTERNAL_SERVER_ERROR", 500);
    this.operationResponseCode = responseCode;
  }
}

const canonicalizeJsonValue = (value: unknown, path: string): string => {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new AppError("invalidInput", "BAD_REQUEST", 400);
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((entry, index) => canonicalizeJsonValue(entry, `${path}[${index}]`))
      .join(",")}]`;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new AppError("invalidInput", "BAD_REQUEST", 400);
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((key) => {
        const entry = record[key];
        if (entry === undefined) {
          throw new AppError("invalidInput", "BAD_REQUEST", 400);
        }
        return `${JSON.stringify(key)}:${canonicalizeJsonValue(entry, `${path}.${key}`)}`;
      })
      .join(",")}}`;
  }
  throw new AppError("invalidInput", "BAD_REQUEST", 400);
};

export const canonicalizeOperationPayload = (payload: OperationPayload) => {
  const version = payload.version.trim();
  if (!version || version.length > 64) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  return canonicalizeJsonValue({ version, value: payload.value }, "request");
};

export const fingerprintOperationRequest = (input: {
  storeId: string | null;
  payload: OperationPayload;
}) =>
  createHash("sha256")
    .update(
      canonicalizeJsonValue(
        {
          storeId: input.storeId,
          payload: JSON.parse(canonicalizeOperationPayload(input.payload)) as unknown,
        },
        "request",
      ),
    )
    .digest("hex");

export const operationPrincipalKey = (principal: OperationPrincipal) => {
  const id = principal.id.trim();
  const prefix = principalPrefixByType[principal.type];
  if (!prefix || !id || id.length > 191 || id.includes(":")) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  return `${prefix}:${id}`;
};

const boundedText = (value: string, maxLength: number) => {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  return normalized;
};

const validateSuccessResponseStatus = (status: number) => {
  if (!Number.isInteger(status) || status < 200 || status > 299) {
    throw new SafeOperationFailure("operationResponseInvalid");
  }
  return status;
};

const validateFailureResponseStatus = (status: number) => {
  if (!Number.isInteger(status) || status < 400 || status > 599) {
    throw new SafeOperationFailure("operationResponseInvalid");
  }
  return status;
};

const validateResponseCode = (code?: string | null) => {
  if (code === null || code === undefined) return null;
  const normalized = code.trim();
  if (!normalized || normalized.length > 120 || !responseCodePattern.test(normalized)) {
    throw new SafeOperationFailure("operationResponseInvalid");
  }
  return normalized;
};

const validateResource = (resource?: { type: string; id: string } | null) => {
  if (!resource) return null;
  const type = resource.type.trim();
  const id = resource.id.trim();
  if (!type || type.length > 80 || !id || id.length > 191) {
    throw new SafeOperationFailure("operationResponseInvalid");
  }
  return {
    type,
    id,
  };
};

const validateAllowedResponsePaths = (paths: readonly string[]) => {
  if (!paths.length) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  const allowed = new Set<string>();
  for (const rawPath of paths) {
    const path = rawPath.trim();
    if (!path || path.length > 240 || !responsePathPattern.test(path)) {
      throw new AppError("invalidInput", "BAD_REQUEST", 400);
    }
    const segments = path.replaceAll("[]", "").split(".");
    if (segments.some((segment) => sensitiveResponseKeyPattern.test(segment))) {
      throw new AppError("invalidInput", "BAD_REQUEST", 400);
    }
    allowed.add(path);
  }
  return allowed;
};

const validateResponseObject = (
  value: unknown,
  allowedPaths: ReadonlySet<string>,
  currentPath = "",
): void => {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) {
      validateResponseObject(entry, allowedPaths, `${currentPath}[]`);
    }
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (sensitiveResponseKeyPattern.test(key)) {
      throw new SafeOperationFailure("operationResponseSensitiveData");
    }
    const path = currentPath ? `${currentPath}.${key}` : key;
    if (!allowedPaths.has(path)) {
      throw new SafeOperationFailure("operationResponseFieldNotAllowed");
    }
    validateResponseObject(entry, allowedPaths, path);
  }
};

const serializeResponse = (response: Prisma.InputJsonObject, allowedPaths: ReadonlySet<string>) => {
  let serialized: string;
  try {
    serialized = JSON.stringify(response);
  } catch {
    throw new SafeOperationFailure("operationResponseInvalid");
  }
  if (!serialized) {
    throw new SafeOperationFailure("operationResponseInvalid");
  }
  const responseBytes = Buffer.byteLength(serialized, "utf8");
  if (responseBytes > OPERATION_RESPONSE_MAX_BYTES) {
    throw new SafeOperationFailure("operationResponseTooLarge");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new SafeOperationFailure("operationResponseInvalid");
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new SafeOperationFailure("operationResponseInvalid");
  }
  validateResponseObject(parsed, allowedPaths);
  return {
    response: parsed as Prisma.InputJsonObject,
    responseBytes,
  };
};

const validateOperationInput = (input: RunOperationRequestInput): ValidatedOperationInput => {
  const organizationId = boundedText(input.organizationId, 191);
  const storeId = input.storeId ? boundedText(input.storeId, 191) : null;
  const scope = boundedText(input.scope, 120);
  const idempotencyKey = boundedText(input.idempotencyKey, 256);
  if (idempotencyKey.length < 8) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  const leaseDurationMs = input.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  if (
    !Number.isInteger(leaseDurationMs) ||
    leaseDurationMs < MIN_LEASE_DURATION_MS ||
    leaseDurationMs > MAX_LEASE_DURATION_MS
  ) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  const now = Date.now();
  const expiresAt = input.expiresAt ?? new Date(now + OPERATION_DEFAULT_RETENTION_MS);
  const retentionMs = expiresAt.getTime() - now;
  if (!Number.isFinite(expiresAt.getTime()) || retentionMs <= 0 || retentionMs > MAX_RETENTION_MS) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  return {
    organizationId,
    storeId,
    scope,
    principalType: input.principal.type,
    principalKey: operationPrincipalKey(input.principal),
    idempotencyKey,
    requestFingerprint: fingerprintOperationRequest({ storeId, payload: input.payload }),
    allowedResponsePaths: validateAllowedResponsePaths(input.allowedResponsePaths),
    expiresAt,
    leaseDurationMs,
    classifyFailure: input.classifyFailure,
  };
};

const lockOperationRequest = async (tx: Prisma.TransactionClient, operationRequestId: string) => {
  await tx.$queryRaw`
    SELECT "id" FROM "OperationRequest"
    WHERE "id" = ${operationRequestId}
    FOR UPDATE
  `;
  return tx.operationRequest.findUnique({ where: { id: operationRequestId } });
};

const assertRequestIdentity = (row: OperationRequest, input: ValidatedOperationInput) => {
  if (
    row.organizationId !== input.organizationId ||
    row.storeId !== input.storeId ||
    row.scope !== input.scope ||
    row.principalType !== input.principalType ||
    row.principalKey !== input.principalKey ||
    row.idempotencyKey !== input.idempotencyKey
  ) {
    throw new AppError("operationRequestIdentityMismatch", "CONFLICT", 409);
  }
  if (row.requestFingerprint !== input.requestFingerprint) {
    throw new AppError("operationRequestPayloadMismatch", "CONFLICT", 409);
  }
};

const resultFromCompletedRow = <TResponse extends Prisma.InputJsonObject>(
  row: OperationRequest,
  allowedResponsePaths: ReadonlySet<string>,
  replayed: boolean,
): OperationRequestResult<TResponse> => {
  if (
    row.status !== OperationRequestStatus.COMPLETED ||
    !row.response ||
    row.responseBytes === null ||
    row.responseStatus === null
  ) {
    throw new AppError("operationRequestCorrupt", "INTERNAL_SERVER_ERROR", 500);
  }
  const serialized = serializeResponse(
    row.response as Prisma.InputJsonObject,
    allowedResponsePaths,
  );
  if (serialized.responseBytes !== row.responseBytes) {
    throw new AppError("operationRequestCorrupt", "INTERNAL_SERVER_ERROR", 500);
  }
  if (Boolean(row.resourceType) !== Boolean(row.resourceId)) {
    throw new AppError("operationRequestCorrupt", "INTERNAL_SERVER_ERROR", 500);
  }
  return {
    operationRequestId: row.id,
    response: serialized.response as TResponse,
    responseStatus: validateSuccessResponseStatus(row.responseStatus),
    responseCode: validateResponseCode(row.responseCode),
    resource:
      row.resourceType && row.resourceId ? { type: row.resourceType, id: row.resourceId } : null,
    replayed,
  };
};

const claimOperationRequest = async <TResponse extends Prisma.InputJsonObject>(
  input: ValidatedOperationInput,
): Promise<OperationExecutionClaim<TResponse>> => {
  const operationRequestId = randomUUID();
  const leaseToken = randomUUID();
  const claimedAt = new Date();
  const leaseExpiresAt = new Date(claimedAt.getTime() + input.leaseDurationMs);

  return prisma.$transaction(async (tx) => {
    if (input.storeId) {
      const store = await tx.store.findFirst({
        where: { id: input.storeId, organizationId: input.organizationId },
        select: { id: true },
      });
      if (!store) {
        throw new AppError("storeNotFound", "NOT_FOUND", 404);
      }
    }

    const inserted = await tx.operationRequest.createMany({
      data: [
        {
          id: operationRequestId,
          organizationId: input.organizationId,
          storeId: input.storeId,
          scope: input.scope,
          principalType: input.principalType,
          principalKey: input.principalKey,
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: input.requestFingerprint,
          status: OperationRequestStatus.PROCESSING,
          attemptCount: 1,
          processingStartedAt: claimedAt,
          leaseToken,
          leaseExpiresAt,
          lastAttemptAt: claimedAt,
          expiresAt: input.expiresAt,
        },
      ],
      skipDuplicates: true,
    });

    if (inserted.count === 1) {
      return { kind: "execute", operationRequestId, leaseToken };
    }

    const existing = await tx.operationRequest.findUnique({
      where: {
        organizationId_scope_principalKey_idempotencyKey: {
          organizationId: input.organizationId,
          scope: input.scope,
          principalKey: input.principalKey,
          idempotencyKey: input.idempotencyKey,
        },
      },
      select: { id: true },
    });
    if (!existing) {
      throw new AppError("operationRequestUnavailable", "CONFLICT", 409);
    }

    const row = await lockOperationRequest(tx, existing.id);
    if (!row) {
      throw new AppError("operationRequestUnavailable", "CONFLICT", 409);
    }
    assertRequestIdentity(row, input);

    if (row.status === OperationRequestStatus.COMPLETED) {
      return {
        kind: "replay",
        result: resultFromCompletedRow<TResponse>(row, input.allowedResponsePaths, true),
      };
    }

    const reevaluatedAt = new Date();
    const mayRetryFailed =
      row.status === OperationRequestStatus.FAILED &&
      row.errorClassification === OPERATION_FAILURE_SAFE_BEFORE_EFFECTS;
    let mayTakeExpiredLease = false;
    if (row.status === OperationRequestStatus.PROCESSING) {
      const hasUnambiguousLease =
        Boolean(row.leaseToken) &&
        Boolean(row.leaseExpiresAt) &&
        !row.resourceType &&
        !row.resourceId &&
        row.errorClassification !== OPERATION_FAILURE_AMBIGUOUS;
      if (!hasUnambiguousLease) {
        throw new AppError("operationRequestReconciliationRequired", "CONFLICT", 409);
      }
      if (row.leaseExpiresAt && row.leaseExpiresAt > reevaluatedAt) {
        throw new AppError("requestInProgress", "CONFLICT", 409);
      }
      mayTakeExpiredLease = true;
    }
    if (row.status === OperationRequestStatus.FAILED && !mayRetryFailed) {
      throw new AppError("operationRequestReconciliationRequired", "CONFLICT", 409);
    }
    if (!mayRetryFailed && !mayTakeExpiredLease) {
      throw new AppError("operationRequestUnavailable", "CONFLICT", 409);
    }

    const nextLeaseToken = randomUUID();
    await tx.operationRequest.update({
      where: { id: row.id },
      data: {
        status: OperationRequestStatus.PROCESSING,
        attemptCount: { increment: 1 },
        processingStartedAt: reevaluatedAt,
        leaseToken: nextLeaseToken,
        leaseExpiresAt: new Date(reevaluatedAt.getTime() + input.leaseDurationMs),
        lastAttemptAt: reevaluatedAt,
        responseStatus: null,
        responseCode: null,
        response: Prisma.DbNull,
        responseBytes: null,
        errorClassification: null,
        completedAt: null,
        failedAt: null,
        expiresAt: input.expiresAt,
      },
    });
    return { kind: "execute", operationRequestId: row.id, leaseToken: nextLeaseToken };
  });
};

const safeFailureDecision = (
  error: unknown,
  classifier?: (error: unknown) => OperationFailureDecision,
): OperationFailureDecision => {
  if (error instanceof SafeOperationFailure) {
    return {
      classification: OPERATION_FAILURE_SAFE_BEFORE_EFFECTS,
      responseCode: error.operationResponseCode,
      responseStatus: 500,
    };
  }
  if (!classifier) {
    return {
      classification: OPERATION_FAILURE_AMBIGUOUS,
      responseCode: "operationRequestFailed",
      responseStatus: 500,
    };
  }
  try {
    const decision = classifier(error);
    if (
      decision.classification !== OPERATION_FAILURE_SAFE_BEFORE_EFFECTS &&
      decision.classification !== OPERATION_FAILURE_AMBIGUOUS
    ) {
      throw new Error("invalid classification");
    }
    return {
      classification: decision.classification,
      responseCode: validateResponseCode(decision.responseCode) ?? "operationRequestFailed",
      responseStatus: validateFailureResponseStatus(decision.responseStatus ?? 500),
    };
  } catch {
    return {
      classification: OPERATION_FAILURE_AMBIGUOUS,
      responseCode: "operationRequestFailed",
      responseStatus: 500,
    };
  }
};

const finalizeOperationFailure = async <TResponse extends Prisma.InputJsonObject>(input: {
  operationRequestId: string;
  leaseToken: string;
  request: ValidatedOperationInput;
  failure: OperationFailureDecision;
}): Promise<OperationRequestResult<TResponse> | null> =>
  prisma.$transaction(async (tx) => {
    const row = await lockOperationRequest(tx, input.operationRequestId);
    if (!row) return null;
    assertRequestIdentity(row, input.request);
    if (row.status === OperationRequestStatus.COMPLETED) {
      return resultFromCompletedRow<TResponse>(row, input.request.allowedResponsePaths, false);
    }
    if (row.status !== OperationRequestStatus.PROCESSING || row.leaseToken !== input.leaseToken) {
      return null;
    }
    const failedAt = new Date();
    await tx.operationRequest.update({
      where: { id: row.id },
      data: {
        status: OperationRequestStatus.FAILED,
        responseStatus: input.failure.responseStatus ?? 500,
        responseCode: input.failure.responseCode,
        response: Prisma.DbNull,
        responseBytes: null,
        errorClassification: input.failure.classification,
        leaseToken: null,
        leaseExpiresAt: null,
        failedAt,
        completedAt: null,
      },
    });
    return null;
  });

/**
 * The handler is a database-only command boundary. It must perform every domain
 * write through the supplied transaction and must not call providers, publish
 * events, or perform other irreversible work. Post-commit effects are reconciled
 * separately using the persisted resource identity and their own idempotency.
 */
export const runOperationRequest = async <TResponse extends Prisma.InputJsonObject>(
  input: RunOperationRequestInput,
  handler: (tx: Prisma.TransactionClient) => Promise<OperationHandlerResult<TResponse>>,
): Promise<OperationRequestResult<TResponse>> => {
  const request = validateOperationInput(input);
  const claim = await claimOperationRequest<TResponse>(request);
  if (claim.kind === "replay") return claim.result;

  try {
    return await prisma.$transaction(async (tx) => {
      const row = await lockOperationRequest(tx, claim.operationRequestId);
      if (!row) {
        throw new AppError("operationRequestUnavailable", "CONFLICT", 409);
      }
      assertRequestIdentity(row, request);
      if (row.status === OperationRequestStatus.COMPLETED) {
        return resultFromCompletedRow<TResponse>(row, request.allowedResponsePaths, true);
      }
      if (row.status !== OperationRequestStatus.PROCESSING || row.leaseToken !== claim.leaseToken) {
        throw new AppError("requestInProgress", "CONFLICT", 409);
      }

      const handled = await handler(tx);
      const serialized = serializeResponse(handled.response, request.allowedResponsePaths);
      const responseStatus = validateSuccessResponseStatus(handled.responseStatus);
      const responseCode = validateResponseCode(handled.responseCode);
      const resource = validateResource(handled.resource);
      const completedAt = new Date();

      await tx.operationRequest.update({
        where: { id: row.id },
        data: {
          status: OperationRequestStatus.COMPLETED,
          responseStatus,
          responseCode,
          response: serialized.response,
          responseBytes: serialized.responseBytes,
          resourceType: resource?.type ?? null,
          resourceId: resource?.id ?? null,
          errorClassification: null,
          leaseToken: null,
          leaseExpiresAt: null,
          completedAt,
          failedAt: null,
        },
      });

      return {
        operationRequestId: row.id,
        response: serialized.response as TResponse,
        responseStatus,
        responseCode,
        resource,
        replayed: false,
      };
    });
  } catch (error) {
    const failure = safeFailureDecision(error, request.classifyFailure);
    try {
      const recovered = await finalizeOperationFailure<TResponse>({
        operationRequestId: claim.operationRequestId,
        leaseToken: claim.leaseToken,
        request,
        failure,
      });
      if (recovered) return recovered;
    } catch {
      // The original domain error remains authoritative. An unresolved PROCESSING
      // lease is re-evaluated safely on the next request after its expiry.
    }
    throw error;
  }
};
