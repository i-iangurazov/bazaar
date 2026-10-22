// Explicit local acceptance: real HTTP jobs, real DeepSeek and synthetic products.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { baamTestEnvironment, assertBaamTestDatabase } from "./environment";
assert.equal(process.env.BAAM_LIVE_PROVIDER, "1");
const require = createRequire(import.meta.url);
createRequire(require.resolve("next/package.json"))("@next/env").loadEnvConfig(process.cwd(), true);
Object.assign(process.env, baamTestEnvironment());
assertBaamTestDatabase();
const { prisma } = await import("../../src/server/db/prisma");
const fixture = JSON.parse(await readFile("artifacts/baam-companion/fixture.json", "utf8"));
assert.equal(
  (await prisma.organization.findUniqueOrThrow({ where: { id: fixture.organizationId } })).name,
  "BAAM Test Organization",
);
const base = "http://localhost:3121",
  dir = "artifacts/baam-companion/recheck";
await mkdir(dir, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addCookies([{ name: "NEXT_LOCALE", value: "ru", url: base }]);
const { csrfToken } = await (await context.request.get(`${base}/api/auth/csrf`)).json();
await context.request.post(`${base}/api/auth/callback/credentials`, {
  form: {
    csrfToken,
    email: "admin@test.local",
    password: "BaamCompanion123!",
    json: "true",
    callbackUrl: base + "/products",
  },
});
async function api(route: string, input: unknown, mutation = false) {
  const response = mutation
    ? await context.request.post(`${base}/api/trpc/${route}`, { data: { json: input } })
    : await context.request.get(
        `${base}/api/trpc/${route}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`,
      );
  const body = await response.json();
  assert(!body.error, JSON.stringify(body.error));
  return body.result.data.json;
}
assert.equal((await api("baam.companion", null)).organizationId, fixture.organizationId);
const results: Array<Record<string, unknown>> = [];
async function run(name: string, work: () => Promise<unknown>) {
  const start = performance.now();
  try {
    results.push({
      name,
      pass: true,
      detail: await work(),
      ms: Math.round(performance.now() - start),
    });
  } catch (e) {
    results.push({ name, pass: false, error: e instanceof Error ? e.message : String(e) });
  }
  console.log(JSON.stringify(results.at(-1)));
  await writeFile(`${dir}/catalog.json`, JSON.stringify({ results }, null, 2));
}
try {
  const uploaded = await context.request.post(`${base}/api/product-image-studio/upload`, {
    multipart: {
      file: {
        name: "synthetic-dress.png",
        mimeType: "image/png",
        buffer: await readFile(`${dir}/source.png`),
      },
    },
  });
  assert.equal(uploaded.status(), 200);
  const source = await uploaded.json();
  const category = "QA AI Одежда";
  await prisma.productCategory.upsert({
    where: { organizationId_name: { organizationId: fixture.organizationId, name: category } },
    update: {},
    create: { organizationId: fixture.organizationId, name: category },
  });
  for (const [key, label] of [
    ["qa_ai_color", "Цвет"],
    ["qa_ai_material", "Материал"],
  ]) {
    await prisma.attributeDefinition.upsert({
      where: { organizationId_key: { organizationId: fixture.organizationId, key } },
      update: {},
      create: {
        organizationId: fixture.organizationId,
        key,
        labelRu: label,
        labelKg: label,
        type: "TEXT",
      },
    });
    await prisma.categoryAttributeTemplate.upsert({
      where: {
        organizationId_category_attributeKey: {
          organizationId: fixture.organizationId,
          category,
          attributeKey: key,
        },
      },
      update: {},
      create: { organizationId: fixture.organizationId, category, attributeKey: key },
    });
  }
  const product = await prisma.product.create({
    data: {
      organizationId: fixture.organizationId,
      sku: `AI-JOB-${Date.now()}`,
      name: "QA бордовое платье",
      category,
      categories: [category],
      unit: "pcs",
      baseUnitId: fixture.unitId,
      photoUrl: source.url,
      variants: { create: { attributes: { qa_ai_material: "Ручное значение" } } },
      storeProducts: {
        create: { organizationId: fixture.organizationId, storeId: fixture.storeId },
      },
    },
  });
  const noPhoto = await prisma.product.create({
    data: {
      organizationId: fixture.organizationId,
      sku: `AI-NO-PHOTO-${Date.now()}`,
      name: "QA без фотографии",
      unit: "pcs",
      baseUnitId: fixture.unitId,
      storeProducts: {
        create: { organizationId: fixture.organizationId, storeId: fixture.storeId },
      },
    },
  });
  const readProduct = () =>
    prisma.product.findUniqueOrThrow({ where: { id: product.id }, include: { variants: true } });
  async function job(ids: string[], overwriteExisting: boolean) {
    const started = performance.now();
    let value = await api(
      "products.startDescriptionGenerationJob",
      {
        source: "PRODUCTS_PAGE",
        storeId: fixture.storeId,
        productIds: ids,
        locale: "ru",
        overwriteExisting,
      },
      true,
    );
    while (
      ["QUEUED", "PROCESSING"].includes(value.status) &&
      performance.now() - started < 180000
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      value = await api("products.descriptionGenerationJob", { jobId: value.id });
    }
    assert.equal(value.status, "DONE", JSON.stringify(value.items));
    return value;
  }
  await run("bulk-description-and-specs-persist", async () => {
    const value = await job([product.id, noPhoto.id], false);
    const saved = await readProduct();
    assert((saved.description?.length ?? 0) > 100);
    const attributes = saved.variants[0].attributes as Record<string, unknown>;
    assert.equal(attributes.qa_ai_material, "Ручное значение");
    assert(typeof attributes.qa_ai_color === "string" && attributes.qa_ai_color.length > 2);
    assert.equal(
      value.items.find((item: { productId: string }) => item.productId === noPhoto.id)?.status,
      "SKIPPED",
    );
    return {
      productId: product.id,
      descriptionLength: saved.description!.length,
      color: attributes.qa_ai_color,
      manualMaterialPreserved: true,
      noPhotoSkipped: true,
      jobId: value.id,
    };
  });
  await run("missing-only-preserves-existing-content", async () => {
    const before = await readProduct(),
      value = await job([product.id], false),
      after = await readProduct();
    assert.equal(after.description, before.description);
    assert.deepEqual(after.variants[0].attributes, before.variants[0].attributes);
    assert.equal(value.items[0].status, "SKIPPED");
    return { unchanged: true, reason: value.items[0].errorMessage };
  });
  await run("single-product-ai-button-and-save", async () => {
    const page = await context.newPage();
    await page.goto(`${base}/products/${product.id}`);
    const field = page.locator('textarea[name="description"]').first();
    await field.waitFor({ timeout: 90000 });
    const response = page.waitForResponse(
      (r) =>
        r.url().includes("/api/trpc/products.generateDescription") &&
        r.request().method() === "POST",
      { timeout: 90000 },
    );
    await page
      .getByRole("button", { name: "Сгенерировать с ИИ", exact: true })
      .filter({ visible: true })
      .first()
      .click();
    const generated = await (await response).json();
    assert(!generated[0]?.error && !generated.error, JSON.stringify(generated));
    await page.waitForFunction(
      () =>
        (document.querySelector('textarea[name="description"]') as HTMLTextAreaElement)?.value
          .length > 100,
    );
    const value = await field.inputValue();
    const save = page.waitForResponse(
      (r) => r.url().includes("/api/trpc/products.update") && r.request().method() === "POST",
      { timeout: 90000 },
    );
    await page.getByRole("button", { name: "Сохранить", exact: true }).first().click();
    const saved = await (await save).json();
    assert(!saved[0]?.error && !saved.error, JSON.stringify(saved));
    assert.equal((await readProduct()).description, value);
    await page.screenshot({ path: `${dir}/catalog-single-product.png` });
    return { generatedInUi: true, savedToDatabase: true, descriptionLength: value.length };
  });
  if (results.some((r) => !r.pass)) process.exitCode = 1;
} finally {
  await browser.close();
  await prisma.$disconnect();
}
