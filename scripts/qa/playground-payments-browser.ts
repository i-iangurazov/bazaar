// Production-bundle UI checks on isolated local data. The ready checkout view
// below is an explicit browser response fixture, not a provider sandbox test.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
import { chromium } from "playwright";
import ru from "../../messages/ru.json";
import kg from "../../messages/kg.json";
import en from "../../messages/en.json";

const base = "http://localhost:3120";
const databaseUrl = process.env.PLAYGROUND_DATABASE_URL;
assert(databaseUrl && process.env.VERCEL_ENV !== "production");
const identity = new URL(databaseUrl);
assert(["localhost", "127.0.0.1"].includes(identity.hostname));
assert.equal(identity.pathname, "/bazaar_hardening_agent4_platform");
assert.equal(identity.username, "bazaar_test");
const db = new PrismaClient({ datasourceUrl: databaseUrl });
const browser = await chromium.launch({ headless: true });
const directory = "tmp/subscription-payments/browser";
await mkdir(directory, { recursive: true });
const checks: string[] = [];
const messages = { ru, kg, en };
try {
  const [actual] = await db.$queryRaw<
    Array<{ database: string; username: string }>
  >`SELECT current_database() AS database, current_user AS username`;
  assert.equal(actual.database, identity.pathname.slice(1));
  assert.equal(actual.username, "bazaar_test");
  const organization = await db.organization.create({
    data: {
      name: `Payments UI QA ${randomUUID()}`,
      plan: "STARTER",
      trialEndsAt: new Date(Date.now() + 7 * 86400000),
      currentPeriodEndsAt: new Date(Date.now() + 7 * 86400000),
    },
  });
  const admin = await db.user.create({
    data: {
      organizationId: organization.id,
      name: "Payments synthetic QA",
      email: `payments-${randomUUID()}@example.invalid`,
      passwordHash: "synthetic-unused",
      role: "ADMIN",
      isOrgOwner: true,
      emailVerifiedAt: new Date(),
    },
  });
  const token = await encode({
    secret: "playground-local-test-only",
    token: {
      sub: admin.id,
      sessionVersion: admin.sessionVersion,
      organizationId: organization.id,
      role: "ADMIN",
      isOrgOwner: true,
      email: admin.email,
      name: admin.name,
    },
  });
  for (const locale of ["ru", "kg", "en"] as const)
    for (const width of [390, 1440]) {
      const scenarioAdmin = await db.user.create({
        data: {
          organizationId: organization.id,
          name: "Payments scenario",
          email: `payments-${randomUUID()}@example.invalid`,
          passwordHash: "synthetic-unused",
          role: "ADMIN",
          isOrgOwner: true,
          emailVerifiedAt: new Date(),
        },
      });
      const scenarioToken = await encode({
        secret: "playground-local-test-only",
        token: {
          sub: scenarioAdmin.id,
          sessionVersion: scenarioAdmin.sessionVersion,
          organizationId: organization.id,
          role: "ADMIN",
          isOrgOwner: true,
          email: scenarioAdmin.email,
          name: scenarioAdmin.name,
        },
      });
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: "reduce",
      });
      await context.addCookies([
        { name: "NEXT_LOCALE", value: locale, url: base },
        { name: "next-auth.session-token", value: scenarioToken, url: base },
        {
          name: "__Secure-next-auth.session-token",
          value: scenarioToken,
          url: "https://localhost:3120",
          secure: true,
        },
      ]);
      await context.route("**/*", (route) =>
        new URL(route.request().url()).origin === base ? route.continue() : route.abort(),
      );
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await db.organization.update({
        where: { id: organization.id },
        data: { subscriptionBillingMode: "MANUAL" },
      });
      await page.goto(`${base}/billing`, { waitUntil: "networkidle" });
      const panel = page.locator("[data-subscription-payments]");
      await panel
        .getByText(messages[locale].billing.payments.manualAccess, { exact: true })
        .waitFor();
      assert.equal(await panel.locator("[data-checkout-form]").count(), 0);
      await db.organization.update({
        where: { id: organization.id },
        data: { subscriptionBillingMode: "SELF_SERVE" },
      });
      await page.reload({ waitUntil: "networkidle" });
      await panel
        .getByText(messages[locale].billing.payments.unavailable, { exact: true })
        .waitFor();
      await panel.getByText(messages[locale].billing.payments.empty, { exact: true }).waitFor();
      await panel.screenshot({ path: `${directory}/disabled-${locale}-${width}.png` });
      // Only the read model is made ready in this fixture. Submitting still hits
      // the real disabled backend and must show a recoverable, localized error.
      let fixturePrice = 175000;
      await context.route("**/api/trpc/**", async (route) => {
        const procedures = new URL(route.request().url()).pathname.split("/").at(-1)!.split(",");
        if (!procedures.includes("billing.payments.get")) return route.continue();
        const response = await route.fetch();
        const data = await response.json();
        const list = Array.isArray(data) ? data : [data];
        const item = list[procedures.indexOf("billing.payments.get")];
        assert(item.result?.data?.json, "Unexpected tRPC response structure");
        item.result.data.json.catalog = item.result.data.json.catalog.map(
          (entry: { plan: string; amountMinor: number }) => ({
            ...entry,
            amountMinor: entry.plan === "STARTER" ? fixturePrice : entry.amountMinor,
          }),
        );
        Object.assign(item.result.data.json, {
          available: true,
          canPurchase: true,
          mode: "sandbox",
          sellerName: "Synthetic UI seller",
          termsUrl: `${base}/terms`,
          termsVersion: "qa-browser-v1",
        });
        await route.fulfill({ response, json: Array.isArray(data) ? list : list[0] });
      });
      const requests: Array<{ idempotencyKey: string; expectedAmountMinor: number }> = [];
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.endsWith("/billing.payments.checkout")) {
          fixturePrice = 199900;
          const body = request.postDataJSON();
          requests.push(body["0"].json);
        }
      });
      await page.reload({ waitUntil: "networkidle" });
      const form = panel.locator("[data-checkout-form]");
      await form.locator("button").last().click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      const submit = dialog.getByRole("button", {
        name: messages[locale].billing.payments.goToPayment,
        exact: true,
      });
      const quotedDescription = await dialog.locator("p").first().textContent();
      assert.equal(await submit.isDisabled(), true);
      await dialog.getByRole("checkbox").check();
      assert.equal(await submit.isEnabled(), true);
      await submit.click();
      await dialog.getByRole("alert").waitFor();
      assert.equal(
        await dialog.getByRole("alert").textContent(),
        messages[locale].errors.billingPaymentsUnavailable,
      );
      await submit.click();
      await page.waitForResponse((r) => r.url().includes("billing.payments.checkout"));
      assert.equal(requests.length, 2);
      assert.equal(requests[0].idempotencyKey, requests[1].idempotencyKey);
      assert.equal(requests[0].expectedAmountMinor, 175000);
      assert.equal(
        await db.subscriptionInvoice.count({ where: { organizationId: organization.id } }),
        0,
      );
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        "Payment dialog overflows",
      );
      await dialog.screenshot({ path: `${directory}/confirm-error-${locale}-${width}.png` });
      assert.deepEqual(errors, []);
      checks.push(
        `${locale} ${width}: real manual/disabled/empty states; fixture consent and backend refusal, retry key preserved, no invoice, no overflow or JS error`,
      );
      await context.close();
    }
  // Real invoice/history rendering, including a provider review, on the same
  // isolated database. No merchant/provider calls occur in this UI harness.
  const invoice = await db.subscriptionInvoice.create({
    data: {
      organizationId: organization.id,
      createdById: admin.id,
      idempotencyKey: randomUUID(),
      pendingSlot: organization.id,
      plan: "STARTER",
      amountMinor: 175000,
      currency: "KGS",
      status: "REVIEW",
      merchantId: "90001",
      isTest: true,
      sellerName: "Synthetic UI seller",
      termsVersion: "qa-browser-v1",
      termsUrl: `${base}/terms`,
      expiresAt: new Date(Date.now() + 900000),
      lastIssue: "REFUND_REVIEW",
    },
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === base ? route.continue() : route.abort(),
  );
  await context.addCookies([
    { name: "NEXT_LOCALE", value: "ru", url: base },
    { name: "next-auth.session-token", value: token, url: base },
    {
      name: "__Secure-next-auth.session-token",
      value: token,
      url: "https://localhost:3120",
      secure: true,
    },
  ]);
  const page = await context.newPage();
  await page.goto(`${base}/billing`, { waitUntil: "networkidle" });
  const pending = page.locator("[data-pending-invoice]");
  await pending.getByText(ru.billing.payments.reviewHint).waitFor();
  assert.equal(await pending.locator('a[href="https://wa.me/996709911300"]').count(), 1);
  await page.locator(`[data-subscription-invoice="${invoice.id}"] summary`).click();
  await page.getByText("Synthetic UI seller", { exact: true }).waitFor();
  await page
    .locator("[data-subscription-payments]")
    .screenshot({ path: `${directory}/review-history-ru-390.png` });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  checks.push("Real DB review and invoice history, seller/terms snapshot and support on mobile");
  await context.close();
  const owner = await db.user.upsert({
    where: { email: "payments-owner@example.invalid" },
    create: {
      email: "payments-owner@example.invalid",
      name: "Synthetic platform owner",
      organizationId: organization.id,
      role: "ADMIN",
      isOrgOwner: true,
      passwordHash: "synthetic-unused",
      emailVerifiedAt: new Date(),
    },
    update: { organizationId: organization.id, role: "ADMIN", isOrgOwner: true },
  });
  const ownerToken = await encode({
    secret: "playground-local-test-only",
    token: {
      sub: owner.id,
      sessionVersion: owner.sessionVersion,
      organizationId: organization.id,
      role: "ADMIN",
      isOrgOwner: true,
      isPlatformOwner: true,
      email: owner.email,
      name: owner.name,
    },
  });
  const ownerContext = await browser.newContext({ viewport: { width: 390, height: 900 } });
  await ownerContext.route("**/*", (route) =>
    new URL(route.request().url()).origin === base ? route.continue() : route.abort(),
  );
  await ownerContext.addCookies([
    { name: "NEXT_LOCALE", value: "ru", url: base },
    { name: "next-auth.session-token", value: ownerToken, url: base },
    {
      name: "__Secure-next-auth.session-token",
      value: ownerToken,
      url: "https://localhost:3120",
      secure: true,
    },
  ]);
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`${base}/platform`, { waitUntil: "networkidle" });
  const reviews = ownerPage.locator("[data-payment-reviews]");
  const review = reviews.locator("li").filter({ hasText: invoice.id });
  await review.waitFor();
  await review.getByRole("button", { name: ru.platformOwner.paymentReviews.resolve }).click();
  const resolution = ownerPage.getByRole("dialog");
  const close = resolution.getByRole("button", {
    name: ru.platformOwner.paymentReviews.resolve,
    exact: true,
  });
  assert.equal(await close.isDisabled(), true);
  await resolution
    .getByRole("textbox")
    .fill("Synthetic QA case reviewed with customer; no money or access change");
  await resolution.getByRole("checkbox").check();
  await resolution.screenshot({ path: `${directory}/owner-review-ru-390.png` });
  await close.click();
  await resolution.waitFor({ state: "hidden" });
  assert.equal(
    (await db.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).status,
    "RESOLVED",
  );
  assert.equal(
    await db.auditLog.count({
      where: { entityId: invoice.id, action: "SUBSCRIPTION_REVIEW_RESOLVED" },
    }),
    1,
  );
  assert.equal(
    await db.subscriptionPeriod.count({ where: { organizationId: organization.id } }),
    0,
  );
  assert(await ownerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  checks.push(
    "Owner mobile review: explicit confirmation and note, real audited closure, no fictitious paid period",
  );
  const beforeBillingEdit = await db.organization.findUniqueOrThrow({
    where: { id: organization.id },
  });
  await ownerPage
    .locator("tr")
    .filter({ hasText: organization.name })
    .getByRole("button", { name: ru.platformOwner.editBilling, exact: true })
    .click();
  const billingEdit = ownerPage.getByRole("dialog");
  assert.equal(await billingEdit.getByRole("checkbox").isChecked(), false);
  for (const input of await billingEdit.locator('input[type="number"]').all())
    assert.equal(await input.isDisabled(), true);
  await billingEdit.getByRole("combobox", { name: ru.platformOwner.billingMode }).click();
  await ownerPage
    .getByRole("option", { name: ru.platformOwner.billingModeManual, exact: true })
    .click();
  await billingEdit.getByRole("button", { name: ru.common.save, exact: true }).click();
  await billingEdit.waitFor({ state: "hidden" });
  const afterBillingEdit = await db.organization.findUniqueOrThrow({
    where: { id: organization.id },
  });
  assert.equal(afterBillingEdit.subscriptionBillingMode, "MANUAL");
  assert.deepEqual(afterBillingEdit.currentPeriodEndsAt, beforeBillingEdit.currentPeriodEndsAt);
  assert.deepEqual(afterBillingEdit.trialEndsAt, beforeBillingEdit.trialEndsAt);
  checks.push("Owner mode change preserves exact trial/paid dates unless explicitly changed");
  await ownerContext.close();
  await writeFile(
    `${directory}/report.json`,
    JSON.stringify(
      { status: "PASS", productionBundle: true, realProviderSandbox: false, checks },
      null,
      2,
    ),
  );
  console.log(`PASS: ${checks.length} payment browser scenarios`);
} finally {
  await browser.close();
  await db.$disconnect();
}
