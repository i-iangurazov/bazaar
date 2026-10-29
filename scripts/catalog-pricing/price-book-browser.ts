import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { encode } from "next-auth/jwt";
import superjson from "superjson";
import { catalogQaDatabaseUrl, catalogQaEnvironment } from "./environment";
import { priceBookApplySchema } from "../../src/lib/priceBookContract";
Object.assign(process.env, catalogQaEnvironment());
const { prisma } = await import("../../src/server/db/prisma");
const { createTestCaller } = await import("../../tests/helpers/context");
const [identity] = await prisma.$queryRaw<
  Array<{ name: string; directory: string }>
>`SELECT current_database() AS name, current_setting('data_directory') AS directory`;
assert.equal(identity.name, new URL(catalogQaDatabaseUrl).pathname.slice(1));
assert(identity.directory.startsWith("/private/tmp/bazaar-catalog-20261029."));
const directory = "artifacts/catalog-pricing-20261029",
  suffix = randomUUID();
const org = await prisma.organization.create({
  data: { name: `Price list QA ${suffix}`, plan: "ENTERPRISE", retailWholesaleEnabled: true },
});
const user = await prisma.user.create({
  data: {
    organizationId: org.id,
    email: `price-qa-${suffix}@example.invalid`,
    name: "Price QA",
    passwordHash: "synthetic-unused",
    role: "ADMIN",
    isOrgOwner: true,
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
  data: { organizationId: org.id, code: "each", labelRu: "шт.", labelKg: "даана" },
});
const stores = await Promise.all(
  ["А · Источник прайса", "Б · Магазин прайса"].map((name, i) =>
    prisma.store.create({ data: { organizationId: org.id, name, code: `P${i}` } }),
  ),
);
const api = createTestCaller({ ...user, organizationId: org.id });
const product = await api.products.create({
  storeId: stores[0].id,
  name: "Проверка общего прайса",
  sku: "PRICE-QA",
  baseUnitId: unit.id,
  retailPriceKgs: 325,
  wholesalePriceKgs: 300,
  idempotencyKey: randomUUID(),
});
await api.products.assignToStore({ storeId: stores[1].id, productIds: [product.id] });
const token = await encode({
  secret: process.env.NEXTAUTH_SECRET!,
  token: {
    sub: user.id,
    organizationId: org.id,
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
const page = await context.newPage(),
  checks: string[] = [],
  errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (msg) => {
  if (msg.type() === "error" && /MISSING_MESSAGE|IntlError|Maximum update depth/.test(msg.text()))
    errors.push(msg.text());
});
page.setDefaultTimeout(30_000);
const dialog = () => page.getByRole("dialog");
const button = (name: string) => page.getByRole("button", { name, exact: true });
const confirm = () =>
  dialog().getByRole("button", { name: "Применить проверенные изменения", exact: true });
const pending = () =>
  page.evaluate(() =>
    Object.keys(sessionStorage).filter((k) => k.startsWith("bazaar:price-book-pending:")),
  );
const currentPrice = async (storeId: string) =>
  Number(
    (await prisma.storePrice.findFirstOrThrow({ where: { storeId, productId: product.id } }))
      .priceKgs,
  );
let bookId = "";
async function waitClosed() {
  await dialog().waitFor({ state: "hidden" });
  await page.getByRole("status").filter({ hasText: "Изменения применены" }).waitFor();
}
async function stage(retail: string, wholesale = "120") {
  await page.locator(`button[aria-label="Настроить цену ${product.name}"]:visible`).click();
  await dialog().getByRole("textbox", { name: "Розничная", exact: true }).fill(retail);
  await dialog().getByRole("textbox", { name: "Оптовая", exact: true }).fill(wholesale);
  await dialog().getByRole("button", { name: "Подготовить строку", exact: true }).click();
  assert(await button("Создать прайс").isDisabled());
  assert(await button("Подключить магазины").isDisabled());
  await button("Проверить изменения").click();
  await confirm().waitFor();
}
try {
  await page.goto("http://localhost:3124/settings/price-lists", {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await page.getByRole("heading", { name: "Общие прайсы", exact: true }).waitFor();
  await button("Создать прайс").click();
  await dialog().getByRole("textbox", { name: "Название" }).fill("Основной проверенный прайс");
  await dialog().getByRole("button", { name: "Создать прайс", exact: true }).click();
  await dialog().waitFor({ state: "hidden" });
  await page.locator(`button[aria-label="Настроить цену ${product.name}"]:visible`).waitFor();
  bookId = (await prisma.priceBook.findFirstOrThrow({ where: { organizationId: org.id } })).id;
  await stage("139,50");
  await dialog().getByText("Изменения общего прайса · KGS", { exact: true }).waitFor();
  assert.equal(await prisma.priceBookEntry.count({ where: { bookId } }), 0);
  assert.equal(await currentPrice(stores[0].id), 325);
  await confirm().click();
  await waitClosed();
  assert.equal(
    Number((await prisma.priceBookEntry.findFirstOrThrow({ where: { bookId } })).retailPriceKgs),
    139.5,
  );
  assert.equal(await currentPrice(stores[0].id), 325);
  checks.push(
    "Create/stage/signed preview does not write prices before explicit confirmation; comma decimals accepted",
  );
  checks.push(
    "A staged price draft disables list creation and store connection; the staged amount remains available for confirmation",
  );

  await button("Подключить магазины").click();
  for (const store of stores)
    await dialog().getByRole("checkbox", { name: store.name, exact: true }).check();
  assert(
    await dialog()
      .getByRole("checkbox", {
        name: "Сохранить уже заданные индивидуальные цены, включая нулевые",
      })
      .isChecked(),
  );
  await dialog().getByRole("button", { name: "Проверить изменения", exact: true }).click();
  await confirm().click();
  await waitClosed();
  assert.equal(await currentPrice(stores[0].id), 325);
  assert.equal(await currentPrice(stores[1].id), 139.5);
  checks.push(
    "Connection preserves existing individual prices by default and applies common prices to missing store prices",
  );

  await button("Массовая правка").click();
  await dialog().getByRole("textbox", { name: "Значение", exact: true }).fill("10");
  await dialog().getByRole("button", { name: "Проверить изменения", exact: true }).click();
  await confirm().click();
  await waitClosed();
  assert.equal(await currentPrice(stores[0].id), 325);
  assert.equal(await currentPrice(stores[1].id), 153.45);
  // Publication closes its dialog before the list/history refetch finishes.
  // Wait for the new version's actual table value before choosing its rollback.
  await page.getByRole("cell", { name: "153,45", exact: true }).waitFor();
  const rollbackButton = page.locator(
    'button[aria-label="Проверить откат"]:visible:not([disabled])',
  );
  await rollbackButton.click();
  await confirm().click();
  await waitClosed();
  assert.equal(await currentPrice(stores[1].id), 139.5);
  checks.push(
    "Real bulk +10% preview/publication and reviewed rollback preserve individual prices",
  );

  await api.storePrices.upsert({ storeId: stores[1].id, productId: product.id, priceKgs: 0 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("combobox", { name: "Показать источник цен магазина", exact: true }).click();
  await page.getByRole("option", { name: stores[1].name, exact: true }).click();
  await page.locator(`button[aria-label="Настроить цену ${product.name}"]:visible`).click();
  assert(
    !(await dialog()
      .getByRole("checkbox", { name: "Наследовать розничную", exact: true })
      .isChecked()),
  );
  await dialog().getByRole("checkbox", { name: "Наследовать розничную", exact: true }).check();
  await dialog()
    .getByRole("button", { name: "Проверить источник цен магазина", exact: true })
    .click();
  await confirm().click();
  await waitClosed();
  assert.equal(await currentPrice(stores[1].id), 139.5);
  checks.push(
    "An individual zero is visible as local; the explicit store source editor restores inheritance",
  );

  await stage("200");
  await api.storePrices.upsert({ storeId: stores[1].id, productId: product.id, priceKgs: 145.1 });
  await confirm().click();
  await dialog()
    .getByRole("alert")
    .filter({ hasText: "Цены или область действия изменились" })
    .waitFor();
  assert.equal(
    Number((await prisma.priceBookEntry.findFirstOrThrow({ where: { bookId } })).retailPriceKgs),
    139.5,
  );
  assert.equal(await currentPrice(stores[1].id), 145.1);
  await dialog().getByRole("button", { name: "Отмена", exact: true }).click();
  await button("Сбросить черновик").click();
  checks.push(
    "A stale preview is rejected in the real UI and cannot overwrite a subsequent store edit",
  );

  await stage("210");
  const beforeChanges = await prisma.priceBookChange.count({ where: { bookId } });
  await page.route(
    "**/api/trpc/priceBooks.publish*",
    async (route) => {
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await confirm().click();
  await dialog().getByRole("button", { name: "Сверить результат", exact: true }).waitFor();
  assert.equal((await pending()).length, 1);
  await page.reload({ waitUntil: "domcontentloaded" });
  await dialog().getByRole("button", { name: "Сверить результат", exact: true }).click();
  await waitClosed();
  assert.equal(await prisma.priceBookChange.count({ where: { bookId } }), beforeChanges + 1);
  assert.equal((await pending()).length, 0);
  checks.push(
    "Lost committed response survives reload and server reconciliation finds the original receipt without applying twice",
  );

  await stage("220");
  let intercepted: unknown;
  await page.route(
    "**/api/trpc/priceBooks.publish*",
    async (route) => {
      const body = route.request().postDataJSON();
      intercepted = superjson.deserialize(body["0"]);
      await route.abort("failed");
    },
    { times: 1 },
  );
  await confirm().click();
  await dialog().getByRole("button", { name: "Сверить результат", exact: true }).waitFor();
  await page.reload({ waitUntil: "domcontentloaded" });
  await dialog().getByRole("button", { name: "Сверить результат", exact: true }).click();
  await dialog().waitFor({ state: "hidden" });
  await assert.rejects(
    api.priceBooks.publish(priceBookApplySchema.parse(intercepted)),
    /priceBookAttemptClosed/,
  );
  assert.equal(
    Number((await prisma.priceBookEntry.findFirstOrThrow({ where: { bookId } })).retailPriceKgs),
    210,
  );
  await button("Сбросить черновик").waitFor();
  await button("Проверить изменения").click();
  await dialog().getByRole("cell", { name: "210 → 220", exact: true }).waitFor();
  await dialog().getByRole("button", { name: "Отмена", exact: true }).click();
  await button("Сбросить черновик").click();
  checks.push(
    "Unposted network failure survives reload, restores staged prices, closes safely and rejects a late publication with the old key",
  );

  await stage("230");
  await page.evaluate(() => {
    const w = window as typeof window & { __qaSetItem?: typeof Storage.prototype.setItem };
    w.__qaSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k.startsWith("bazaar:price-book-pending:"))
        throw new DOMException("Quota", "QuotaExceededError");
      w.__qaSetItem!.call(this, k, v);
    };
  });
  await confirm().click();
  await dialog()
    .getByRole("alert")
    .filter({ hasText: "Не удалось сохранить состояние операции" })
    .waitFor();
  assert.equal(
    Number((await prisma.priceBookEntry.findFirstOrThrow({ where: { bookId } })).retailPriceKgs),
    210,
  );
  await page.evaluate(() => {
    const w = window as typeof window & { __qaSetItem?: typeof Storage.prototype.setItem };
    Storage.prototype.setItem = w.__qaSetItem!;
    delete w.__qaSetItem;
  });
  await dialog().getByRole("button", { name: "Отмена", exact: true }).click();
  await button("Сбросить черновик").click();
  checks.push("Storage failure gives actionable recovery and does not start a price publication");

  await page.screenshot({ path: `${directory}/price-books-desktop.png`, fullPage: true });
  const pricesBefore = JSON.stringify(
    await prisma.storePrice.findMany({ where: { organizationId: org.id }, orderBy: { id: "asc" } }),
  );
  await button("Сверка магазинов").click();
  await page.getByRole("combobox", { name: "Магазин-источник", exact: true }).click();
  await page.getByRole("option", { name: stores[0].name, exact: true }).click();
  await page.getByRole("combobox", { name: "Магазин для сверки", exact: true }).click();
  await page.getByRole("option", { name: stores[1].name, exact: true }).click();
  await page.getByRole("cell", { name: product.name, exact: false }).first().waitFor();
  assert.equal(
    JSON.stringify(
      await prisma.storePrice.findMany({
        where: { organizationId: org.id },
        orderBy: { id: "asc" },
      }),
    ),
    pricesBefore,
  );
  checks.push("Source/target comparison shows real store differences without writing prices");
  const sourceSelect = page.getByRole("combobox", { name: "Магазин-источник", exact: true });
  assert.equal(await sourceSelect.getAttribute("data-bazaar-field"), "select");
  assert(
    await sourceSelect.evaluate(
      (element) => Number.parseFloat(getComputedStyle(element).paddingRight) >= 8,
    ),
  );
  await sourceSelect.click();
  await page.getByRole("option", { name: stores[1].name, exact: true }).click();
  assert.equal(
    (
      await page.getByRole("combobox", { name: "Магазин для сверки", exact: true }).innerText()
    ).trim(),
    "Выберите магазин",
  );
  await sourceSelect.click();
  await page.getByRole("option", { name: stores[0].name, exact: true }).click();
  await page.getByRole("combobox", { name: "Магазин для сверки", exact: true }).click();
  await page.getByRole("option", { name: stores[1].name, exact: true }).click();
  checks.push(
    "Comparison uses the shared padded select and clears a target that becomes the source",
  );
  await button("Прайсы").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(`button[aria-label="Настроить цену ${product.name}"]:visible`).waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.equal(
    (
      await page.locator(`button[aria-label="Настроить цену ${product.name}"]:visible`).innerText()
    ).trim(),
    "",
  );
  await page.screenshot({ path: `${directory}/price-books-mobile.png`, fullPage: true });
  await page.locator(`button[aria-label="Настроить цену ${product.name}"]:visible`).click();
  await page.screenshot({ path: `${directory}/price-books-mobile-editor.png`, fullPage: true });
  await dialog().getByRole("button", { name: "Закрыть", exact: true }).click();
  await button("Массовая правка").click();
  const modeSelect = dialog().getByRole("combobox", { name: "Способ изменения", exact: true });
  await modeSelect.press("Enter");
  await page.getByRole("listbox").waitFor();
  await page.keyboard.press("Escape");
  assert(await dialog().isVisible());
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("aria-label") === "Способ изменения",
  );
  assert(await modeSelect.evaluate((element) => element === document.activeElement));
  await modeSelect.click();
  await page.getByRole("option", { name: "Установить значение", exact: true }).click();
  assert(
    await dialog().getByRole("button", { name: "Проверить изменения", exact: true }).isDisabled(),
  );
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({
    path: `${directory}/price-books-mobile-bulk-select.png`,
    fullPage: true,
  });
  await dialog().getByRole("button", { name: "Закрыть", exact: true }).click();
  checks.push(
    "Mobile shared selects work inside the bulk dialog; Escape closes only the menu and no price is published",
  );
  checks.push(
    "Desktop/mobile use icon-only row actions, readable price cards, named fields and no horizontal page overflow",
  );
  for (const [lang, title] of [
    ["kg", "Жалпы баа тизмелери"],
    ["en", "Shared price lists"],
    ["ru", "Общие прайсы"],
  ]) {
    await context.addCookies([{ name: "NEXT_LOCALE", value: lang, url: "http://localhost:3124" }]);
    await page.goto("http://localhost:3124/settings/price-lists", {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("heading", { name: title, exact: true }).waitFor();
  }
  checks.push("RU/KG/EN render the actual shared pricing page without missing translations");
  await api.priceBooks.publish({
    ...(await (async () => {
      const change = {
        kind: "SOURCE" as const,
        storeIds: [stores[1].id],
        productId: product.id,
        retailShared: true,
        wholesaleShared: true,
      };
      const p = await api.priceBooks.preview({ bookId, change });
      return { bookId, change, token: p.token, idempotencyKey: randomUUID() };
    })()),
  });
  const card = await context.newPage();
  card.on("pageerror", (e) => errors.push(e.message));
  await card.goto(`http://localhost:3124/products/${product.id}?storeId=${stores[1].id}`, {
    waitUntil: "domcontentloaded",
  });
  const nameField = card.locator('input[name="name"]:visible');
  const priceField = card.locator('input[name="retailPriceKgs"]:visible');
  await nameField.waitFor();
  await nameField.fill("Имя сохранено без подмены общего прайса");
  const commonChange = {
    kind: "PRICES" as const,
    entries: [{ productId: product.id, retailPriceKgs: 240, wholesalePriceKgs: 120 }],
  };
  const commonPreview = await api.priceBooks.preview({ bookId, change: commonChange });
  await api.priceBooks.publish({
    bookId,
    change: commonChange,
    token: commonPreview.token,
    idempotencyKey: randomUUID(),
  });
  await card.waitForFunction(
    () =>
      (document.querySelector('input[name="retailPriceKgs"]') as HTMLInputElement)?.value === "240",
  );
  assert.equal(await nameField.inputValue(), "Имя сохранено без подмены общего прайса");
  assert.equal(await priceField.inputValue(), "240");
  const savedResponse = card.waitForResponse(
    (r) => r.url().includes("products.update") && r.request().method() === "POST",
  );
  await card.locator('button[form="product-edit-form"]:visible').click();
  const savedResult = await savedResponse;
  assert(savedResult.ok(), await savedResult.text());
  await card.waitForFunction(() => {
    const b = document.querySelector('button[form="product-edit-form"]') as HTMLButtonElement;
    return b && !b.disabled && !b.textContent?.includes("Сохраня");
  });
  const savedProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert.equal(savedProduct.name, "Имя сохранено без подмены общего прайса");
  assert.equal(
    (
      await prisma.priceBookStoreItem.findFirstOrThrow({
        where: { storeId: stores[1].id, productId: product.id },
      })
    ).retailShared,
    true,
  );
  const nextChange = {
      ...commonChange,
      entries: [{ ...commonChange.entries[0], retailPriceKgs: 250 }],
    },
    nextPreview = await api.priceBooks.preview({ bookId, change: nextChange });
  await api.priceBooks.publish({
    bookId,
    change: nextChange,
    token: nextPreview.token,
    idempotencyKey: randomUUID(),
  });
  assert.equal(await currentPrice(stores[1].id), 250);
  await card.close();
  checks.push(
    "A live common-price update refreshes pristine product fields, preserves a name being edited, and a metadata-only Save retains inheritance",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    `${directory}/price-book-browser-checks.json`,
    JSON.stringify({ checks, errors, organizationId: org.id, bookId }, null, 2),
  );
  console.log(JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  const failedPage = context.pages().at(-1) ?? page;
  await writeFile(
    `${directory}/price-book-browser-failure.txt`,
    `${error}\n${await failedPage.locator("body").innerText()}`,
  );
  await failedPage.screenshot({
    path: `${directory}/price-book-browser-failure.png`,
    fullPage: true,
  });
  throw error;
} finally {
  await context.close();
  await browser.close();
  await prisma.$disconnect();
  const { getRedisPublisher, getRedisSubscriber } = await import("../../src/server/redis");
  getRedisPublisher()?.disconnect();
  getRedisSubscriber()?.disconnect();
}
