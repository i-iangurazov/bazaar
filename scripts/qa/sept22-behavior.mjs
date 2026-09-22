import fs from "node:fs";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createTRPCProxyClient, httpLink } from "@trpc/client";
import superjson from "superjson";
import bwipjs from "bwip-js";
const base = "http://localhost:3100";
const f = JSON.parse(fs.readFileSync("/private/tmp/bazaar-qa-fixture.json"));
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext({
  storageState: "/private/tmp/bazaar-qa-session.json",
  viewport: { width: 1024, height: 1366 },
  serviceWorkers: "block",
});
const cookie = (await context.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
const api = createTRPCProxyClient({
  transformer: superjson,
  links: [httpLink({ url: base + "/api/trpc", headers: { cookie } })],
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const stamp = Date.now();
const a = await api.products.create.mutate({
  idempotencyKey: crypto.randomUUID(),
  name: `Кисточка A ${stamp}`,
  storeId: f.storeId,
  baseUnitId: f.baseUnitId,
  basePriceKgs: 100,
});
await page.goto(base + "/products/" + a.id);
await page.locator('input[name="name"]').waitFor();
await page.getByRole("button", { name: "Действия", exact: true }).click();
await page.getByRole("menuitem", { name: "Дублировать", exact: true }).click();
await page.waitForURL((u) => u.pathname.startsWith("/products/") && !u.pathname.endsWith(a.id));
const b = page.url().split("/").pop();
await page.locator('input[name="name"]').fill(`Кисточка B ${stamp}`);
await page.locator('input[name="storePriceKgs"]').fill("275");
await page.locator('input[name="basePriceKgs"]').fill("250");
await page.getByRole("button", { name: "Сохранить", exact: true }).first().click();
await page.waitForURL(base + "/products");
await page.goto(base + "/products/" + b);
assert.equal(await page.locator('input[name="name"]').inputValue(), `Кисточка B ${stamp}`);
assert.equal(await page.locator('input[name="storePriceKgs"]').inputValue(), "275");
assert.equal((await api.products.getById.query({ productId: a.id })).name, `Кисточка A ${stamp}`);
await page.getByRole("button", { name: "Добавить опцию", exact: true }).click();
await page.locator("#variant-option-name").fill("Размер");
await page.locator("#variant-option-values").fill("1, 2, 3, 4, 5");
await page.getByRole("button", { name: "Создать варианты", exact: true }).click();
const prices = page.locator('input[name^="variants."][name$=".storePriceKgs"]');
await prices.first().waitFor();
assert.equal(await prices.count(), 5);
for (let i = 0; i < 5; i++) await prices.nth(i).fill(String((i + 1) * 15));
await page.getByRole("button", { name: "Сохранить", exact: true }).first().click();
await page.waitForURL(base + "/products");
await page.goto(base + "/products/" + b);
await prices.first().waitFor();
assert.deepEqual(await prices.evaluateAll((xs) => xs.map((x) => x.value)), [
  "15",
  "30",
  "45",
  "60",
  "75",
]);
// Real ZXing decoder; synthetic stream, not a physical iPad camera.
const barcode = await bwipjs.toBuffer({
  bcid: "ean13",
  text: "0012345678905",
  scale: 4,
  height: 20,
  includetext: false,
  padding: 20,
});
await page.evaluate(
  async (data) => {
    const image = new Image();
    image.src = data;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const c = canvas.getContext("2d");
    c.fillStyle = "white";
    c.fillRect(0, 0, 1280, 720);
    c.drawImage(image, 140, 220, 1000, 280);
    window.qaTimer = setInterval(() => c.drawImage(image, 140, 220, 1000, 280), 100);
    window.qaStreams = [];
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          const stream = canvas.captureStream(10);
          window.qaStreams.push(stream);
          return stream;
        },
      },
    });
    window.qaCanvas = canvas;
  },
  "data:image/png;base64," + barcode.toString("base64"),
);
await page.getByRole("button", { name: "Сканировать камерой", exact: true }).last().click();
await page.getByRole("dialog").waitFor();
await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 30000 });
assert.equal(await page.getByText("0012345678905", { exact: true }).count(), 1);
assert.equal(
  await page.evaluate(() =>
    window.qaStreams.every((s) => s.getTracks().every((t) => t.readyState === "ended")),
  ),
  true,
);
// Manual scanner Enter must append only and leave the form open.
const barcodeInput = page.getByPlaceholder("Сканировать или ввести штрихкод");
await barcodeInput.fill("00012345");
await barcodeInput.press("Enter");
assert.equal(await page.getByText("00012345", { exact: true }).count(), 1);
assert.equal(new URL(page.url()).pathname, "/products/" + b);
await page.getByRole("button", { name: "Сохранить", exact: true }).first().click();
await page.waitForURL(base + "/products");
const saved = await api.products.getById.query({ productId: b });
assert.deepEqual(saved.barcodes.sort(), ["00012345", "0012345678905"]);
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(base + "/products/" + b);
await page.locator('input[name="name"]').waitFor();
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
await page.screenshot({ path: "/private/tmp/bazaar-phone-verified.png", fullPage: true });
console.log(
  JSON.stringify(
    {
      copy: b,
      sku: saved.sku,
      variantPrices: [15, 30, 45, 60, 75],
      camera: "actual ZXing EAN decoder on synthetic video stream; tracks ended",
      manualEnter: true,
      phoneOverflow: false,
      errors,
    },
    null,
    2,
  ),
);
await browser.close();
