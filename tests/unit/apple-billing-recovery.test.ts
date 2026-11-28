import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/jobs/cron/[group]/route";
import type * as AppleConfig from "@/server/billing/appleConfig";
import type * as Jobs from "@/server/jobs";

const mocks = vi.hoisted(() => {
  const reconciliationTable = () => ({
    findFirst: vi.fn(), findMany: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn(),
  });
  return {
    config: vi.fn(),
    prisma: {
      appleSubscriptionChain: reconciliationTable(),
      appleTransaction: reconciliationTable(),
      appleServerNotification: { findMany: vi.fn() },
      applePurchaseIntent: { updateMany: vi.fn() },
      deadLetterJob: { create: vi.fn() },
    },
    getTransactionHistory: vi.fn(),
    getTransactionInfo: vi.fn(),
    appleJobResult: vi.fn(),
    otherJob: vi.fn(),
  };
});

vi.mock("@/server/db/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/server/config/runtime", () => ({ isProductionRuntime: () => false }));
vi.mock("@/server/redis", () => ({ getRedisPublisher: () => null }));
vi.mock("@/server/logging", () => ({ getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("@/server/jobs/emailMarketing", () => ({
  EMAIL_CAMPAIGN_RECONCILE_JOB_NAME: "email-campaign-reconcile",
  EMAIL_CAMPAIGN_SEND_JOB_NAME: "email-campaign-send",
  runEmailCampaignReconcileJob: vi.fn(), runEmailCampaignSendJob: vi.fn(),
}));
vi.mock("@/server/jobs/customerOrderFollowUps", () => ({
  CUSTOMER_ORDER_FOLLOW_UP_JOB_NAME: "customer-order-follow-up", runCustomerOrderFollowUpJob: vi.fn(),
}));
vi.mock("@/server/jobs/orderConfirmationEmails", () => ({
  ORDER_CONFIRMATION_EMAIL_JOB_NAME: "order-confirmation-email", runOrderConfirmationEmailJob: vi.fn(),
}));
vi.mock("@/server/services/exports", () => ({}));
vi.mock("@/server/services/kkmConnector", () => ({}));
vi.mock("@/server/billing/appleConfig", async (importOriginal) => ({
  ...await importOriginal<typeof AppleConfig>(),
  appleBillingConfig: mocks.config,
}));
vi.mock("@/server/billing/appleConsumption", () => ({ processAppleConsumptionRequests: async () => ({ checked: 0 }) }));
vi.mock("@/server/billing/applePayments", () => ({}));
vi.mock("@/server/billing/appleSupportAuth", () => ({}));
vi.mock("@/server/billing/appleVerification", () => ({
  appleApiClient: () => ({ getTransactionHistory: mocks.getTransactionHistory, getTransactionInfo: mocks.getTransactionInfo }),
  appleReceiptVerifier: () => ({}),
}));
vi.mock("@/server/jobs", async importOriginal => {
  const jobs = await importOriginal<typeof Jobs>();
  return {
    ...jobs,
    async runJob(name: string) {
      if (name !== "apple-billing-reconcile") {
        mocks.otherJob(name);
        return { job: name, status: "ok" };
      }
      const result = await jobs.runJob(name);
      mocks.appleJobResult(result);
      return result;
    },
  };
});

const cronSecret = "local-reconciliation-test";
const appleJob = "apple-billing-reconcile";
const due = new Date("2026-11-26T12:00:00.000Z");
const tables = ["appleSubscriptionChain", "appleTransaction"] as const;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(due);
  vi.stubEnv("CRON_SECRET", cronSecret);
  vi.stubEnv("VERCEL_ENV", "development");
  vi.resetAllMocks();
  mocks.config.mockReturnValue({ mode: "live", apiReady: true });
  mocks.prisma.appleServerNotification.findMany.mockResolvedValue([]);
  for (const table of tables) {
    mocks.prisma[table].findFirst.mockResolvedValue(null);
    mocks.prisma[table].findMany.mockResolvedValue([]);
    mocks.prisma[table].updateMany.mockResolvedValue({ count: 1 });
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function runRecovery() {
  const response = await GET(new Request("http://localhost/api/jobs/cron/recovery", {
    headers: { authorization: `Bearer ${cronSecret}` },
  }), { params: Promise.resolve({ group: "recovery" }) });
  return { status: response.status, summary: await response.json() };
}

describe("Apple billing recovery status", () => {
  it("keeps recovery healthy with Apple off and no due Apple work", async () => {
    mocks.config.mockReturnValue({ mode: "off", apiReady: false });
    expect(await runRecovery()).toMatchObject({ status: 200, summary: { failed: 0 } });
    expect(mocks.otherJob).toHaveBeenCalledWith("subscription-payment-reconcile");
  });

  it.each(["live", "sandbox"])("signals missing Apple API access in %s mode", async mode => {
    mocks.config.mockReturnValue({ mode, apiReady: false });
    expect(await runRecovery()).toMatchObject({ status: 503, summary: { failedJobs: [appleJob] } });
    expect(mocks.prisma.appleSubscriptionChain.findFirst).not.toHaveBeenCalled();
    expect(mocks.appleJobResult).toHaveBeenCalledWith(expect.objectContaining({
      status: "skipped", details: expect.objectContaining({ reason: "failed", apiUnavailable: true, retryCount: 0 }),
    }));
  });

  it.each(tables)("signals missing Apple API access when %s is due with Apple off", async table => {
    mocks.config.mockReturnValue({ mode: "off", apiReady: false });
    mocks.prisma[table].findFirst.mockResolvedValue({ id: "synthetic-record" });
    expect(await runRecovery()).toMatchObject({ status: 503, summary: { failedJobs: [appleJob] } });
    expect(mocks.prisma[table].findFirst).toHaveBeenCalledWith({
      where: { nextCheckAt: { lte: due }, OR: [{ processingUntil: null }, { processingUntil: { lte: due } }] },
      select: { id: true },
    });
  });

  it.each([
    ["appleSubscriptionChain", "getTransactionHistory", 5],
    ["appleTransaction", "getTransactionInfo", 15],
  ] as const)("reports a retry on %s without exposing provider details", async (table, request, minutes) => {
    const repository = mocks.prisma[table];
    const id = "synthetic-record";
    repository.findMany.mockResolvedValue([{ id }]);
    repository.findUniqueOrThrow.mockResolvedValue({ environment: "Sandbox", originalTransactionId: id, transactionId: id });
    mocks[request].mockRejectedValueOnce(new Error("synthetic-provider-detail"));

    const response = await runRecovery();
    expect(response).toMatchObject({ status: 503, summary: { failedJobs: [appleJob] } });
    expect(JSON.stringify(response.summary)).not.toMatch(/synthetic-(record|provider-detail)|retryCount/);
    const claim = repository.updateMany.mock.calls[0][0].data.processingToken;
    expect(repository.updateMany).toHaveBeenLastCalledWith({
      where: { id, processingToken: claim },
      data: { processingToken: null, processingUntil: null, lastIssue: "appleReconciliationUnavailable",
        nextCheckAt: new Date(due.getTime() + minutes * 60_000) },
    });
    expect(mocks.appleJobResult).toHaveBeenCalledWith(expect.objectContaining({
      status: "skipped", details: expect.objectContaining({ retryCount: 1, apiUnavailable: false, reason: "failed" }),
    }));
    expect(mocks.prisma.deadLetterJob.create).not.toHaveBeenCalled();
  });

  it("does not treat a row claimed by another worker as a retry", async () => {
    const repository = mocks.prisma.appleTransaction;
    repository.findMany.mockResolvedValue([{ id: "synthetic-record" }]);
    repository.updateMany.mockResolvedValue({ count: 0 });
    expect(await runRecovery()).toMatchObject({ status: 200, summary: { failed: 0 } });
    expect(mocks.getTransactionInfo).not.toHaveBeenCalled();
    expect(repository.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
