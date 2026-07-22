import { OperationRequestPrincipalType, OperationRequestStatus } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import {
  canonicalizeOperationPayload,
  fingerprintOperationRequest,
  OPERATION_RESPONSE_MAX_BYTES,
  runOperationRequest,
} from "@/server/services/operationRequests";

import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const operationInput = (input: {
  organizationId: string;
  storeId: string;
  key: string;
  value?: Record<string, unknown>;
  leaseDurationMs?: number;
  principal?: {
    type: OperationRequestPrincipalType;
    id: string;
  };
}) => ({
  organizationId: input.organizationId,
  storeId: input.storeId,
  scope: "tests.operation.execute",
  principal: input.principal ?? {
    type: OperationRequestPrincipalType.AUTHENTICATED_USER,
    id: "operation-test-user",
  },
  idempotencyKey: input.key,
  payload: {
    version: "v1",
    value: (input.value ?? { command: "create-supplier" }) as never,
  },
  allowedResponsePaths: ["id", "name"],
  leaseDurationMs: input.leaseDurationMs,
});

describeDb("operation request lifecycle", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("canonicalizes object keys before calculating the request fingerprint", () => {
    const first = { version: "v1", value: { beta: 2, alpha: { y: 2, x: 1 } } } as const;
    const second = { version: "v1", value: { alpha: { x: 1, y: 2 }, beta: 2 } } as const;

    expect(canonicalizeOperationPayload(first)).toBe(canonicalizeOperationPayload(second));
    const firstFingerprint = fingerprintOperationRequest({ storeId: "store-a", payload: first });
    const secondFingerprint = fingerprintOperationRequest({ storeId: "store-a", payload: second });
    expect(firstFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(firstFingerprint).toBe(secondFingerprint);
    expect(fingerprintOperationRequest({ storeId: "store-b", payload: first })).not.toBe(
      firstFingerprint,
    );
  });

  it("commits one domain effect, replays its result, and rejects a changed payload", async () => {
    const { org, store } = await seedBase();
    const input = operationInput({ organizationId: org.id, storeId: store.id, key: "op-replay-1" });
    let handlerCalls = 0;

    const first = await runOperationRequest(input, async (tx) => {
      handlerCalls += 1;
      const supplier = await tx.supplier.create({
        data: { organizationId: org.id, name: "Operation supplier" },
      });
      return {
        response: { id: supplier.id, name: supplier.name },
        responseStatus: 201,
        responseCode: "created",
        resource: { type: "Supplier", id: supplier.id },
      };
    });
    const replay = await runOperationRequest(input, async () => {
      throw new Error("replay executed the handler");
    });

    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({
      operationRequestId: first.operationRequestId,
      response: first.response,
      responseStatus: 201,
      responseCode: "created",
      replayed: true,
    });
    expect(handlerCalls).toBe(1);
    await expect(
      prisma.supplier.count({ where: { organizationId: org.id, name: "Operation supplier" } }),
    ).resolves.toBe(1);

    await expect(
      runOperationRequest(
        operationInput({
          organizationId: org.id,
          storeId: store.id,
          key: "op-replay-1",
          value: { command: "different-command" },
        }),
        async () => {
          throw new Error("mismatched payload executed the handler");
        },
      ),
    ).rejects.toThrow("operationRequestPayloadMismatch");

    const otherStore = await prisma.store.create({
      data: { organizationId: org.id, name: "Other operation store", code: "OPS-2" },
    });
    await expect(
      runOperationRequest(
        operationInput({
          organizationId: org.id,
          storeId: otherStore.id,
          key: "op-replay-1",
        }),
        async () => {
          throw new Error("cross-store replay executed the handler");
        },
      ),
    ).rejects.toThrow("operationRequestIdentityMismatch");
  });

  it("waits behind an expired lease while the older domain transaction is active", async () => {
    const { org, store } = await seedBase();
    const input = operationInput({
      organizationId: org.id,
      storeId: store.id,
      key: "op-expired-active-1",
      leaseDurationMs: 1_000,
    });
    let releaseHandler!: () => void;
    let markHandlerStarted!: () => void;
    const handlerStarted = new Promise<void>((resolve) => {
      markHandlerStarted = resolve;
    });
    const handlerRelease = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    let handlerCalls = 0;

    const firstPromise = runOperationRequest(input, async (tx) => {
      handlerCalls += 1;
      const supplier = await tx.supplier.create({
        data: { organizationId: org.id, name: "Lease winner" },
      });
      markHandlerStarted();
      await handlerRelease;
      return {
        response: { id: supplier.id, name: supplier.name },
        responseStatus: 201,
      };
    });

    await handlerStarted;
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const secondPromise = runOperationRequest(input, async () => {
      handlerCalls += 1;
      throw new Error("expired lease takeover executed while the original transaction was active");
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    releaseHandler();

    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first.replayed).toBe(false);
    expect(second).toMatchObject({
      operationRequestId: first.operationRequestId,
      response: first.response,
      replayed: true,
    });
    expect(handlerCalls).toBe(1);
    await expect(
      prisma.supplier.count({ where: { organizationId: org.id, name: "Lease winner" } }),
    ).resolves.toBe(1);
  });

  it("takes over an expired processing claim after re-reading it under a row lock", async () => {
    const { org, store } = await seedBase();
    const input = operationInput({
      organizationId: org.id,
      storeId: store.id,
      key: "op-expired-abandoned-1",
    });
    await prisma.operationRequest.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        scope: input.scope,
        principalType: OperationRequestPrincipalType.AUTHENTICATED_USER,
        principalKey: "user:operation-test-user",
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: fingerprintOperationRequest({
          storeId: store.id,
          payload: input.payload,
        }),
        status: OperationRequestStatus.PROCESSING,
        attemptCount: 1,
        leaseToken: "abandoned-lease",
        leaseExpiresAt: new Date(Date.now() - 1_000),
        processingStartedAt: new Date(Date.now() - 2_000),
        lastAttemptAt: new Date(Date.now() - 2_000),
        expiresAt: new Date(Date.now() + 30_000),
      },
    });

    const takenOver = await runOperationRequest(input, async (tx) => {
      const supplier = await tx.supplier.create({
        data: { organizationId: org.id, name: "Expired lease takeover" },
      });
      return {
        response: { id: supplier.id, name: supplier.name },
        responseStatus: 201,
      };
    });

    expect(takenOver.replayed).toBe(false);
    await expect(
      prisma.operationRequest.findUniqueOrThrow({ where: { id: takenOver.operationRequestId } }),
    ).resolves.toMatchObject({
      status: OperationRequestStatus.COMPLETED,
      attemptCount: 2,
      leaseToken: null,
    });
  });

  it("does not execute an ambiguously stale processing claim", async () => {
    const { org, store } = await seedBase();
    const input = operationInput({
      organizationId: org.id,
      storeId: store.id,
      key: "op-expired-ambiguous-1",
    });
    await prisma.operationRequest.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        scope: input.scope,
        principalType: OperationRequestPrincipalType.AUTHENTICATED_USER,
        principalKey: "user:operation-test-user",
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: fingerprintOperationRequest({
          storeId: store.id,
          payload: input.payload,
        }),
        status: OperationRequestStatus.PROCESSING,
        attemptCount: 1,
        leaseToken: "ambiguous-lease",
        leaseExpiresAt: new Date(Date.now() - 1_000),
        processingStartedAt: new Date(Date.now() - 2_000),
        lastAttemptAt: new Date(Date.now() - 2_000),
        errorClassification: "AMBIGUOUS",
        expiresAt: new Date(Date.now() + 30_000),
      },
    });
    let handlerCalls = 0;

    await expect(
      runOperationRequest(input, async () => {
        handlerCalls += 1;
        throw new Error("ambiguous stale handler executed");
      }),
    ).rejects.toThrow("operationRequestReconciliationRequired");
    expect(handlerCalls).toBe(0);
  });

  it("isolates all principal types, organizations, and organization-store pairs", async () => {
    const { org, store } = await seedBase();
    const secondOrg = await prisma.organization.create({ data: { name: "Second operation org" } });
    const secondStore = await prisma.store.create({
      data: { organizationId: secondOrg.id, name: "Second operation store", code: "OPS-ORG-2" },
    });
    const principalTypes = [
      OperationRequestPrincipalType.AUTHENTICATED_USER,
      OperationRequestPrincipalType.API_KEY,
      OperationRequestPrincipalType.ANONYMOUS_CATALOG,
    ];
    const results = [];

    for (const [index, principalType] of principalTypes.entries()) {
      const result = await runOperationRequest(
        operationInput({
          organizationId: org.id,
          storeId: store.id,
          key: "op-principal-matrix-1",
          principal: { type: principalType, id: "shared-principal-id" },
        }),
        async (tx) => {
          const supplier = await tx.supplier.create({
            data: { organizationId: org.id, name: `Principal supplier ${index}` },
          });
          return {
            response: { id: supplier.id, name: supplier.name },
            responseStatus: 201,
          };
        },
      );
      results.push(result);
    }

    const secondOrgResult = await runOperationRequest(
      operationInput({
        organizationId: secondOrg.id,
        storeId: secondStore.id,
        key: "op-principal-matrix-1",
        principal: {
          type: OperationRequestPrincipalType.AUTHENTICATED_USER,
          id: "shared-principal-id",
        },
      }),
      async (tx) => {
        const supplier = await tx.supplier.create({
          data: { organizationId: secondOrg.id, name: "Second org supplier" },
        });
        return {
          response: { id: supplier.id, name: supplier.name },
          responseStatus: 201,
        };
      },
    );
    results.push(secondOrgResult);

    expect(new Set(results.map((result) => result.operationRequestId)).size).toBe(4);
    expect(new Set(results.map((result) => result.response.id)).size).toBe(4);
    await expect(
      prisma.operationRequest.count({ where: { idempotencyKey: "op-principal-matrix-1" } }),
    ).resolves.toBe(4);

    await expect(
      runOperationRequest(
        operationInput({
          organizationId: org.id,
          storeId: secondStore.id,
          key: "op-cross-org-store-1",
        }),
        async () => {
          throw new Error("cross-organization store handler executed");
        },
      ),
    ).rejects.toThrow("storeNotFound");
    await expect(
      prisma.operationRequest.count({ where: { idempotencyKey: "op-cross-org-store-1" } }),
    ).resolves.toBe(0);
  });

  it("retries only an explicitly safe failed operation", async () => {
    const { org, store } = await seedBase();
    const input = {
      ...operationInput({ organizationId: org.id, storeId: store.id, key: "op-safe-retry-1" }),
      classifyFailure: () => ({
        classification: "SAFE_BEFORE_EFFECTS" as const,
        responseCode: "safeValidationFailure",
        responseStatus: 409,
      }),
    };

    await expect(
      runOperationRequest(input, async (tx) => {
        await tx.supplier.create({
          data: { organizationId: org.id, name: "Rolled back supplier" },
        });
        throw new Error("safe failure after database work");
      }),
    ).rejects.toThrow("safe failure after database work");
    await expect(
      prisma.supplier.count({ where: { organizationId: org.id, name: "Rolled back supplier" } }),
    ).resolves.toBe(0);

    const failed = await prisma.operationRequest.findFirstOrThrow({
      where: { organizationId: org.id, idempotencyKey: "op-safe-retry-1" },
    });
    expect(failed).toMatchObject({
      status: OperationRequestStatus.FAILED,
      errorClassification: "SAFE_BEFORE_EFFECTS",
      responseCode: "safeValidationFailure",
      attemptCount: 1,
      leaseToken: null,
    });

    const retried = await runOperationRequest(input, async (tx) => {
      const supplier = await tx.supplier.create({
        data: { organizationId: org.id, name: "Safe retry supplier" },
      });
      return {
        response: { id: supplier.id, name: supplier.name },
        responseStatus: 201,
      };
    });
    expect(retried.replayed).toBe(false);
    await expect(
      prisma.operationRequest.findUniqueOrThrow({ where: { id: retried.operationRequestId } }),
    ).resolves.toMatchObject({
      status: OperationRequestStatus.COMPLETED,
      attemptCount: 2,
      errorClassification: null,
    });
  });

  it("requires reconciliation for an ambiguously failed operation", async () => {
    const { org, store } = await seedBase();
    const input = operationInput({
      organizationId: org.id,
      storeId: store.id,
      key: "op-ambiguous-1",
    });
    let retryHandlerCalls = 0;

    await expect(
      runOperationRequest(input, async () => {
        throw new Error("ambiguous provider boundary");
      }),
    ).rejects.toThrow("ambiguous provider boundary");
    await expect(
      runOperationRequest(input, async () => {
        retryHandlerCalls += 1;
        throw new Error("ambiguous retry executed");
      }),
    ).rejects.toThrow("operationRequestReconciliationRequired");
    expect(retryHandlerCalls).toBe(0);

    await expect(
      prisma.operationRequest.findFirstOrThrow({
        where: { organizationId: org.id, idempotencyKey: "op-ambiguous-1" },
      }),
    ).resolves.toMatchObject({
      status: OperationRequestStatus.FAILED,
      errorClassification: "AMBIGUOUS",
      responseCode: "operationRequestFailed",
      attemptCount: 1,
    });
  });

  it("rolls back domain effects when the stored response is sensitive or too large", async () => {
    const { org, store } = await seedBase();
    const sensitiveInput = operationInput({
      organizationId: org.id,
      storeId: store.id,
      key: "op-sensitive-1",
    });

    await expect(
      runOperationRequest(sensitiveInput, async (tx) => {
        const supplier = await tx.supplier.create({
          data: { organizationId: org.id, name: "Sensitive response supplier" },
        });
        return {
          response: { id: supplier.id, name: supplier.name, accessToken: "must-not-persist" },
          responseStatus: 201,
        };
      }),
    ).rejects.toThrow("operationResponseSensitiveData");

    const oversizedInput = {
      ...operationInput({
        organizationId: org.id,
        storeId: store.id,
        key: "op-oversized-1",
      }),
      allowedResponsePaths: ["id", "name", "message"],
    };
    await expect(
      runOperationRequest(oversizedInput, async (tx) => {
        const supplier = await tx.supplier.create({
          data: { organizationId: org.id, name: "Oversized response supplier" },
        });
        return {
          response: {
            id: supplier.id,
            name: supplier.name,
            message: "x".repeat(OPERATION_RESPONSE_MAX_BYTES),
          },
          responseStatus: 201,
        };
      }),
    ).rejects.toThrow("operationResponseTooLarge");

    const failureStatusInput = operationInput({
      organizationId: org.id,
      storeId: store.id,
      key: "op-failure-status-1",
    });
    await expect(
      runOperationRequest(failureStatusInput, async (tx) => {
        const supplier = await tx.supplier.create({
          data: { organizationId: org.id, name: "Failure status supplier" },
        });
        return {
          response: { id: supplier.id, name: supplier.name },
          responseStatus: 409,
        };
      }),
    ).rejects.toThrow("operationResponseInvalid");

    await expect(
      prisma.supplier.count({
        where: {
          organizationId: org.id,
          name: {
            in: [
              "Sensitive response supplier",
              "Oversized response supplier",
              "Failure status supplier",
            ],
          },
        },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.operationRequest.count({
        where: {
          organizationId: org.id,
          status: OperationRequestStatus.FAILED,
          errorClassification: "SAFE_BEFORE_EFFECTS",
        },
      }),
    ).resolves.toBe(3);
  });
});
