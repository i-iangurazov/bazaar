import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, type Locator } from "playwright";
import sharp from "sharp";
import { baamTestEnvironment, assertBaamTestDatabase } from "./environment";
import { workflowTitle, type WorkflowAction } from "../../src/lib/baam/workflows";
Object.assign(process.env, baamTestEnvironment());
assertBaamTestDatabase();
const { prisma } = await import("../../src/server/db/prisma");
const { getLogger } = await import("../../src/server/logging");
const { businessCaller } = await import("../../src/server/services/baamBusiness");
const fixture = JSON.parse(await readFile("artifacts/baam-companion/fixture.json", "utf8"));
const user = await prisma.user.findUniqueOrThrow({ where: { id: fixture.adminId } });
assert.equal(user.organizationId, fixture.organizationId);
const ctx = {
  prisma,
  user: { ...user, organizationId: fixture.organizationId, isPlatformOwner: false },
  impersonator: null,
  impersonationSessionId: null,
  ip: "127.0.0.1",
  requestId: randomUUID(),
  logger: getLogger("baam-fast-browser"),
};
const api = businessCaller(ctx);
const suffix = Date.now().toString(),
  register = await api.pos.registers.create({
    storeId: fixture.storeId,
    name: `QA BAAM ${suffix}`,
    code: randomUUID().slice(0, 8),
  });
const shift = await api.pos.shifts.open({
  registerId: register.id,
  openingCashKgs: 0,
  idempotencyKey: randomUUID(),
});
const base =
  process.env.BAAM_TEST_HTTPS === "1" ? "https://localhost:3121" : "http://localhost:3121";
