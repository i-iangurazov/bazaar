import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  ProductImageStudioBackground,
  ProductImageStudioJobStatus,
  ProductImageStudioOutputFormat,
} from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import {
  createProductImageStudioJob,
  getProductImageStudioJob,
  getProductImageStudioOverview,
  listProductImageStudioJobs,
  runProductImageStudioJob,
  saveGeneratedImageToProduct,
} from "@/server/services/productImageStudio";
import { uploadProductImageBuffer } from "@/server/services/productImageStorage";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { createTestCaller } from "../helpers/context";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const waitFor = async (predicate: () => boolean) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition not reached");
};

const createImageBuffer = async (options?: { width?: number; height?: number; color?: string }) =>
  sharp({
    create: {
      width: options?.width ?? 800,
      height: options?.height ?? 800,
      channels: 3,
      background: options?.color ?? "#d9d9d9",
    },
  })
    .png()
    .toBuffer();

describeDb("product image studio integration", () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.stubEnv("DEEPSEEK_API_KEY", "");
  });

  it("lets a receiving-store manager save a shared card image without granting source-store access", async () => {
    const f = await seedBase({ plan: "ENTERPRISE" });
    const source = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Source", code: "SOURCE" },
    });
    await prisma.storeProduct.updateMany({
      where: { productId: f.product.id },
      data: { isDirect: false, isHistorical: false },
    });
    await prisma.storeProduct.create({
      data: {
        organizationId: f.org.id,
        productId: f.product.id,
        storeId: source.id,
        isDirect: true,
      },
    });
    const admin = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    const change = {
      action: "SHARE" as const,
      sourceStoreId: source.id,
      targetStoreIds: [f.store.id],
      scope: "SELECTED" as const,
      productIds: [f.product.id],
      includeFuture: false,
      mutual: false,
    };
    const preview = await admin.stores.previewAssortmentShare(change);
    await admin.stores.applyAssortmentShare({
      change,
      previewToken: preview.previewToken,
      idempotencyKey: "shared-studio-grant",
    });
    const job = await prisma.productImageStudioJob.create({
      data: {
        organizationId: f.org.id,
        productId: f.product.id,
        createdById: f.adminUser.id,
        status: ProductImageStudioJobStatus.SUCCEEDED,
        sourceImageUrl: "/uploads/products/source.webp",
        sourceImageMimeType: "image/webp",
        outputImageUrl: "/uploads/products/shared-generated.webp",
        backgroundMode: ProductImageStudioBackground.WHITE,
        provider: "test",
      },
    });
    const manager = createTestCaller({ ...f.managerUser, organizationId: f.org.id });
    await manager.productImageStudio.saveToProduct({
      jobId: job.id,
      productId: f.product.id,
      setAsPrimary: true,
    });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: f.product.id } })).photoUrl).toBe(
      job.outputImageUrl,
    );
    expect(
      await prisma.userStoreAccess.count({
        where: { userId: f.managerUser.id, storeId: source.id },
      }),
    ).toBe(0);
    await expect(
      manager.products.pricing({ productId: f.product.id, storeId: source.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.storeProduct.updateMany({
      where: { productId: f.product.id, storeId: f.store.id },
      data: { isActive: false },
    });
    await expect(
      manager.productImageStudio.saveToProduct({ jobId: job.id, productId: f.product.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("creates, processes, and saves a generated image to product media", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("PRODUCT_IMAGE_STUDIO_AI_MODEL", "gpt-5-nano");
    vi.stubEnv("PRODUCT_IMAGE_STUDIO_IMAGE_MODEL", "gpt-image-1-mini");
    vi.stubEnv("PRODUCT_IMAGE_STUDIO_IMAGE_QUALITY", "medium");

    const { org, product, adminUser } = await seedBase();
    const sourceBuffer = await createImageBuffer({ color: "#cfd8dc" });
    const generatedBuffer = await createImageBuffer({
      width: 1024,
      height: 1024,
      color: "#ffffff",
    });
    const uploadedSource = await uploadProductImageBuffer({
      organizationId: org.id,
      buffer: sourceBuffer,
      contentType: "image/png",
      sourceFileName: "source.png",
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_1",
          status: "completed",
          data: [
            {
              id: "ig_1",
              status: "completed",
              revised_prompt: "Edited product on clean studio background.",
              b64_json: generatedBuffer.toString("base64"),
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const created = await createProductImageStudioJob({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "studio-create",
      sourceImageUrl: uploadedSource.url,
      productId: product.id,
      backgroundMode: ProductImageStudioBackground.WHITE,
      outputFormat: ProductImageStudioOutputFormat.SQUARE,
      centered: true,
      improveVisibility: true,
      softShadow: true,
      tighterCrop: false,
      brighterPresentation: true,
    });
    expect(created.deduplicated).toBe(false);
    await expect(getProductImageStudioJob(org.id, created.jobId)).resolves.toMatchObject({
      status: ProductImageStudioJobStatus.QUEUED,
      attemptCount: 0,
    });
    await runProductImageStudioJob({ jobId: created.jobId });

    const job = await getProductImageStudioJob(org.id, created.jobId);
    expect(job.status).toBe(ProductImageStudioJobStatus.SUCCEEDED);
    expect(job.outputImageUrl).toContain("/uploads/imported-products/");
    expect(job.provider).toBe("openai");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const fetchRequestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const fetchBody = fetchRequestInit?.body ? JSON.parse(String(fetchRequestInit.body)) : null;
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/images/edits");
    expect(fetchBody).toMatchObject({
      model: "gpt-image-1-mini",
      size: "1024x1024",
      quality: "medium",
      output_format: "jpeg",
      output_compression: 95,
      background: "opaque",
    });
    expect(fetchBody).not.toHaveProperty("input_fidelity");
    expect(fetchBody).not.toHaveProperty("tools");
    expect(fetchBody.images[0].image_url).toMatch(/^data:image\/png;base64,/);

    const saved = await saveGeneratedImageToProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "studio-save",
      jobId: created.jobId,
      productId: product.id,
      setAsPrimary: true,
    });

    const productAfterSave = await prisma.product.findUniqueOrThrow({
      where: { id: product.id },
      select: {
        photoUrl: true,
        images: {
          select: {
            id: true,
            url: true,
            position: true,
            isAiGenerated: true,
          },
          orderBy: { position: "asc" },
        },
      },
    });

    expect(saved.productId).toBe(product.id);
    expect(productAfterSave.photoUrl).toBe(job.outputImageUrl);
    expect(productAfterSave.images[0]?.url).toBe(job.outputImageUrl);
    expect(productAfterSave.images[0]?.isAiGenerated).toBe(true);

    const overview = await getProductImageStudioOverview(org.id);
    expect(overview.totalJobs).toBe(1);
    expect(overview.succeededJobs).toBe(1);

    const listedJobs = await listProductImageStudioJobs(org.id);
    expect(listedJobs).toHaveLength(1);
    expect(listedJobs[0]?.savedProductImageId).toBe(productAfterSave.images[0]?.id);
  });

  it("persists balanced/detail modes separately and sends the selected quality", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("PRODUCT_IMAGE_STUDIO_IMAGE_MODEL", "");
    vi.stubEnv("OPENAI_IMAGE_MODEL", "");
    vi.stubEnv("PRODUCT_IMAGE_STUDIO_IMAGE_QUALITY", "medium");
    const { org, adminUser } = await seedBase();
    const source = await uploadProductImageBuffer({
      organizationId: org.id,
      buffer: await createImageBuffer(),
      contentType: "image/png",
      sourceFileName: "quality.png",
    });
    const output = await createImageBuffer({ width: 1024, height: 1024 });
    const fetchMock = vi.fn().mockImplementation(async () =>
      Response.json({
        status: "completed",
        data: [{ b64_json: output.toString("base64") }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const ids: string[] = [];
    for (const highQuality of [false, true]) {
      const job = await createProductImageStudioJob({
        organizationId: org.id,
        actorId: adminUser.id,
        requestId: `quality-${highQuality}`,
        sourceImageUrl: source.url,
        backgroundMode: ProductImageStudioBackground.WHITE,
        outputFormat: ProductImageStudioOutputFormat.SQUARE,
        centered: true,
        improveVisibility: true,
        highQuality,
      });
      ids.push(job.jobId);
      expect((await getProductImageStudioJob(org.id, job.jobId)).highQuality).toBe(highQuality);
    }
    expect(ids[0]).not.toBe(ids[1]);
    for (const id of ids) await runProductImageStudioJob({ jobId: id });
    expect(fetchMock.mock.calls.map((call) => JSON.parse(String(call[1].body)).quality)).toEqual([
      "medium",
      "high",
    ]);
    expect(fetchMock.mock.calls.map((call) => JSON.parse(String(call[1].body)).model)).toEqual([
      "gpt-image-2.5-sunburst",
      "gpt-image-2.5-sunburst",
    ]);
  });

  it.each(["network-timeout", "empty-success"])(
    "does not silently pay for another image after %s",
    async (outcome) => {
      vi.stubEnv("OPENAI_API_KEY", "sk-test");
      const { org, adminUser } = await seedBase();
      const source = await uploadProductImageBuffer({
        organizationId: org.id,
        buffer: await createImageBuffer(),
        contentType: "image/png",
        sourceFileName: "timeout.png",
      });
      const fetchMock = vi.fn().mockImplementation(async () => {
        if (outcome === "network-timeout") throw new DOMException("Timed out", "TimeoutError");
        return Response.json({ status: "completed", output: [] });
      });
      vi.stubGlobal("fetch", fetchMock);
      const job = await createProductImageStudioJob({
        organizationId: org.id,
        actorId: adminUser.id,
        requestId: outcome,
        sourceImageUrl: source.url,
        backgroundMode: ProductImageStudioBackground.WHITE,
        outputFormat: ProductImageStudioOutputFormat.SQUARE,
        centered: true,
        improveVisibility: true,
      });
      await runProductImageStudioJob({ jobId: job.jobId });
      expect((await getProductImageStudioJob(org.id, job.jobId)).status).toBe(
        ProductImageStudioJobStatus.FAILED,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("persists DeepSeek analysis and the direct image execution in one finished job", async () => {
    vi.stubEnv("AI_PROVIDER", "deepseek");
    vi.stubEnv("DEEPSEEK_API_KEY", "deepseek-synthetic-test-key");
    vi.stubEnv("OPENAI_API_KEY", "openai-synthetic-test-key");
    vi.stubEnv("PRODUCT_IMAGE_STUDIO_IMAGE_MODEL", "gpt-image-1");
    const { org, adminUser } = await seedBase();
    const buffer = await createImageBuffer();
    const source = await uploadProductImageBuffer({
      organizationId: org.id,
      buffer,
      contentType: "image/png",
      sourceFileName: "deepseek-source.png",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    subject: "Synthetic product",
                    detailsToPreserve: ["Original shape"],
                  }),
                },
              ],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json(
          { data: [{ b64_json: buffer.toString("base64") }] },
          { headers: { "x-request-id": "req-synthetic-studio" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const created = await createProductImageStudioJob({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "deepseek-job",
      sourceImageUrl: source.url,
      backgroundMode: ProductImageStudioBackground.WHITE,
      outputFormat: ProductImageStudioOutputFormat.SQUARE,
      centered: true,
      improveVisibility: true,
    });
    await runProductImageStudioJob({ jobId: created.jobId });
    const job = await getProductImageStudioJob(org.id, created.jobId);
    expect(job).toMatchObject({
      status: "SUCCEEDED",
      provider: "openai",
      providerJobId: "req-synthetic-studio",
    });
    expect(job.providerRequestJson).toMatchObject({
      model: "gpt-image-2.5-sunburst",
      endpoint: "images/edits",
      analysis: {
        provider: "deepseek",
        status: "completed",
        observations: { subject: "Synthetic product" },
      },
    });
    expect(JSON.stringify(job.providerRequestJson)).not.toContain("base64");
    expect(JSON.stringify(job.providerRequestJson)).not.toContain("synthetic-test-key");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps actionable errors and safe provider diagnostics when image access is rejected", async () => {
    vi.stubEnv("OPENAI_API_KEY", "synthetic-test-key");
    const { org, adminUser } = await seedBase();
    const source = await uploadProductImageBuffer({
      organizationId: org.id,
      buffer: await createImageBuffer(),
      contentType: "image/png",
      sourceFileName: "rejected-source.png",
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            {
              error: { message: "Raw gpt-image provider secret details", code: "invalid_api_key" },
            },
            { status: 401, headers: { "x-request-id": "req-image-rejected" } },
          ),
        ),
    );
    const created = await createProductImageStudioJob({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "rejected-job",
      sourceImageUrl: source.url,
      backgroundMode: ProductImageStudioBackground.WHITE,
      outputFormat: ProductImageStudioOutputFormat.SQUARE,
      centered: true,
      improveVisibility: true,
    });
    await runProductImageStudioJob({ jobId: created.jobId });
    const job = await getProductImageStudioJob(org.id, created.jobId);
    expect(job).toMatchObject({
      status: "FAILED",
      errorMessage: "productImageStudioProviderAccessDenied",
      sourceImageUrl: source.url,
      outputImageUrl: null,
      canRetry: true,
    });
    expect(job.providerResponseJson).toMatchObject({
      provider: "openai",
      status: 401,
      requestId: "req-image-rejected",
    });
    expect(JSON.stringify(job.providerResponseJson)).not.toContain("secret details");
  });

  it("enforces organization scoping for job reads", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");

    const first = await seedBase();
    const second = await prisma.organization.create({
      data: { name: "Other Org" },
    });

    const sourceBuffer = await createImageBuffer();
    const generatedBuffer = await createImageBuffer({ width: 1024, height: 1024 });
    const uploadedSource = await uploadProductImageBuffer({
      organizationId: first.org.id,
      buffer: sourceBuffer,
      contentType: "image/png",
      sourceFileName: "source.png",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "completed",
            data: [
              {
                id: "ig_2",
                status: "completed",
                b64_json: generatedBuffer.toString("base64"),
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    const created = await createProductImageStudioJob({
      organizationId: first.org.id,
      actorId: first.adminUser.id,
      requestId: "studio-scope",
      sourceImageUrl: uploadedSource.url,
      productId: first.product.id,
      backgroundMode: ProductImageStudioBackground.WHITE,
      outputFormat: ProductImageStudioOutputFormat.SQUARE,
      centered: true,
      improveVisibility: true,
      softShadow: false,
      tighterCrop: false,
      brighterPresentation: false,
    });
    await runProductImageStudioJob({ jobId: created.jobId });

    await expect(getProductImageStudioJob(second.id, created.jobId)).rejects.toMatchObject({
      message: "productImageStudioJobNotFound",
    });
  });

  it("deduplicates concurrent identical requests and claims one provider attempt", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const { org, product, adminUser } = await seedBase();
    const sourceBuffer = await createImageBuffer();
    const generatedBuffer = await createImageBuffer({ width: 1024, height: 1024 });
    const uploadedSource = await uploadProductImageBuffer({
      organizationId: org.id,
      buffer: sourceBuffer,
      contentType: "image/png",
      sourceFileName: "concurrent-source.png",
    });
    const input = {
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "studio-concurrent",
      sourceImageUrl: uploadedSource.url,
      productId: product.id,
      backgroundMode: ProductImageStudioBackground.WHITE,
      outputFormat: ProductImageStudioOutputFormat.SQUARE,
      centered: true,
      improveVisibility: true,
      softShadow: false,
      tighterCrop: false,
      brighterPresentation: false,
    };
    const requests = await Promise.all([
      createProductImageStudioJob(input),
      createProductImageStudioJob({ ...input, requestId: "studio-concurrent-2" }),
    ]);
    expect(new Set(requests.map((request) => request.jobId)).size).toBe(1);
    expect(requests.filter((request) => request.deduplicated)).toHaveLength(1);
    await expect(
      prisma.productImageStudioJob.count({ where: { organizationId: org.id } }),
    ).resolves.toBe(1);
    await expect(
      prisma.auditLog.count({
        where: { entity: "ProductImageStudioJob", action: "PRODUCT_IMAGE_STUDIO_JOB_CREATED" },
      }),
    ).resolves.toBe(1);

    const heldProvider = deferred<Response>();
    const fetchMock = vi.fn().mockImplementation(() => heldProvider.promise);
    vi.stubGlobal("fetch", fetchMock);
    const jobId = requests[0]?.jobId as string;
    const firstWorker = runProductImageStudioJob({ jobId });
    await waitFor(() => fetchMock.mock.calls.length === 1);
    const secondWorker = await runProductImageStudioJob({ jobId });
    heldProvider.resolve(
      new Response(
        JSON.stringify({
          status: "completed",
          data: [
            {
              id: "ig-concurrent",
              status: "completed",
              b64_json: generatedBuffer.toString("base64"),
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const firstResult = await firstWorker;
    const job = await prisma.productImageStudioJob.findUniqueOrThrow({ where: { id: jobId } });

    expect(firstResult).toMatchObject({ status: "ok", details: { status: "SUCCEEDED" } });
    expect(secondWorker.status).toBe("skipped");
    expect(job.status).toBe(ProductImageStudioJobStatus.SUCCEEDED);
    expect(job.attemptCount).toBe(1);
    expect(job.leaseToken).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["success", "failure"] as const)(
    "fences a stale Image Studio worker after timeout when provider returns %s",
    async (outcome) => {
      vi.stubEnv("OPENAI_API_KEY", "sk-test");
      const { org, product, adminUser } = await seedBase();
      const sourceBuffer = await createImageBuffer();
      const generatedBuffer = await createImageBuffer({ width: 1024, height: 1024 });
      const uploadedSource = await uploadProductImageBuffer({
        organizationId: org.id,
        buffer: sourceBuffer,
        contentType: "image/png",
        sourceFileName: `stale-${outcome}.png`,
      });
      const created = await createProductImageStudioJob({
        organizationId: org.id,
        actorId: adminUser.id,
        requestId: `studio-stale-${outcome}`,
        sourceImageUrl: uploadedSource.url,
        productId: product.id,
        backgroundMode: ProductImageStudioBackground.WHITE,
        outputFormat: ProductImageStudioOutputFormat.SQUARE,
        centered: true,
        improveVisibility: true,
      });
      const heldProvider = deferred<Response>();
      const fetchMock = vi
        .fn()
        .mockImplementationOnce(() => heldProvider.promise)
        .mockRejectedValue(new Error("provider remains unavailable"));
      vi.stubGlobal("fetch", fetchMock);

      const oldWorker = runProductImageStudioJob({ jobId: created.jobId });
      await waitFor(() => fetchMock.mock.calls.length === 1);
      await prisma.productImageStudioJob.update({
        where: { id: created.jobId },
        data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
      });
      const recovery = await runProductImageStudioJob({ jobId: created.jobId });
      if (outcome === "success") {
        heldProvider.resolve(
          new Response(
            JSON.stringify({
              status: "completed",
              data: [
                {
                  id: "ig-stale",
                  status: "completed",
                  b64_json: generatedBuffer.toString("base64"),
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      } else {
        heldProvider.reject(new Error("held provider failure"));
      }
      const staleResult = await oldWorker;
      const [job, timeoutAudits, terminalAudits] = await Promise.all([
        prisma.productImageStudioJob.findUniqueOrThrow({ where: { id: created.jobId } }),
        prisma.auditLog.count({
          where: {
            entityId: created.jobId,
            action: "PRODUCT_IMAGE_STUDIO_JOB_TIMED_OUT",
          },
        }),
        prisma.auditLog.count({
          where: {
            entityId: created.jobId,
            action: {
              in: ["PRODUCT_IMAGE_STUDIO_JOB_SUCCEEDED", "PRODUCT_IMAGE_STUDIO_JOB_FAILED"],
            },
          },
        }),
      ]);

      expect(recovery.status).toBe("skipped");
      expect(staleResult).toMatchObject({
        status: "skipped",
        details: { reason: "leaseLost" },
      });
      expect(job.status).toBe(ProductImageStudioJobStatus.FAILED);
      expect(job.errorMessage).toBe("productImageStudioJobTimedOut");
      expect(job.outputImageUrl).toBeNull();
      expect(job.activeDedupeKey).toBeNull();
      expect(job.leaseToken).toBeNull();
      expect(timeoutAudits).toBe(1);
      expect(terminalAudits).toBe(0);
    },
  );
});
