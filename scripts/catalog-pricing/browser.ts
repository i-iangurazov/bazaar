import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { encode } from "next-auth/jwt";
import superjson from "superjson";
import { catalogQaDatabaseUrl, catalogQaEnvironment } from "./environment";

Object.assign(process.env, catalogQaEnvironment());
const { prisma } = await import("../../src/server/db/prisma");
const { createTestCaller } = await import("../../tests/helpers/context");
const { adjustStock } = await import("../../src/server/services/inventory");
const [identity] = await prisma.$queryRaw<
  Array<{ name: string; directory: string }>
>`SELECT current_database() AS name, current_setting('data_directory') AS directory`;
assert.equal(identity.name, new URL(catalogQaDatabaseUrl).pathname.slice(1));
assert(identity.directory.startsWith("/private/tmp/bazaar-catalog-20261029."));
const directory = "artifacts/catalog-pricing-20261029";
await mkdir(directory, { recursive: true });
const suffix = randomUUID();
const organization = await prisma.organization.create({
  data: { name: `Catalog QA ${suffix}`, plan: "ENTERPRISE", retailWholesaleEnabled: true },
});
const user = await prisma.user.create({
  data: {
    organizationId: organization.id,
    email: `catalog-${suffix}@example.invalid`,
    passwordHash: "synthetic-unused",
    role: "ADMIN",
    isOrgOwner: true,
    name: "Catalog QA",
    emailVerifiedAt: new Date(),
  },
});
await prisma.userGuideState.create({
  data: {
    userId: user.id,
    completedToursJson: [],
    dismissedTipsJson: ["__guidance:tours_disabled__"],
  },
});
const unit = await prisma.unit.create({
  data: {
    organizationId: organization.id,
    code: "each",
    labelRu: "шт.",
    labelKg: "даана",
    quantityPrecision: 0,
  },
});
const stores = await Promise.all(
  ["А · Склад", "Б · Магазин", "В · Получатель"].map((name, index) =>
    prisma.store.create({ data: { organizationId: organization.id, name, code: `Q${index}` } }),
  ),
);
const api = createTestCaller({ ...user, organizationId: organization.id });
const product = await api.products.create({
  storeId: stores[0].id,
  name: "Перчатки для проверки",
  sku: "QA-GLOVE",
  baseUnitId: unit.id,
  retailPriceKgs: 325,
  wholesalePriceKgs: 300,
  idempotencyKey: randomUUID(),
});
await adjustStock({
  storeId: stores[0].id,
  productId: product.id,
  organizationId: organization.id,
  actorId: user.id,
  qtyDelta: 100,
  reason: "QA initial stock",
  requestId: suffix,
  idempotencyKey: randomUUID(),
});
const token = await encode({
  secret: process.env.NEXTAUTH_SECRET!,
  token: {
    sub: user.id,
    organizationId: organization.id,
    role: user.role,
    email: user.email,
    name: user.name,
    isOrgOwner: true,
    sessionVersion: user.sessionVersion,
  },
});
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: "ru-RU",
});
await context.addCookies([
  {
    name: "__Secure-next-auth.session-token",
    value: token,
    url: "https://localhost:3124",
    secure: true,
  },
  { name: "next-auth.session-token", value: token, url: "http://localhost:3124" },
  { name: "NEXT_LOCALE", value: "ru", url: "http://localhost:3124" },
]);
const page = await context.newPage();
const errors: string[] = [],
  checks: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
