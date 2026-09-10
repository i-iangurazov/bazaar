import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const base = "http://localhost:3121";
const directory = "artifacts/baam-companion/browser";
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BAAM_BROWSER_CHANNEL });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: base }]);
await context.route("**/*", (route) => {
  const url = new URL(route.request().url());
  return ["localhost", "127.0.0.1"].includes(url.hostname) || url.protocol === "data:"
    ? route.continue()
    : route.abort();
});
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
try {
  await page.goto(base + "/inventory");
  await page.locator("[data-baam-launcher]").waitFor();
  await page.waitForTimeout(1500);
  assert.equal(await page.locator("[data-baam-launcher]").count(), 1);
  await page.locator("[data-baam-launcher]").click();
  const chat = page.locator("[data-baam-chat]");
  await chat.waitFor();
  await chat.getByRole("button", { name: "New conversation", exact: true }).click();
  const name = `BAAM Browser Tea ${Date.now()}`;
  await chat
    .locator("[data-baam-input]")
    .fill(
      `Create product "${name}" in Test Store, unit pcs, selling price 150 KGS, initial stock zero, purchase cost zero, without a photo.`,
    );
  await chat.getByRole("button", { name: "Send message", exact: true }).click();
  await chat.locator("[data-baam-action]").first().waitFor({ timeout: 150000 });
  await page.screenshot({ path: `${directory}/desktop-review.png` });
  await chat
    .locator("[data-baam-action]")
    .first()
    .getByRole("button", { name: "Execute", exact: true })
    .click();
  await chat
    .locator("[data-baam-action]")
    .first()
    .getByText("Completed", { exact: true })
    .waitFor({ timeout: 30000 });
  const href = await chat
    .getByRole("link", { name: "Open in Bazaar", exact: false })
    .first()
    .getAttribute("href");
  assert.ok(href?.startsWith("/products/"));
  await page.screenshot({ path: `${directory}/desktop-result.png` });
  await page.reload();
  await page.locator("[data-baam-launcher]").waitFor();
  await page.waitForTimeout(1000);
  await page.locator("[data-baam-launcher]").click();
  await chat.getByText(name, { exact: false }).first().waitFor({ timeout: 15000 });
  await chat.getByRole("button", { name: "Conversations", exact: true }).click();
  await page.locator("[data-baam-dialogs]").waitFor();
  await page.screenshot({ path: `${directory}/desktop-history.png` });
  await page.keyboard.press("Escape");
  await page.goto(base + href);
  await page.getByText(name, { exact: true }).first().waitFor({ timeout: 20000 });
  await writeFile(
    `${directory}/flow.json`,
    JSON.stringify({ productName: name, productHref: href, persisted: true, errors }, null, 2),
  );
  assert.deepEqual(errors, []);
  console.log("Real-provider product creation, result link and persisted history passed");
} catch (error) {
  await page.screenshot({ path: `${directory}/failure.png` });
  await writeFile(
    `${directory}/failure.txt`,
    (await page.locator("body").innerText()) + "\n" + JSON.stringify(errors),
  );
  throw error;
} finally {
  await browser.close();
}
