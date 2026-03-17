import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetServerAuthToken, prisma } = vi.hoisted(() => ({
  mockGetServerAuthToken: vi.fn(),
  prisma: {
    mMarketExportJob: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/server/auth/token", () => ({
  getServerAuthToken: () => mockGetServerAuthToken(),
}));

vi.mock("@/server/db/prisma", () => ({ prisma }));

import { GET as mMarketErrorReportGet } from "../../src/app/api/m-market/jobs/[id]/error-report/route";

describe("m-market error report route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns unauthorized when the user has no organization access", async () => {
    mockGetServerAuthToken.mockResolvedValue(null);

    const response = await mMarketErrorReportGet(new Request("http://localhost"), {
      params: { id: "job-1" },
    });

    expect(response.status).toBe(401);
  });

  it("merges legacy payload stats and remote response into the downloaded report", async () => {
    mockGetServerAuthToken.mockResolvedValue({ organizationId: "org-1" });
    prisma.mMarketExportJob.findFirst.mockResolvedValue({
      id: "job-1",
      environment: "PROD",
      requestIdempotencyKey: "req-1",
      errorReportJson: {
        generatedAt: "2026-03-16T23:31:20.920Z",
        summary: {
          mode: "IN_STOCK_ONLY",
          storesTotal: 1,
          storesMapped: 1,
          productsReady: 58,
          productsFailed: 0,
          productsConsidered: 58,
        },
        blockers: {
          total: 0,
          byCode: {},
          missingStoreMappings: [],
        },
        warnings: {
          total: 1,
          byCode: {
            SPECS_VALIDATION_SKIPPED: 1,
          },
          global: ["SPECS_VALIDATION_SKIPPED"],
        },
        failedProducts: [],
      },
      payloadStatsJson: {
        productCount: 58,
        selectedProducts: 58,
        payloadBytes: 43210,
      },
      responseJson: {
        httpStatus: 400,
        body: {
          detail: "invalid product category",
        },
      },
    });

    const response = await mMarketErrorReportGet(new Request("http://localhost"), {
      params: { id: "job-1" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="mmarket-export-error-job-1.json"',
    );

    const payload = JSON.parse(await response.text());
    expect(payload).toMatchObject({
      jobId: "job-1",
      environment: "PROD",
      endpoint: "https://market.mbank.kg/api/crm/products/import_products/",
      requestIdempotencyKey: "req-1",
      payloadBytes: 43210,
      payloadStats: {
        productCount: 58,
        selectedProducts: 58,
        payloadBytes: 43210,
      },
      remoteResponse: {
        httpStatus: 400,
        body: {
          detail: "invalid product category",
        },
      },
      summary: {
        productsReady: 58,
      },
    });
  });

  it("keeps richer debug fields that are already stored in the error report", async () => {
    mockGetServerAuthToken.mockResolvedValue({ organizationId: "org-1" });
    prisma.mMarketExportJob.findFirst.mockResolvedValue({
      id: "job-2",
      environment: "DEV",
      requestIdempotencyKey: "req-2",
      errorReportJson: {
        jobId: "job-2",
        environment: "DEV",
        endpoint: "https://dev.m-market.kg/api/crm/products/import_products/",
        requestIdempotencyKey: "req-2",
        reason: "mMarketRemoteRejected",
        payloadBytes: 321,
        payload: {
          products: [{ sku: "SKU-1" }],
        },
        remoteResponse: {
          httpStatus: 422,
          body: {
            detail: "payload rejected",
          },
        },
      },
      payloadStatsJson: {
        productCount: 1,
        payloadBytes: 999,
      },
      responseJson: {
        httpStatus: 400,
        body: {
          detail: "older response should not overwrite",
        },
      },
    });

    const response = await mMarketErrorReportGet(new Request("http://localhost"), {
      params: { id: "job-2" },
    });

    expect(response.status).toBe(200);

    const payload = JSON.parse(await response.text());
    expect(payload).toMatchObject({
      payloadBytes: 321,
      payload: {
        products: [{ sku: "SKU-1" }],
      },
      remoteResponse: {
        httpStatus: 422,
        body: {
          detail: "payload rejected",
        },
      },
      payloadStats: {
        productCount: 1,
        payloadBytes: 999,
      },
    });
  });

  it("returns remoteResponse as null when MMarket did not reply", async () => {
    mockGetServerAuthToken.mockResolvedValue({ organizationId: "org-1" });
    prisma.mMarketExportJob.findFirst.mockResolvedValue({
      id: "job-3",
      environment: "DEV",
      requestIdempotencyKey: "req-3",
      errorReportJson: {
        reason: "MMarket request timed out after 90s",
        payloadBytes: 1234,
      },
      payloadStatsJson: {
        productCount: 2,
        payloadBytes: 1234,
      },
      responseJson: null,
    });

    const response = await mMarketErrorReportGet(new Request("http://localhost"), {
      params: { id: "job-3" },
    });

    expect(response.status).toBe(200);

    const payload = JSON.parse(await response.text());
    expect(payload).toMatchObject({
      jobId: "job-3",
      reason: "MMarket request timed out after 90s",
      remoteResponse: null,
      payloadStats: {
        productCount: 2,
        payloadBytes: 1234,
      },
    });
  });
});
