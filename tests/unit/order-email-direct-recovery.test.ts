import type * as EmailService from "@/server/services/email";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  sender: vi.fn(),
  order: { findFirst: vi.fn(), update: vi.fn() },
  log: {
    findFirst: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
}));
vi.mock("@/server/db/prisma", () => ({
  prisma: { customerOrder: mocks.order, customerOrderEmailLog: mocks.log },
}));
vi.mock("@/server/services/email", async (importOriginal) => ({
  ...(await importOriginal<typeof EmailService>()),
  sendTransactionalEmail: mocks.send,
}));
vi.mock("@/server/services/emailMarketing", () => ({
  resolveStorePrimaryVerifiedSender: mocks.sender,
}));
vi.mock("@/server/middleware/rateLimiter", () => ({
  createRateLimiter: () => ({ consume: vi.fn() }),
}));

import {
  EmailProviderError,
  type EmailPayload,
  type EmailSendResult,
} from "@/server/services/email";
import { sendOrderConfirmationEmail } from "@/server/services/orderEmails";
import { createSyntheticOrderEmailRecord } from "../helpers/transactionalEmailFixture";

const now = new Date("2026-11-11T12:00:00Z");
const order = createSyntheticOrderEmailRecord();
const input = { organizationId: order.organizationId, customerOrderId: order.id };
const canonicalKey = `customer-order-confirmation-${order.id}`;
const frameMarker = 'data-bazaar-email-template="v1"';
const sent: EmailPayload[] = [];
let outcomes: (EmailSendResult | Error)[] = [];
const providerError = (status = 409, responseText = '{"name":"invalid_idempotent_request"}') =>
  new EmailProviderError({ provider: "resend", status, responseText });
