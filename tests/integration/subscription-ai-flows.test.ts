import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { ProductImageStudioBackground, ProductImageStudioOutputFormat } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { createProductImageStudioJob, getProductImageStudioJob, runProductImageStudioJob } from "@/server/services/productImageStudio";
import { uploadProductImageBuffer } from "@/server/services/productImageStorage";
import { getSubscriptionUsage, reserveSubscriptionUsage, settleSubscriptionUsage } from "@/server/billing/subscriptionUsage";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

(shouldRunDbTests ? describe : describe.skip)("subscription image studio service and provider boundaries", () => {
  beforeEach(resetDatabase);
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  const fixture = async (plan: "STARTER" | "BUSINESS" = "BUSINESS") => {
    const f = await seedBase({ plan });
    await prisma.user.updateMany({ where: { organizationId: f.org.id, id: { not: f.adminUser.id } }, data: { isActive: false } });
    await prisma.organization.update({ where: { id: f.org.id }, data: {
      currentPeriodEndsAt: new Date(Date.now() + 30 * 86400000),
    } });
    await prisma.subscriptionContract.create({ data: { organizationId: f.org.id, catalogVersion: "2026-11" } });
    vi.stubEnv("OPENAI_API_KEY", "synthetic-image-provider");
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("PRODUCT_IMAGE_STUDIO_IMAGE_MODEL", "gpt-image-1-mini");
    const buffer = await sharp({ create: { width: 800, height: 800, channels: 3, background: "#ccc" } }).png().toBuffer();
    const uploaded = await uploadProductImageBuffer({ organizationId: f.org.id, buffer,
      contentType: "image/png", sourceFileName: "synthetic.png" });
    const input = { organizationId: f.org.id, actorId: f.adminUser.id, requestId: "studio-test",
      sourceImageUrl: uploaded.url, productId: f.product.id,
      backgroundMode: ProductImageStudioBackground.WHITE, outputFormat: ProductImageStudioOutputFormat.SQUARE,
      centered: true, improveVisibility: true, softShadow: false, tighterCrop: false, brighterPresentation: false };
    return { ...f, input, buffer };
  };
  const images = async (id: string) => (await getSubscriptionUsage(id)).find(r => r.resource === "images")!;
  it("atomically reserves at enqueue, deduplicates work and commits one successful image", async () => {
    const f = await fixture();
    const provider = vi.fn(async () => Response.json({ data: [{ b64_json: f.buffer.toString("base64") }] }));
    vi.stubGlobal("fetch", provider);
    const first = await createProductImageStudioJob(f.input);
    const replay = await createProductImageStudioJob(f.input);
    expect(replay.jobId).toBe(first.jobId);
    expect(await images(f.org.id)).toMatchObject({ used: 0, reserved: 1, remaining: 4 });
    await runProductImageStudioJob({ jobId: first.jobId });
    await runProductImageStudioJob({ jobId: first.jobId });
    expect((await getProductImageStudioJob(f.org.id, first.jobId)).status).toBe("SUCCEEDED");
    expect(provider).toHaveBeenCalledTimes(1);
    expect(await images(f.org.id)).toMatchObject({ used: 1, reserved: 0, remaining: 4 });
    expect((await getSubscriptionUsage(f.org.id)).find(r => r.resource === "imageVendorBudgetMinor")?.used).toBeGreaterThan(0);
  });
  it("releases the client image allowance for a provider rejection without a paid-result fiction", async () => {
    const f = await fixture();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "Synthetic rejection" } }, { status: 400 })));
    const job = await createProductImageStudioJob(f.input);
    await runProductImageStudioJob({ jobId: job.jobId });
    expect((await getProductImageStudioJob(f.org.id, job.jobId)).status).toBe("FAILED");
    expect(await images(f.org.id)).toMatchObject({ used: 0, reserved: 0, remaining: 5 });
    expect((await getSubscriptionUsage(f.org.id)).find(r => r.resource === "imageVendorBudgetMinor"))
      .toMatchObject({ used: 0, reserved: 0 });
  });
  it("rejects a missing feature or exhausted image allowance before enqueuing/provider calls", async () => {
    const f = await fixture("STARTER");
    const provider = vi.fn(); vi.stubGlobal("fetch", provider);
    await expect(createProductImageStudioJob(f.input)).rejects.toThrow();
    expect(await prisma.productImageStudioJob.count()).toBe(0);
    expect(provider).not.toHaveBeenCalled();
  });
  it("does not enqueue an image beyond the monthly budget", async () => {
    const f = await fixture();
    const spent = await reserveSubscriptionUsage({ organizationId: f.org.id, resource: "images", operationKey: "prior", units: 5 });
    await settleSubscriptionUsage(spent, true);
    const provider = vi.fn(); vi.stubGlobal("fetch", provider);
    await expect(createProductImageStudioJob(f.input)).rejects.toThrow("billingUsageLimitReached");
    expect(await prisma.productImageStudioJob.count()).toBe(0);
    expect(provider).not.toHaveBeenCalled();
  });
});
