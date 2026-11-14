import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
import { chromium } from "playwright";

const base = "http://localhost:3148";
const db = new PrismaClient({
  datasourceUrl: "postgresql://bazaar_test@127.0.0.1:55981/bazaar_hardening_agent4_platform",
});
const out = ".local/china-image-search/browser";
await mkdir(out, { recursive: true });
const [identity] =
  await db.$queryRaw`SELECT current_database() AS database, current_user AS username`;
assert.equal(identity.database, "bazaar_hardening_agent4_platform");
assert.equal(identity.username, "bazaar_test");
const org = await db.organization.upsert({
  where: { id: "china-image-search-qa-org" },
  update: {},
  create: {
    id: "china-image-search-qa-org",
    name: "Photo Search QA",
    plan: "ENTERPRISE",
  },
});
const user = await db.user.upsert({
  where: { email: "china-image-search-qa@example.invalid" },
  update: {},
  create: {
    organizationId: org.id,
    email: "china-image-search-qa@example.invalid",
    name: "Photo Search QA",
    passwordHash: "not-a-real-password",
    role: "ADMIN",
    isOrgOwner: true,
    emailVerifiedAt: new Date(),
    preferredLocale: "ru",
  },
});
const foreign = await db.organization.upsert({
  where: { id: "china-image-search-qa-foreign" },
  update: {},
  create: {
    id: "china-image-search-qa-foreign",
    name: "Foreign QA",
    plan: "ENTERPRISE",
  },
});
const foreignUser = await db.user.upsert({
  where: { email: "china-image-search-foreign@example.invalid" },
  update: {},
  create: {
    organizationId: foreign.id,
    email: "china-image-search-foreign@example.invalid",
    name: "Foreign QA",
    passwordHash: "not-a-real-password",
    role: "ADMIN",
    isOrgOwner: true,
    emailVerifiedAt: new Date(),
    preferredLocale: "ru",
  },
});
await db.$disconnect();
const cookie = async (user) => ({
  name: "__Secure-next-auth.session-token",
  secure: true,
  value: await encode({
    secret: "disposable-china-image-search-secret",
    token: {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId: user.organizationId,
      sessionVersion: user.sessionVersion,
    },
  }),
  url: base.replace("http:", "https:"),
});
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const isolatedContext = async (options) => {
  const context = await browser.newContext(options);
  await context.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return ["localhost", "127.0.0.1"].includes(host) ? route.continue() : route.abort();
  });
  return context;
};
const errors = [];
const checks = [];
try {
  for (const viewport of [
    { width: 1440, height: 1050 },
    { width: 390, height: 844 },
  ]) {
    const context = await isolatedContext({ viewport, locale: "ru-RU" });
    await context.addCookies([await cookie(user), { name: "NEXT_LOCALE", value: "ru", url: base }]);
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    let providerRequests = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).hostname === "api.hiobuy.com") providerRequests++;
    });
    await page.goto(`${base}/operations/integrations/china-image-search`);
    await page.screenshot({ path: `${out}/initial-${viewport.width}.png`, fullPage: true });
    await writeFile(`${out}/initial-${viewport.width}.txt`, await page.locator("body").innerText());
    await page.getByRole("button", { name: "Загрузить фото", exact: true }).first().waitFor();
    await page.locator('input[type="file"][capture="environment"]').waitFor({ state: "attached" });
    await page
      .getByLabel("Загрузить фото", { exact: true })
      .setInputFiles("public/retails/gallery-teply-dom-20261113/mug.webp");
    await page.getByRole("button", { name: "Показать тестовые карточки" }).click();
    await page.getByRole("heading", { name: "Тестовые карточки · не результаты 1688" }).waitFor();
    assert.equal(await page.locator('a[href*="detail.1688.com"]').count(), 0);
    assert.equal(
      await page
        .getByText("Тестовая карточка — реального предложения нет.", { exact: true })
        .count(),
      3,
    );
    assert.equal(providerRequests, 0);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false,
    );
    await page.screenshot({ path: `${out}/demo-${viewport.width}.png`, fullPage: true });
    // Simulate an application response, never a provider request or a real result.
    let calls = 0;
    await page.route("**/api/china-image-search", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      calls++;
      return route.fulfill({
        status: calls === 1 ? 504 : 200,
        contentType: "application/json",
        body: JSON.stringify(
          calls === 1
            ? { message: "imageSearchTimeout" }
            : { mode: "demo", channel: "1688", items: [], total: 0 },
        ),
      });
    });
    await page.getByRole("button", { name: "Показать тестовые карточки" }).click();
    await page.getByRole("alert").filter({ hasText: "HioBuy не ответил вовремя" }).waitFor();
    await page.screenshot({ path: `${out}/error-${viewport.width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Повторить", exact: true }).click();
    await page.getByText("Похожих товаров не найдено.", { exact: false }).waitFor();
    await page.screenshot({ path: `${out}/empty-${viewport.width}.png`, fullPage: true });
    checks.push({
      viewport,
      demoCards: 3,
      noProviderCalls: true,
      noOverflow: true,
      retryEmpty: true,
    });
    await context.close();
  }
  for (const locale of ["kg", "en"]) {
    const context = await isolatedContext({ viewport: { width: 390, height: 844 } });
    await context.addCookies([
      await cookie(user),
      { name: "NEXT_LOCALE", value: locale, url: base },
    ]);
    const page = await context.newPage();
    await page.goto(`${base}/operations/integrations/china-image-search`);
    await page.locator('input[type="file"]').first().waitFor({ state: "attached" });
    await page.screenshot({ path: `${out}/${locale}-390.png`, fullPage: true });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false,
    );
    checks.push({ locale, noOverflow: true });
    await context.close();
  }
  const foreignContext = await isolatedContext();
  await foreignContext.addCookies([
    await cookie(foreignUser),
    { name: "NEXT_LOCALE", value: "ru", url: base },
  ]);
  const page = await foreignContext.newPage();
  await page.goto(`${base}/operations/integrations/china-image-search`);
  await page.getByText("Поиск не подключён", { exact: true }).waitFor();
  assert.equal(await page.locator('input[type="file"]').count(), 0);
  checks.push({ foreignOrganizationDisabled: true });
  await foreignContext.close();
  assert.deepEqual(errors, []);
  await writeFile(`${out}/checks.json`, JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }));
} finally {
  await browser.close();
}
