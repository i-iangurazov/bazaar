import fs from "node:fs";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";
import { createTRPCProxyClient, httpLink } from "@trpc/client";
import superjson from "superjson";
import sharp from "sharp";
const base = "http://localhost:3100";
const fixture = JSON.parse(fs.readFileSync("/private/tmp/bazaar-qa-fixture.json", "utf8"));
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext({
  storageState: "/private/tmp/bazaar-qa-session.json",
  viewport: { width: 1440, height: 1000 },
  serviceWorkers: "block",
});
const cookies = (await context.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
const client = createTRPCProxyClient({
  transformer: superjson,
  links: [httpLink({ url: base + "/api/trpc", headers: { cookie: cookies } })],
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  window.qaLongTasks = [];
  new PerformanceObserver((l) =>
    window.qaLongTasks.push(...l.getEntries().map((e) => e.duration)),
  ).observe({ type: "longtask", buffered: true });
});
const result = {
  environment: "Chrome desktop, localhost Next dev warmed, 1000 base products plus QA-created copies/photos, no network throttling",
  measurements: {},
};
const summarize = (a) => ({
  first: a[0],
  median: [...a.slice(1)].sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)],
  max: Math.max(...a.slice(1)),
  runs: a,
});
const routes = [
  ["pos", "/pos/sell", () => page.getByTestId("pos-product-button").first()],
  ["products", "/products", () => page.locator('a[href^="/products/"]:not([href^="/products/new"])').first()],
  ["form", "/products/" + fixture.productId, () => page.locator('input[name="name"]')],
];
for (const [name, path, ready] of routes) {
  const times = [];
  for (let i = 0; i < 6; i++) {
    const t = performance.now();
    await page.goto(base + path);
    await ready().waitFor({ timeout: 90000 });
    times.push(Math.round(performance.now() - t));
  }
  result.measurements[name] = summarize(times);
}
const png = await sharp({
  create: { width: 2500, height: 1800, channels: 3, background: "#6c4a35" },
})
  .png()
  .toBuffer();
const upload = async (i) => {
  const r = await context.request.post(base + "/api/product-images/upload", {
    multipart: { file: { name: `qa-${i}.png`, mimeType: "image/png", buffer: png } },
  });
  assert.equal(r.status(), 200);
  const image = await r.json();
  await client.products.create.mutate({
    idempotencyKey: crypto.randomUUID(),
    name: `Фото QA ${i}`,
    baseUnitId: fixture.baseUnitId,
    storeId: fixture.storeId,
    basePriceKgs: 200,
    images: [{ url: image.url, position: 0 }],
  });
};
// Warm the upload route separately; concurrent samples exclude first dev compilation.
await upload("warm-" + Date.now());
const concurrent = [];
for (let i = 0; i < 6; i++) {
  const uploads = Promise.all([
    upload(`${i}-a-${Date.now()}`),
    upload(`${i}-b-${Date.now()}`),
    upload(`${i}-c-${Date.now()}`),
  ]);
  const t = performance.now();
  await page.goto(base + "/pos/sell");
  await page.getByTestId("pos-product-button").first().waitFor({ timeout: 60000 });
  concurrent.push(Math.round(performance.now() - t));
  await uploads;
}
result.measurements.posDuringThreePhotoCreates = summarize(concurrent);
result.longTasks = await page.evaluate(() => ({
  max: Math.max(0, ...window.qaLongTasks),
  over1000ms: window.qaLongTasks.filter((n) => n >= 1000).length,
}));
result.errors = errors;
fs.writeFileSync(
  `/private/tmp/bazaar-browser-${process.argv[2] ?? "after"}.json`,
  JSON.stringify(result, null, 2),
);
console.log(result);
await browser.close();
