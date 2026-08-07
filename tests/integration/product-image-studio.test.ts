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
          output: [
            {
              id: "ig_1",
              type: "image_generation_call",
              status: "completed",
              revised_prompt: "Edited product on clean studio background.",
              result: generatedBuffer.toString("base64"),
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
    expect(fetchBody?.model).toBe("gpt-5-nano");
    expect(fetchBody?.tools?.[0]).toMatchObject({
      type: "image_generation",
      model: "gpt-image-1-mini",
      action: "edit",
      size: "1024x1024",
      quality: "medium",
      output_format: "jpeg",
      output_compression: 95,
      background: "opaque",
      input_fidelity: "high",
    });
    expect(fetchBody?.tools?.[0]).not.toHaveProperty("format");
    expect(fetchBody?.tools?.[0]).not.toHaveProperty("compression");

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
            output: [
              {
                id: "ig_2",
                type: "image_generation_call",
                status: "completed",
                result: generatedBuffer.toString("base64"),
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
          output: [
            {
              id: "ig-concurrent",
              type: "image_generation_call",
              status: "completed",
              result: generatedBuffer.toString("base64"),
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
              output: [
                {
                  id: "ig-stale",
                  type: "image_generation_call",
                  status: "completed",
                  result: generatedBuffer.toString("base64"),
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
