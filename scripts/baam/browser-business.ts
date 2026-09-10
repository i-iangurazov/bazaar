import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { baamTestEnvironment, assertBaamTestDatabase } from "./environment";
Object.assign(process.env, baamTestEnvironment());
assertBaamTestDatabase();
const { prisma } = await import("../../src/server/db/prisma");
const { businessCaller } = await import("../../src/server/services/baamBusiness");
const { getLogger } = await import("../../src/server/logging");
const fixture = JSON.parse(await readFile("artifacts/baam-companion/fixture.json", "utf8"));
const user = await prisma.user.findUniqueOrThrow({ where: { id: fixture.adminId } });
assert.equal(user.organizationId, fixture.organizationId);
const api = businessCaller({
  prisma,
  user: { ...user, organizationId: fixture.organizationId, isPlatformOwner: false },
  impersonator: null,
  impersonationSessionId: null,
  ip: "127.0.0.1",
  requestId: randomUUID(),
  logger: getLogger("baam-browser-business"),
});
const stamp = Date.now();
const register = await api.pos.registers.create({
  storeId: fixture.storeId,
  name: `BAAM Browser ${stamp}`,
  code: `B${stamp}`,
});
await api.pos.shifts.open({
  registerId: register.id,
  openingCashKgs: 0,
  idempotencyKey: randomUUID(),
});
const base = "http://localhost:3121",
  directory = "artifacts/baam-companion/browser";
const browser = await chromium.launch({ channel: process.env.BAAM_BROWSER_CHANNEL });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: base }]);
const { csrfToken } = await (await context.request.get(base + "/api/auth/csrf")).json();
await context.request.post(base + "/api/auth/callback/credentials", {
  form: {
    csrfToken,
    email: "admin@test.local",
    password: "BaamCompanion123!",
    json: "true",
    callbackUrl: base + "/inventory",
  },
});
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const name = `BAAM Photo Tea ${stamp}`;
try {
  await page.goto(base + "/inventory");
  await page.locator("[data-baam-launcher]").click();
  const chat = page.locator("[data-baam-chat]");
  await chat.waitFor();
  await chat.getByRole("button", { name: "New conversation", exact: true }).click();
  const prompt = `Create product "${name}" in Test Store, unit pcs, selling price 150 KGS, initial stock zero, cost zero, use the attached photo.`;
  await chat.locator("[data-baam-input]").fill(prompt);
  const { default: sharp } = await import("sharp");
  const photo = await sharp({
    create: { width: 100, height: 100, channels: 3, background: "#31735c" },
  })
    .png()
    .toBuffer();
  const uploaded = page.waitForResponse(
    (r) => r.url().endsWith("/api/baam/media") && r.request().method() === "POST",
    { timeout: 120000 },
  );
  await chat
    .locator('input[type="file"]')
    .setInputFiles({ name: "isolated-tea.png", mimeType: "image/png", buffer: photo });
  assert.equal((await uploaded).status(), 200);
  await chat.getByText("isolated-tea.png", { exact: true }).waitFor();
  assert.equal(
    await chat.locator("[data-baam-input]").inputValue(),
    prompt,
    "first upload must preserve the draft",
  );
  async function ask(text?: string) {
    if (text) await chat.locator("[data-baam-input]").fill(text);
    await chat.getByRole("button", { name: "Send message", exact: true }).click();
    await chat
      .locator("[data-baam-action]")
      .filter({ has: page.getByRole("button", { name: "Execute", exact: true }) })
      .last()
      .waitFor({ timeout: 150000 });
  }
  async function execute() {
    const card = chat
      .locator("[data-baam-action]")
      .filter({ has: page.getByRole("button", { name: "Execute", exact: true }) })
      .last();
    await card.getByRole("button", { name: "Execute", exact: true }).click();
    await page.waitForFunction(
      () => !document.querySelector("[data-baam-action] button[disabled]"),
    );
    await chat.getByRole("button", { name: "Send message", exact: true }).waitFor();
    await page.waitForTimeout(1200);
    assert.equal(await chat.getByRole("button", { name: "Execute", exact: true }).count(), 0);
  }
  await ask();
  await execute();
  const product = await prisma.product.findFirstOrThrow({
    where: { organizationId: fixture.organizationId, name },
  });
  assert.ok(product.photoUrl);
  console.log("Product with real uploaded photo created");
  await ask(
    `Receive 8 pcs of "${name}" in Test Store, unit purchase cost zero KGS, no supplier, note BAAM isolated browser receipt.`,
  );
  await execute();
  const stock = async () =>
    (
      await prisma.inventorySnapshot.findFirstOrThrow({
        where: { storeId: fixture.storeId, productId: product.id },
      })
    ).onHand;
  assert.equal(await stock(), 8);
  console.log("Receipt persisted, stock 8");
  await page.keyboard.press("Escape");
  await page.goto(base + `/pos/sell?registerId=${register.id}`);
  await page.locator("[data-baam-launcher]").waitFor();
  assert.equal(await page.locator("[data-baam-launcher]").count(), 1);
  await page.locator("[data-baam-launcher]").click();
  await chat.waitFor();
  await ask(
    `Prepare a new sale of 2 pcs of "${name}" at register "${register.name}" in Test Store. Payment will be cash.`,
  );
  await execute();
  const sale = await api.pos.sales.activeDraft({ registerId: register.id });
  assert.ok(sale);
  await ask(`Complete that sale now, pay the full ${sale.totalKgs} KGS in cash.`);
  await execute();
  const completed = await api.pos.sales.get({ saleId: sale.id });
  assert.equal(completed?.status, "COMPLETED");
  assert.equal(await stock(), 6);
  await page.screenshot({ path: `${directory}/desktop-sale-result.png` });
  await writeFile(
    `${directory}/business.json`,
    JSON.stringify(
      {
        productId: product.id,
        photo: true,
        receivingStock: 8,
        finalStock: 6,
        saleId: sale.id,
        paymentCount: await prisma.salePayment.count({ where: { customerOrderId: sale.id } }),
        posSellLauncher: true,
        errors,
      },
      null,
      2,
    ),
  );
  assert.deepEqual(errors, []);
  console.log("Photo, receiving, POS draft and cash checkout passed through real provider and UI");
} catch (error) {
  await page.screenshot({ path: `${directory}/business-failure.png` });
  await writeFile(`${directory}/business-failure.txt`, await page.locator("body").innerText());
  throw error;
} finally {
  await browser.close();
  await prisma.$disconnect();
}