const expectFailed = async (request: Parameters<typeof sendOrderConfirmationEmail>[0] = input) => {
  await expect(sendOrderConfirmationEmail(request)).rejects.toMatchObject({
    message: "orderEmailSendFailed",
  });
  expect(mocks.order.update).not.toHaveBeenCalled();
  expect(mocks.log.create.mock.calls.some(([write]) => write.data.status === "SENT")).toBe(false);
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  vi.stubEnv("EMAIL_LOGO_URL", "https://example.invalid/synthetic-logo.png");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Provider calls are forbidden");
    }),
  );
  sent.length = 0;
  outcomes = [];
  mocks.order.findFirst.mockResolvedValue(order);
  mocks.order.update.mockResolvedValue(order);
  mocks.log.findFirst.mockResolvedValue(null);
  mocks.log.create.mockResolvedValue({ id: "synthetic-email-log" });
  mocks.log.updateMany.mockResolvedValue({ count: 1 });
  mocks.sender.mockResolvedValue({
    from: "Synthetic store <orders@merchant.invalid>",
    replyTo: "reply@merchant.invalid",
  });
  mocks.send.mockImplementation(async (payload: EmailPayload) => {
    // The recovery may change its local payload; record what each provider submission saw.
    sent.push(structuredClone(payload));
    const next = outcomes.shift();
    if (!next) throw new Error("Unexpected additional email submission");
    if (next instanceof Error) throw next;
    return next;
  });
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("direct order email recovery across a template rollout", () => {
  it("sends a new direct message once using the current template", async () => {
    outcomes = [{ provider: "resend", id: "synthetic-new-message" }];
    await expect(sendOrderConfirmationEmail(input)).resolves.toMatchObject({ status: "sent" });
    expect(sent).toHaveLength(1);
    expect(sent[0].html).toContain(frameMarker);
    expect(sent[0].html.split(order.store.name)).toHaveLength(2);
    expect(sent[0].html).not.toMatch(/<img\b/i);
    expect(sent[0].idempotencyKey).toBe(canonicalKey);
    expect(sent[0]).toMatchObject({
      from: "Synthetic store <orders@merchant.invalid>",
      replyTo: "reply@merchant.invalid",
    });
    expect(mocks.log.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SENT",
          templateVersion: "branded-v1",
          providerMessageId: "synthetic-new-message",
        }),
      }),
    );
  });

  it("recovers the already accepted old message ID on the exact conflict without changing its key or other fields", async () => {
    outcomes = [providerError(), { provider: "resend", id: "synthetic-previously-accepted-id" }];
    await expect(sendOrderConfirmationEmail(input)).resolves.toEqual({
      status: "sent",
      recipientEmail: order.customerEmail,
    });
    expect(sent).toHaveLength(2);
    expect(sent[0].html).toContain(frameMarker);
    expect(sent[0].html.split(order.store.name)).toHaveLength(2);
    expect(sent[0].html).not.toMatch(/<img\b/i);
    expect(sent[1].html).not.toContain(frameMarker);
    expect(sent[1].html).toContain("This message was sent by BAZAAR.");
    expect({ ...sent[1], html: sent[0].html }).toEqual(sent[0]);
    expect(sent[1]).toMatchObject({
      idempotencyKey: canonicalKey,
      from: "Synthetic store <orders@merchant.invalid>",
      replyTo: "reply@merchant.invalid",
      to: order.customerEmail,
    });
    expect(mocks.order.update).toHaveBeenCalledTimes(1);
    expect(mocks.log.create).toHaveBeenCalledTimes(1);
    expect(mocks.log.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SENT",
          templateVersion: null,
          providerMessageId: "synthetic-previously-accepted-id",
        }),
      }),
    );
  });

  it.each([
    ["generic conflict", () => providerError(409, '{"name":"conflict"}')],
    ["concurrent operation", () => providerError(409, '{"name":"concurrent_idempotent_requests"}')],
    ["wrong name casing", () => providerError(409, '{"name":"INVALID_IDEMPOTENT_REQUEST"}')],
    [
      "name mentioned only in message",
      () => providerError(409, '{"message":"invalid_idempotent_request"}'),
    ],
    ["non-JSON conflict", () => providerError(409, "invalid_idempotent_request")],
    ["validation failure", () => providerError(422)],
    ["temporary provider failure", () => providerError(503)],
    [
      "an untyped error carrying matching provider fields",
      () =>
        Object.assign(new Error("synthetic untyped conflict"), {
          status: 409,
          responseText: '{"name":"invalid_idempotent_request"}',
        }),
    ],
    ["network failure", () => new TypeError("synthetic network failure")],
  ] as const)("does not switch templates after %s", async (_name, failure) => {
    outcomes = [failure()];
    await expectFailed();
    expect(sent).toHaveLength(1);
    expect(sent[0].html).toContain(frameMarker);
    expect(sent[0].idempotencyKey).toBe(canonicalKey);
    expect(mocks.log.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED", templateVersion: "branded-v1" }),
      }),
    );
  });

  it.each([null, "branded-v1"])(
    "keeps an existing logged template %s instead of probing another one",
    async (templateVersion) => {
      mocks.log.findFirst.mockResolvedValue({ templateVersion });
      outcomes = [providerError()];
      await expectFailed();
      expect(sent).toHaveLength(1);
      expect(sent[0].html.includes(frameMarker)).toBe(templateVersion === "branded-v1");
      expect(sent[0].idempotencyKey).toBe(canonicalKey);
      expect(mocks.log.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "FAILED", templateVersion }),
        }),
      );
    },
  );

  it("does not use recovery for an explicitly forced new delivery", async () => {
    outcomes = [providerError()];
    await expectFailed({ ...input, force: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].html).toContain(frameMarker);
    expect(sent[0].idempotencyKey).toBe(`${canonicalKey}-${now.getTime()}`);
    expect(mocks.log.findFirst).not.toHaveBeenCalled();
  });

  it("does not change the template of a claimed durable delivery", async () => {
    const claimed = {
      id: "synthetic-claimed-log",
      organizationId: order.organizationId,
      customerOrderId: order.id,
      type: "CONFIRMATION",
      status: "PROCESSING",
      templateVersion: "branded-v1",
      recipientEmail: order.customerEmail,
      leaseToken: "synthetic-lease",
      attemptCount: 1,
    };
    mocks.log.findFirst.mockResolvedValue(claimed);
    mocks.log.findUniqueOrThrow.mockResolvedValue(claimed);
    outcomes = [providerError()];
    await expectFailed({ ...input, deliveryLogId: claimed.id });
    expect(sent).toHaveLength(1);
    expect(sent[0].html).toContain(frameMarker);
    expect(sent[0].idempotencyKey).toBe(canonicalKey);
    expect(mocks.log.create).not.toHaveBeenCalled();
    expect(mocks.log.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: claimed.id, leaseToken: claimed.leaseToken }),
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
  });

  it.each([409, 422, 503])(
    "propagates legacy failure %s without inventing delivery or trying a third submission",
    async (status) => {
      outcomes = [providerError(), providerError(status)];
      await expectFailed();
      expect(sent).toHaveLength(2);
      expect(sent[0].html).toContain(frameMarker);
      expect(sent[1].html).not.toContain(frameMarker);
      expect({ ...sent[1], html: sent[0].html }).toEqual(sent[0]);
      expect(sent[1].idempotencyKey).toBe(canonicalKey);
      expect(mocks.log.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "FAILED", templateVersion: null }),
        }),
      );
    },
  );
});
