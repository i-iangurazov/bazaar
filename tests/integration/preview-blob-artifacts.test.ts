import { BlobNotFoundError } from "@vercel/blob";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Configure this file's explicitly synthetic provider before runtime modules
// initialize their immutable environment snapshot. Every SDK operation is mocked.
const sdk = vi.hoisted(() => {
  const settings = {
    IMAGE_STORAGE_PROVIDER: "vercel-blob", EXPORT_STORAGE_PROVIDER: "vercel-blob",
    BLOB_IMAGE_STORE_ID: "store_syntheticImages", BLOB_EXPORT_STORE_ID: "store_syntheticExports",
    VERCEL_OIDC_TOKEN: "synthetic-test-oidc", HARDENING_PREVIEW_GUARD: "0",
  };
  const previous = Object.fromEntries(Object.keys(settings).map((name) => [name, process.env[name]]));
  Object.assign(process.env, settings);
  return {
    previous, bytes: new Map<string, Buffer>(), put: vi.fn(), get: vi.fn(), head: vi.fn(), del: vi.fn(),
    auth: null as null | { sub: string; organizationId: string; role: string; isOrgOwner: boolean },
  };
});
vi.mock("@vercel/blob", () => ({ put: sdk.put, get: sdk.get, head: sdk.head, del: sdk.del, BlobNotFoundError: class extends Error {} }));
vi.mock("@vercel/oidc", () => ({ getVercelOidcToken: async () => "synthetic-resolved-oidc" }));
vi.mock("@/server/auth/token", () => ({ getServerAuthToken: async () => sdk.auth }));

import { prisma } from "@/server/db/prisma";
import { runJob } from "@/server/jobs";
import { GET } from "@/app/api/exports/[id]/route";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { createTestCaller } from "../helpers/context";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const base = "https://syntheticexports.private.blob.vercel-storage.com";
const request = (id: string) => GET(new Request(`https://isolated-preview.invalid/api/exports/${id}`), { params: Promise.resolve({ id }) });

afterAll(() => {
  for (const [name, value] of Object.entries(sdk.previous)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

describeDb("durable isolated Preview export artifacts", () => {
  beforeEach(async () => {
    await resetDatabase(); vi.clearAllMocks(); sdk.bytes.clear(); sdk.auth = null;
    sdk.put.mockImplementation(async (path: string, body: Buffer, options: { access: string; storeId: string }) => {
      expect(options).toMatchObject({ access: "private", storeId: "store_syntheticExports" });
      sdk.bytes.set(path, Buffer.from(body));
      return { url: `${base}/${path}` };
    });
    sdk.head.mockImplementation(async (path: string) => {
      const bytes = sdk.bytes.get(path);
      if (!bytes) throw new BlobNotFoundError();
      return { size: bytes.length };
    });
    sdk.get.mockImplementation(async (path: string, options: { access: string; useCache: boolean; storeId: string }) => {
      expect(options).toMatchObject({ access: "private", useCache: false, storeId: "store_syntheticExports" });
      const bytes = sdk.bytes.get(path);
      return bytes ? { statusCode: 200, stream: new Response(new Uint8Array(bytes)).body, blob: { size: bytes.length } } : null;
    });
  });

  const create = async () => {
    const f = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    const job = await caller.exports.create({ storeId: f.store.id, type: "PRICE_LIST", format: "csv",
      periodStart: new Date("2026-01-01T00:00:00Z"), periodEnd: new Date("2026-12-31T23:59:59Z") });
    await runJob("export-job", { jobId: job.id });
    sdk.auth = { sub: f.adminUser.id, organizationId: f.org.id, role: "ADMIN", isOrgOwner: true };
    return { ...f, caller, job };
  };

  it("persists CSV in the private store and streams it through the authenticated download route", async () => {
    const f = await create();
    const state = await f.caller.exports.get({ jobId: f.job.id });
    expect(state).toMatchObject({ status: "DONE", downloadAvailable: true, downloadUrl: `/api/exports/${f.job.id}` });
    expect(state?.storagePath).toBe(`vercel-blob:${base}/${sdk.put.mock.calls[0]?.[0]}`);
    const response = await request(f.job.id);
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain("attachment;");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toContain(f.product.name);
    expect(sdk.get).toHaveBeenCalledOnce();
  });

  it("denies anonymous, other organizations and staff before reading any private artifact", async () => {
    const f = await create();
    sdk.auth = null;
    expect((await request(f.job.id)).status).toBe(401);
    sdk.auth = { sub: f.adminUser.id, organizationId: "synthetic-foreign-org", role: "ADMIN", isOrgOwner: true };
    expect((await request(f.job.id)).status).toBe(404);
    sdk.auth = { sub: f.staffUser.id, organizationId: f.org.id, role: "STAFF", isOrgOwner: false };
    expect((await request(f.job.id)).status).toBe(403);
    expect(sdk.get).not.toHaveBeenCalled();
  });

  it("rejects a cross-organization storage path even on a valid owned job", async () => {
    const f = await create();
    await prisma.exportJob.update({ where: { id: f.job.id }, data: {
      storagePath: `vercel-blob:${base}/exports/other-org/${f.job.id}/private.csv`,
    } });
    expect((await request(f.job.id)).status).toBe(410);
    expect(sdk.get).not.toHaveBeenCalled();
  });

  it("rebuilds a missing durable artifact without handing an unauthenticated Blob URL to the client", async () => {
    const f = await create();
    sdk.bytes.clear();
    const response = await request(f.job.id);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(f.product.name);
    expect(sdk.put).toHaveBeenCalledTimes(2);
    expect(sdk.get).toHaveBeenCalledTimes(2);
  });
});