page.setDefaultTimeout(30_000);
const selectStore = async (id: string, name: string) => {
  await page.locator(`#${id}`).click();
  await page.getByRole("option", { name, exact: true }).click();
};
const postButton = () => page.getByRole("button", { name: "Провести перемещение", exact: true });
const waitReady = async () => {
  await postButton().waitFor();
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Провести перемещение",
    );
    return button && !(button as HTMLButtonElement).disabled;
  });
};
try {
  await page.goto("http://localhost:3124/inventory/transfers", {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await page.getByRole("button").filter({ hasText: "Перчатки для проверки" }).click();
  const quantity = page.locator('[data-transfer-input="quantity"]');
  await quantity.fill("7");
  await page.locator("#transfer-note").fill("Сохранить семь перчаток");
  await waitReady();
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitReady();
  assert.equal(await quantity.inputValue(), "7");
  assert.equal(await page.locator("#transfer-note").inputValue(), "Сохранить семь перчаток");
  checks.push("Reload restores quantities, note and stores");
  await selectStore("transfer-destination", stores[2].name);
  await waitReady();
  assert.equal(await quantity.inputValue(), "7");
  checks.push("Changing destination preserves lines and validates fresh balances");
  await selectStore("transfer-source", stores[1].name);
  await page
    .getByText(
      "Товар или вариант недоступен у отправителя. Удалите строку или выберите другой магазин.",
    )
    .first()
    .waitFor();
  assert(await postButton().isDisabled());
  assert.equal(await quantity.inputValue(), "7");
  await selectStore("transfer-source", stores[0].name);
  await waitReady();
  checks.push("Changing source retains input and blocks unavailable products");

  const second = await context.newPage();
  await second.goto("http://localhost:3124/products", {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  const created = await second.request.post("http://localhost:3124/api/trpc/products.create", {
    data: superjson.serialize({
      storeId: stores[0].id,
      name: "Новый товар из другой вкладки",
      sku: `QA-NEW-${suffix}`,
      baseUnitId: unit.id,
      retailPriceKgs: 80,
      idempotencyKey: randomUUID(),
    }),
  });
  assert(created.ok(), await created.text());
  await page.getByRole("button").filter({ hasText: "Новый товар из другой вкладки" }).waitFor();
  assert.equal(await quantity.inputValue(), "7");
  await second.close();
  checks.push("Product created through the authenticated API in another tab appears via SSE");

  await page.route("**/api/trpc/inventory.transferLineContext*", (route) => route.abort());
  await selectStore("transfer-destination", stores[1].name);
  await page
    .getByRole("alert")
    .filter({ hasText: "Не удалось проверить выбранные товары" })
    .waitFor();
  assert.equal(await quantity.inputValue(), "7");
  await page.unroute("**/api/trpc/inventory.transferLineContext*");
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await waitReady();
  await selectStore("transfer-destination", stores[2].name);
  await waitReady();
  checks.push("Validation network error preserves the document and retries successfully");
  await page.screenshot({ path: `${directory}/transfer-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${directory}/transfer-mobile.png`, fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  checks.push("Desktop/mobile inspection and no horizontal page overflow");
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.route("**/api/trpc/inventory.transfer?*", async (route) => {
    const response = await route.fetch();
    assert(response.ok());
    await route.abort();
  });
  await postButton().click();
  await page
    .getByText(
      "Не удалось получить подтверждение. Повторите отправку без изменений — остатки не спишутся повторно.",
    )
    .first()
    .waitFor();
  assert(await quantity.isDisabled());
  assert(await page.locator("#transfer-source").isDisabled());
  const key = `bazaar:transfer-draft:${organization.id}:${user.id}`;
  const saved = await page.evaluate((k) => JSON.parse(sessionStorage.getItem(k)!), key);
  assert(saved.draft.operation.key);
  assert.equal(
    (
      await prisma.inventorySnapshot.findFirstOrThrow({
        where: { storeId: stores[0].id, productId: product.id },
      })
    ).onHand,
    93,
  );
  await page.unroute("**/api/trpc/inventory.transfer?*");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitReady();
  assert(await quantity.isDisabled());
  const restored = await page.evaluate((k) => JSON.parse(sessionStorage.getItem(k)!), key);
  assert.equal(restored.draft.operation.key, saved.draft.operation.key);
  await postButton().click();
  await page.waitForURL(/\/inventory\/movements\//, { timeout: 60_000 });
  assert.equal(
    (
      await prisma.inventorySnapshot.findFirstOrThrow({
        where: { storeId: stores[0].id, productId: product.id },
      })
    ).onHand,
    93,
  );
  assert.equal(
    (
      await prisma.inventorySnapshot.findFirstOrThrow({
        where: { storeId: stores[2].id, productId: product.id },
      })
    ).onHand,
    7,
  );
  assert.equal(
    await prisma.stockMovement.count({
      where: { productId: product.id, type: { in: ["TRANSFER_IN", "TRANSFER_OUT"] } },
    }),
    2,
  );
  assert.equal(await page.evaluate((k) => sessionStorage.getItem(k), key), null);
  checks.push(
    "Lost response + reload + replay uses the same idempotency key, posts once, clears draft",
  );
  await page.goto("http://localhost:3124/inventory/transfers", { waitUntil: "domcontentloaded" });
  await page.getByRole("button").filter({ hasText: "Перчатки для проверки" }).click();
  await quantity.fill("2");
  await waitReady();
  await page.route("**/api/trpc/inventory.transfer?*", (route) => route.abort());
  await postButton().click();
  await page.getByRole("button", { name: "Проверить результат", exact: true }).waitFor();
  assert(await quantity.isDisabled());
  const unposted = await page.evaluate((k) => JSON.parse(sessionStorage.getItem(k)!), key);
  await page.unroute("**/api/trpc/inventory.transfer?*");
  await page.getByRole("button", { name: "Проверить результат", exact: true }).click();
  await page.waitForFunction(
    () => !document.querySelector<HTMLInputElement>('[data-transfer-input="quantity"]')?.disabled,
  );
  assert.equal(await quantity.inputValue(), "2");
  await assert.rejects(
    api.inventory.transfer({
      fromStoreId: unposted.draft.fromStoreId,
      toStoreId: unposted.draft.toStoreId,
      lines: [{ productId: product.id, qty: 2 }],
      idempotencyKey: unposted.draft.operation.key,
    }),
    /transferAttemptClosed/,
  );
  assert.equal(
    (
      await prisma.inventorySnapshot.findFirstOrThrow({
        where: { storeId: stores[0].id, productId: product.id },
      })
    ).onHand,
    93,
  );
  checks.push(
    "Unknown result locks edits; server reconciliation closes an unposted attempt and blocks late posting",
  );

  // Exercise the actual inline editor with legacy rows, not just its API.
  await prisma.storePriceTypes.updateMany({
    where: { productId: product.id },
    data: { retailPriceKgs: null },
  });
  await page.goto(`http://localhost:3124/products?storeId=${stores[0].id}`, {
    waitUntil: "domcontentloaded",
  });
  const priceSelector = `[data-inline-cell="products:${stores[0].id}:${product.id}:salePrice"]`;
  const priceCell = page.locator(`${priceSelector}:visible`);
  await priceCell.waitFor();
  assert.match(await priceCell.innerText(), /325/);
  await priceCell.dblclick();
  await page.locator('input[aria-label="Редактирование поля: Цена продажи"]:visible').fill("350");
  await page
    .locator('input[aria-label="Редактирование поля: Цена продажи"]:visible')
    .press("Enter");
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.textContent?.includes("350"),
    priceSelector,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await priceCell.waitFor();
  assert.match(await priceCell.innerText(), /350/);
  assert.equal(
    (await api.products.storePricing({ productId: product.id })).stores.find(
      (s) => s.storeId === stores[0].id,
    )?.effectivePriceKgs,
    350,
  );
  checks.push("Inline retail editor preserves legacy 325 over wholesale 300 and saves/reloads 350");

  const measuredUnit = await prisma.unit.create({
    data: {
      organizationId: organization.id,
      code: "kg",
      labelRu: "кг",
      labelKg: "кг",
      quantityPrecision: 3,
    },
  });
  const fractional = await api.products.create({
    storeId: stores[0].id,
    name: "Дробный товар QA",
    sku: "QA-FRACTION",
    baseUnitId: measuredUnit.id,
    retailPriceKgs: 99,
    initialOnHand: 48.1,
    idempotencyKey: randomUUID(),
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  const quantitySelector = `[data-inline-cell="products:${stores[0].id}:${fractional.id}:onHand"]`;
  await page.locator(`${quantitySelector}:visible`).dblclick();
  await page.locator('input[aria-label="Редактирование поля: В наличии"]:visible').fill("120,1");
  await page.locator('input[aria-label="Редактирование поля: В наличии"]:visible').press("Enter");
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.textContent?.includes("120,1"),
    quantitySelector,
  );
  assert.equal(
    (
      await prisma.inventorySnapshot.findFirstOrThrow({
        where: { productId: fractional.id, storeId: stores[0].id },
      })
    ).onHand,
    120.1,
  );
  await page.goto(`http://localhost:3124/products/${fractional.id}?storeId=${stores[0].id}`, {
    waitUntil: "domcontentloaded",
  });
  const cardQuantity = page
    .locator(`[data-inline-cell*="${fractional.id}"][data-inline-cell$=":onHand"]:visible`)
    .filter({ hasText: "120,1" })
    .first();
  await cardQuantity.dblclick();
  await page.locator('input[aria-label="Редактирование поля: В наличии"]:visible').fill("100,1");
  await page.locator('input[aria-label="Редактирование поля: В наличии"]:visible').press("Enter");
  await page.waitForFunction(
    (id) =>
      [...document.querySelectorAll("[data-inline-cell]")].some(
        (el) =>
          el.getAttribute("data-inline-cell")?.includes(id) && el.textContent?.includes("100,1"),
      ),
    fractional.id,
  );
  assert.equal(
    (
      await prisma.inventorySnapshot.findFirstOrThrow({
        where: { productId: fractional.id, storeId: stores[0].id },
      })
    ).onHand,
    100.1,
  );
  checks.push(
    "Fractional stock saves through the product table and product card using real editors",
  );
  for (const [locale, title] of [
    ["ru", "Один товар в нескольких магазинах"],
    ["kg", "Бир товар бир нече дүкөндө"],
    ["en", "One product across multiple stores"],
  ]) {
    await context.addCookies([
      { name: "NEXT_LOCALE", value: locale, url: "http://localhost:3124" },
    ]);
    await page.goto("http://localhost:3124/help/products/shared-catalog", {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("heading", { name: title, exact: true }).waitFor();
  }
  checks.push("Shared product, archive and barcode guide is available in RU/KG/EN");
  for (const locale of ["ru", "kg", "en"]) {
    const copy = JSON.parse(await readFile(`messages/${locale}.json`, "utf8"));
    await context.addCookies([
      { name: "NEXT_LOCALE", value: locale, url: "http://localhost:3124" },
    ]);
    for (const width of [390, 767, 768, 1023, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`http://localhost:3124/products/new?storeId=${stores[0].id}`, {
        waitUntil: "networkidle",
      });
      const generate = page
        .getByRole("button", { name: copy.products.generateBarcode, exact: true })
        .filter({ visible: true });
      await generate.waitFor();
      await page.evaluate(() => document.fonts.ready);
      const box = await generate.boundingBox();
      assert(
        box && box.x >= 0 && box.x + box.width <= width + 1,
        `${locale}/${width}: barcode generation outside viewport`,
      );
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        `${locale}/${width}: form overflow`,
      );
      if (width >= 768) {
        const scan = await page
          .locator('[data-app-header] input[data-tour="scan-input"]')
          .boundingBox();
        const launcher = await page.locator("[data-baam-launcher]:visible").boundingBox();
        assert(
          scan && launcher && scan.x + scan.width <= launcher.x,
          `${locale}/${width}: search overlaps BAAM`,
        );
      }
      if (locale === "ru" && width === 768)
        await page.screenshot({ path: `${directory}/product-form-768-after.png`, fullPage: true });
    }
  }
  checks.push(
    "Product barcode actions reflow within the form and header search stays clear of BAAM across RU/KG/EN at 390/767/768/1023/1024/1440px",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    `${directory}/browser-checks.json`,
    JSON.stringify({ checks, errors, organizationId: organization.id }, null, 2),
  );
  console.log(JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${directory}/browser-failure.png`, fullPage: true });
  await writeFile(
    `${directory}/browser-failure.txt`,
    `${String(error)}\n${await page.locator("body").innerText()}`,
  );
  throw error;
} finally {
  await browser.close();
  await prisma.$disconnect();
  const { getRedisPublisher, getRedisSubscriber } = await import("../../src/server/redis");
  getRedisPublisher()?.disconnect();
  getRedisSubscriber()?.disconnect();
}
