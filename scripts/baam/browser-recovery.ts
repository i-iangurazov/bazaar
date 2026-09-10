import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const base = "http://localhost:3121";
const fixture = JSON.parse(await readFile("artifacts/baam-companion/fixture.json", "utf8"));
const business = JSON.parse(
  await readFile("artifacts/baam-companion/browser/business.json", "utf8"),
);
const browser = await chromium.launch({ channel: process.env.BAAM_BROWSER_CHANNEL });
const admin = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const manager = await browser.newContext();
for (const [context, role] of [
  [admin, "admin"],
  [manager, "manager"],
] as const) {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: base }]);
  const { csrfToken } = await (await context.request.get(base + "/api/auth/csrf")).json();
  await context.request.post(base + "/api/auth/callback/credentials", {
    form: {
      csrfToken,
      email: `${role}@test.local`,
      password: "BaamCompanion123!",
      json: "true",
      callbackUrl: base,
    },
  });
}
const page = await admin.newPage();
const peer = await manager.newPage();
try {
  await peer.goto(base + "/inventory");
  await peer.locator("[data-baam-launcher]").waitFor();
  await page.goto(base + "/inventory");
  await page.locator("[data-baam-launcher]").click();
  const chat = page.locator("[data-baam-chat]");
  await chat.waitFor();
  await chat.getByRole("button", { name: "New conversation", exact: true }).click();
  // A second browser context changes the exact same stock after BAAM's review.
  const productResponse = await admin.request.get(
    base +
      "/api/trpc/products.getById?input=" +
      encodeURIComponent(JSON.stringify({ json: { productId: business.productId } })),
  );
  const productBody = await productResponse.json();
  // Use the real product label recorded in the preceding browser workflow.
  const productName = productBody.result?.data?.json?.name;
  assert.ok(productName, JSON.stringify(productBody.error));
  await chat
    .locator("[data-baam-input]")
    .fill(
      `Set the absolute stock of "${productName}" in Test Store to 20 pcs. Reason: isolated physical count.`,
    );
  await chat.getByRole("button", { name: "Send message", exact: true }).click();
  await chat.getByRole("button", { name: "Execute", exact: true }).waitFor({ timeout: 150000 });
  const changed = await manager.request.post(base + "/api/trpc/inventory.adjust", {
    data: {
      json: {
        storeId: fixture.storeId,
        productId: business.productId,
        qtyDelta: 1,
        reason: "Concurrent isolated browser change",
        idempotencyKey: randomUUID(),
      },
    },
  });
  assert.equal(changed.status(), 200, await changed.text());
  await chat.getByRole("button", { name: "Execute", exact: true }).click();
  await chat.locator('[data-baam-action] [role="alert"]').waitFor();
  await page.screenshot({ path: "artifacts/baam-companion/browser/desktop-conflict.png" });
  const stockResponse = await manager.request.get(
    base +
      "/api/trpc/inventory.list?input=" +
      encodeURIComponent(
        JSON.stringify({ json: { storeId: fixture.storeId, search: productName } }),
      ),
  );
  const stock = (await stockResponse.json()).result.data.json.items.find(
    (item: { snapshot: { productId: string } }) => item.snapshot.productId === business.productId,
  ).snapshot.onHand;
  assert.equal(stock, 7);
  await chat.getByRole("button", { name: "Cancel", exact: true }).click();
  await chat.getByRole("button", { name: "New conversation", exact: true }).click();
  let lost = false;
  const requests: unknown[] = [];
  await page.route("**/api/trpc/baam.send?*", async (route) => {
    requests.push(route.request().postDataJSON());
    if (!lost) {
      lost = true;
      await route.fetch({ timeout: 150000 });
      await route.abort("failed");
    } else await route.continue();
  });
  await chat
    .locator("[data-baam-input]")
    .fill(
      "How do I find stock receiving documents on this page? Explain only, do not change anything.",
    );
  await chat.getByRole("button", { name: "Send message", exact: true }).click();
  await chat.getByRole("button", { name: "Retry", exact: true }).waitFor({ timeout: 150000 });
  await chat.getByRole("button", { name: "Retry", exact: true }).click();
  await page.waitForFunction(
    () => !document.querySelector('[data-baam-chat] [role="alert"]'),
    {},
    { timeout: 30000 },
  );
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], requests[1]);
  await writeFile(
    "artifacts/baam-companion/browser/recovery.json",
    JSON.stringify(
      {
        twoBrowserSessions: true,
        conflictPreservedStock: stock,
        lostResponseRetrySameRequest: true,
        requests: requests.length,
      },
      null,
      2,
    ),
  );
  console.log("Two-session conflict and lost HTTP response retry passed");
} catch (e) {
  await page.screenshot({ path: "artifacts/baam-companion/browser/recovery-failure.png" });
  await writeFile(
    "artifacts/baam-companion/browser/recovery-failure.txt",
    await page.locator("body").innerText(),
  );
  throw e;
} finally {
  await browser.close();
}