const directory = "artifacts/baam-companion/after/fast";
await mkdir(directory, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const report: unknown[] = [];
try {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "ru", url: base }]);
  const { csrfToken } = await (await context.request.get(base + "/api/auth/csrf")).json();
  await context.request.post(base + "/api/auth/callback/credentials", {
    form: { csrfToken, email: user.email, password: "BaamCompanion123!", json: "true" },
  });
  assert.equal(
    (await (await context.request.get(base + "/api/auth/session")).json()).user.organizationId,
    fixture.organizationId,
  );
  await page.goto(`${base}/baam?storeId=${fixture.storeId}`);
  await page.locator("[data-baam-input]").waitFor({ timeout: 90000 });
  async function start(action: WorkflowAction) {
    await page.getByRole("button", { name: "Новый диалог", exact: true }).click();
    await page.getByRole("button", { name: "Действия BAAM", exact: true }).click();
    const start = performance.now();
    await page.getByRole("menuitem", { name: workflowTitle(action, "ru"), exact: true }).click();
    const form = page.locator("[data-baam-workflow]").last();
    await form.waitFor({ timeout: 60000 });
    report.push({ action, formMs: performance.now() - start });
    return form;
  }
  async function fill(form: Locator, path: string, value: string) {
    await form.locator(`[data-workflow-field="${path}"] input:not([type=file])`).fill(value);
  }
  async function choose(form: Locator, path: string, label: string) {
    await form.locator(`[data-workflow-field="${path}"]`).getByRole("combobox").click();
    const list = page.getByRole("listbox");
    await list.locator("..").getByRole("textbox").fill(label);
    await list.getByRole("option").filter({ hasText: label }).first().click();
  }
  async function execute(form: Locator, action: WorkflowAction) {
    const response = page.waitForResponse(
      (r) => r.url().includes("baam.submitWorkflow") && r.request().method() === "POST",
    );
    await form.getByRole("button", { name: workflowTitle(action, "ru"), exact: true }).click();
    const r = await response;
    assert.equal(r.status(), 200);
    await page.waitForTimeout(300);
    const error = await form.locator("[role=alert]").allTextContents();
    assert.deepEqual(error, []);
  }
  async function operate(form: Locator, name: string) {
    const response = page.waitForResponse(
      (r) => r.url().includes("baam.submitWorkflow") && r.request().method() === "POST",
    );
    await form.getByRole("button", { name, exact: true }).click();
    assert.equal((await response).status(), 200);
    await page.waitForTimeout(200);
  }
  let form = await start("product_create");
  await fill(form, "name", `QA photo ${suffix}`);
  await fill(form, "basePriceKgs", "100");
  const photo = form.locator('[data-workflow-field="attachmentId"]');
  await photo.locator("input[type=file]").setInputFiles({
    name: "invalid.heic",
    mimeType: "image/heic",
    buffer: Buffer.from("invalid-test-photo"),
  });
  await photo.getByRole("alert").waitFor();
  assert.equal(
    await form.locator('[data-workflow-field="name"] input').inputValue(),
    `QA photo ${suffix}`,
  );
  await page.screenshot({ path: `${directory}/photo-error.png` });
  const large = await sharp(randomBytes(1100 * 1100 * 3), {
    raw: { width: 1100, height: 1100, channels: 3 },
  })
    .png()
    .toBuffer();
  let firstUpload = true;
  await page.route("**/api/baam/media", async (route) => {
    if (firstUpload) {
      firstUpload = false;
      await route.abort("failed");
    } else await route.continue();
  });
  await photo
    .locator("input[type=file]")
    .setInputFiles({ name: "large.png", mimeType: "image/png", buffer: large });
  await photo.getByRole("alert").waitFor();
  const upload = page.waitForResponse(
    (r) => r.url().endsWith("/api/baam/media") && r.request().method() === "POST",
  );
  await photo.getByRole("button", { name: "Повторить", exact: true }).click();
  const uploaded = await upload;
  assert.equal(uploaded.status(), 200);
  const attachment = await uploaded.json();
  await page.unroute("**/api/baam/media");
  await photo.locator("img").waitFor();
  await page.screenshot({ path: `${directory}/product-photo-desktop.png` });
  await execute(form, "product_create");
  const product = await prisma.product.findFirstOrThrow({
    where: { organizationId: fixture.organizationId, name: `QA photo ${suffix}` },
  });
  assert.equal(product.photoUrl, attachment.url);
  assert.equal(
    await prisma.product.count({
      where: { organizationId: fixture.organizationId, name: product.name },
    }),
    1,
  );
  report.push({
    photoInputBytes: large.length,
    photoStatus: uploaded.status(),
    productId: product.id,
    photoRetry: true,
  });
  form = await start("product_create");
  await fill(form, "name", `QA no photo ${suffix}`);
  await fill(form, "basePriceKgs", "50");
  await page.waitForTimeout(1000);
  await page.reload();
  form = page.locator("[data-baam-workflow]").last();
  await form.waitFor();
  assert.equal(
    await form.locator('[data-workflow-field="name"] input').inputValue(),
    `QA no photo ${suffix}`,
  );
  // Lose the response after the server commits. Recovery must replay the same request.
  let lost = false;
  await page.route("**/api/trpc/baam.submitWorkflow*", async (route) => {
    if (!lost) {
      lost = true;
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.abort("failed");
    } else await route.continue();
  });
  await form.getByRole("button", { name: "Создать товар", exact: true }).click();
  await form.getByRole("button", { name: "Проверить результат", exact: true }).waitFor();
  await form.getByRole("button", { name: "Проверить результат", exact: true }).click();
  await form.getByRole("link", { name: "Открыть в Bazaar", exact: true }).waitFor();
  await page.unroute("**/api/trpc/baam.submitWorkflow*");
  const second = await prisma.product.findFirstOrThrow({
    where: { organizationId: fixture.organizationId, name: `QA no photo ${suffix}` },
  });
  assert.equal(
    await prisma.product.count({
      where: { organizationId: fixture.organizationId, name: second.name },
    }),
    1,
  );
  assert.equal(second.photoUrl, null);
  report.push({ restored: true, lostResponseRecovered: true, duplicates: 0 });
  const updateForm = page.waitForResponse(
    (r) => r.url().includes("baam.send") && r.request().method() === "POST",
  );
  await form.getByRole("button", { name: "Добавить или заменить фото", exact: true }).click();
  assert.equal((await updateForm).status(), 200);
  form = page.locator("[data-baam-workflow]").last();
  const changedPhoto = form.locator('[data-workflow-field="attachmentId"]');
  const updatedUpload = page.waitForResponse(
    (r) => r.url().endsWith("/api/baam/media") && r.request().method() === "POST",
  );
  await changedPhoto
    .locator("input[type=file]")
    .setInputFiles({ name: "attachment.png", mimeType: "image/png", buffer: large });
  assert.equal((await updatedUpload).status(), 200);
  await page.waitForTimeout(800);
  // Another normal editor changes the product after this form selected its version.
  await api.products.update({
    productId: second.id,
    storeId: fixture.storeId,
    sku: second.sku,
    name: second.name,
    baseUnitId: second.baseUnitId!,
    description: "QA concurrent editor",
    basePriceKgs: Number(second.basePriceKgs),
  });
  await operate(form, workflowTitle("product_update", "ru"));
  await form.getByRole("alert").first().waitFor();
  await page.screenshot({ path: `${directory}/product-conflict.png` });
  await operate(form, "Обновить данные");
  await execute(form, "product_update");
  assert((await prisma.product.findUniqueOrThrow({ where: { id: second.id } })).photoUrl);
  assert.equal(
    await prisma.product.count({
      where: { organizationId: fixture.organizationId, name: second.name },
    }),
    1,
  );
  report.push({
    photoAttachedToExistingProduct: true,
    concurrentProductChangeDetected: true,
    refreshThenSave: true,
  });

  form = await start("stock_receive");
  await form.getByRole("button", { name: "Добавить строку", exact: true }).click();
  await choose(form, "lines.0.productId", product.name);
  await fill(form, "lines.0.quantity", "2");
  await fill(form, "lines.0.unitCost", "0");
  await form.getByRole("button", { name: "Добавить строку", exact: true }).click();
  await choose(form, "lines.1.productId", second.name);
  await fill(form, "lines.1.quantity", "3");
  await fill(form, "lines.1.unitCost", "10");
  await page.screenshot({ path: `${directory}/receiving.png` });
  await execute(form, "stock_receive");
  assert.equal(
    (
      await prisma.inventorySnapshot.findFirstOrThrow({
        where: { storeId: fixture.storeId, productId: product.id },
      })
    ).onHand,
    2,
  );
  async function cart() {
    const form = await start("pos_create_draft");
    await choose(form, "registerId", register.name);
    await form.getByRole("button", { name: "Добавить строку", exact: true }).click();
    await choose(form, "lines.0.productId", product.name);
    await fill(form, "lines.0.qty", "2");
    await form.getByRole("button", { name: "Добавить строку", exact: true }).click();
    await choose(form, "lines.1.productId", second.name);
    await fill(form, "lines.1.qty", "3");
    await execute(form, "pos_create_draft");
    await form.getByRole("button", { name: "Отложить чек", exact: true }).waitFor();
    return form;
  }
  form = await cart();
  for (const name of ["Отложить чек", "Продолжить чек", "Отменить чек"]) {
    await operate(form, name);
  }
  let sale = await prisma.customerOrder.findFirstOrThrow({
    where: { registerId: register.id },
    orderBy: { createdAt: "desc" },
  });
  assert.equal(sale.status, "CANCELED");
  form = await cart();
  const method = form.locator('[data-workflow-field="payments.0.method"]');
  await method.getByRole("combobox").click();
  await page.getByRole("option", { name: "Наличные", exact: true }).click();
  await page.screenshot({ path: `${directory}/receipt.png` });
  await operate(form, "Завершить продажу");
  sale = await prisma.customerOrder.findFirstOrThrow({
    where: { registerId: register.id },
    orderBy: { createdAt: "desc" },
  });
  assert.equal(sale.status, "COMPLETED");
  assert.equal(Number(sale.totalKgs), 350);
  for (const id of [product.id, second.id])
    assert.equal(
      (
        await prisma.inventorySnapshot.findFirstOrThrow({
          where: { storeId: fixture.storeId, productId: id },
        })
      ).onHand,
      0,
    );
  report.push({
    receipt: sale.number,
    totalKgs: 350,
    heldResumedCancelled: true,
    stockAfterSale: 0,
  });
  form = await start("product_create");
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    await page.screenshot({ path: `${directory}/form-${width}.png` });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
  }
  for (const locale of ["en", "kg"]) {
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: base }]);
    await page.reload();
    await page.locator("[data-baam-workflow]").last().waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${directory}/form-${locale}.png` });
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${directory}/form-${locale}-dark.png` });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(report));
  await writeFile(`${directory}/report.json`, JSON.stringify({ report, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${directory}/failure.png` });
  await writeFile(
    `${directory}/failure.json`,
    JSON.stringify({ errors, text: await page.locator("body").innerText() }, null, 2),
  );
  throw error;
} finally {
  await browser.close();
  const active = await api.pos.sales.activeDraft({ registerId: register.id });
  if (active) await api.pos.sales.cancelDraft({ saleId: active.id });
  const report = await api.pos.shifts.xReport({ shiftId: shift.id });
  await api.pos.shifts.close({
    shiftId: shift.id,
    closingCashCountedKgs: report.summary.expectedCashKgs,
    idempotencyKey: randomUUID(),
  });
  await prisma.$disconnect();
  const { getRedisPublisher } = await import("../../src/server/redis");
  const publisher = getRedisPublisher();
  if (publisher) {
    try {
      await publisher.quit();
    } finally {
      publisher.disconnect();
    }
  }
}
