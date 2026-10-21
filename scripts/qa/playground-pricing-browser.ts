import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
import { chromium } from "playwright";
import ru from "../../messages/ru.json";
import kg from "../../messages/kg.json";
import en from "../../messages/en.json";

import { getPlanCatalogEntries } from "../../src/server/billing/planCatalog";
import { PLAN_FEATURE_CODES } from "../../src/lib/billing/plans";

const base = "http://localhost:3120";
const url = process.env.PLAYGROUND_DATABASE_URL;
assert(
  url && process.env.VERCEL_ENV !== "production",
  "Only an explicit local test database is allowed",
);
const identity = new URL(url);
assert(["localhost", "127.0.0.1"].includes(identity.hostname));
assert.equal(identity.pathname, "/bazaar_hardening_agent4_platform");
assert.equal(identity.username, "bazaar_test");
const db = new PrismaClient({ datasourceUrl: url });
const directory = "tmp/playground-verification/browser";
await mkdir(directory, { recursive: true });
const checks: string[] = [];
const browser = await chromium.launch({ headless: true });
const plans = getPlanCatalogEntries();
const messages = { ru, kg, en };
const sessionCookies = async (user: {
  id: string;
  sessionVersion: number;
  organizationId: string | null;
  role: string;
  isOrgOwner: boolean;
  email: string;
  name: string;
}) => {
  assert(user.organizationId, "A synthetic session must belong to the QA organization");
  const value = await encode({
    secret: "playground-local-test-only",
    token: {
      sub: user.id,
      sessionVersion: user.sessionVersion,
      organizationId: user.organizationId,
      role: user.role,
      isOrgOwner: user.isOrgOwner,
      email: user.email,
      name: user.name,
    },
  });
  // NextAuth uses its production Secure cookie; middleware on this HTTP-only
  // localhost harness also needs the default HTTP cookie. Both carry the same JWT.
  return [
    { name: "next-auth.session-token", value, url: base },
    {
      name: "__Secure-next-auth.session-token",
      value,
      url: base.replace("http:", "https:"),
      secure: true,
    },
  ];
};
try {
  const [actual] = await db.$queryRaw<
    Array<{ database: string; username: string }>
  >`SELECT current_database() AS database, current_user AS username`;
  assert.equal(actual.database, identity.pathname.slice(1));
  assert.equal(actual.username, "bazaar_test");
  const organization = await db.organization.create({
    data: {
      name: `Pricing QA ${randomUUID()}`,
      plan: "STARTER",
      trialEndsAt: new Date(Date.now() + 7 * 86400000),
      currentPeriodEndsAt: new Date(Date.now() + 7 * 86400000),
    },
  });
  const store = await db.store.create({
    data: { organizationId: organization.id, name: "Pricing test store", code: "QA" },
  });
  const admin = await db.user.create({
    data: {
      organizationId: organization.id,
      name: "Pricing QA",
      email: `pricing-${randomUUID()}@example.invalid`,
      passwordHash: "synthetic-unused",
      role: "ADMIN",
      isOrgOwner: true,
      emailVerifiedAt: new Date(),
    },
  });
  const cashier = await db.user.create({
    data: {
      organizationId: organization.id,
      name: "Cashier QA",
      email: `cashier-${randomUUID()}@example.invalid`,
      passwordHash: "synthetic-unused",
      role: "CASHIER",
      emailVerifiedAt: new Date(),
    },
  });
  await db.userStoreAccess.create({
    data: { organizationId: organization.id, userId: cashier.id, storeId: store.id },
  });
  await db.posRegister.create({
    data: {
      organizationId: organization.id,
      storeId: store.id,
      code: "QA",
      name: "Pricing QA register",
    },
  });
  for (const locale of ["ru", "kg", "en"] as const)
    for (const width of [390, 1440]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: "reduce",
      });
      await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: base }]);
      await context.route("**/*", (route) =>
        new URL(route.request().url()).origin === base ? route.continue() : route.abort(),
      );
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(base, { waitUntil: "networkidle" });
      assert.equal(await page.locator("#pricing article").count(), 3);
      assert.equal(
        await page.locator("#pricing h2").textContent(),
        messages[locale].billing.publicPricing.title,
      );
      const offers = JSON.parse(
        (await page.locator('script[type="application/ld+json"]').textContent())!,
      ).offers;
      assert.deepEqual(
        offers.map((offer: { price: string }) => offer.price),
        plans.map((plan) => String(plan.monthlyPriceKgs)),
      );
      await page.locator("#pricing details summary").click();
      assert.equal(
        await page.locator("#pricing tr[data-feature]").count(),
        PLAN_FEATURE_CODES.length,
      );
      for (const feature of PLAN_FEATURE_CODES) {
        assert.deepEqual(
          await page
            .locator(`#pricing tr[data-feature="${feature}"] td`)
            .evaluateAll((cells) => cells.map((cell) => cell.getAttribute("data-included"))),
          plans.map((plan) => String(plan.features[feature])),
        );
      }
      await page
        .locator("#pricing")
        .screenshot({ path: `${directory}/pricing-${locale}-${width}.png` });
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        "Public pricing overflows the viewport",
      );
      await context.addCookies(await sessionCookies(admin));
      await page.goto(`${base}/billing`, { waitUntil: "networkidle" });
      try {
        await page.locator("table").waitFor();
      } catch (error) {
        await page.screenshot({ path: `${directory}/billing-failure.png`, fullPage: true });
        console.error(
          "Billing QA",
          page.url(),
          (await page.locator("body").innerText()).slice(0, 1600),
          errors,
        );
        throw error;
      }
      assert.equal(await page.locator("table tbody tr").count(), 3 + PLAN_FEATURE_CODES.length);
      assert.equal(await page.locator("h1").textContent(), messages[locale].billing.title);
      for (const [index, feature] of PLAN_FEATURE_CODES.entries()) {
        assert.deepEqual(
          await page
            .locator("table tbody tr")
            .nth(index + 3)
            .locator("td")
            .allTextContents(),
          [
            messages[locale].billing.features[feature],
            ...plans.map((plan) =>
              plan.features[feature]
                ? messages[locale].billing.comparison.included
                : messages[locale].billing.comparison.locked,
            ),
          ],
        );
      }
      assert.equal(
        (await page.locator('a[href="/pos"]').count()) > 0,
        true,
        "Starter POS navigation is unavailable",
      );
      await page.screenshot({
        path: `${directory}/billing-${locale}-${width}.png`,
        fullPage: true,
      });
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        "Billing overflows the viewport",
      );
      assert.deepEqual(errors, []);
      checks.push(
        `${locale} ${width}: public prices/feature matrix, Starter billing and navigation, no overflow or browser exception`,
      );
      await context.close();
    }
  const context = await browser.newContext();
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === base ? route.continue() : route.abort(),
  );
  await context.addCookies(await sessionCookies(cashier));
  const page = await context.newPage();
  await page.goto(`${base}/pos`, { waitUntil: "networkidle" });
  assert.equal(new URL(page.url()).pathname, "/pos");
  const response = await context.request.get(
    `${base}/api/trpc/pos.registers.list?input=${encodeURIComponent(JSON.stringify({ json: { status: "active" } }))}`,
  );
  assert.equal(response.status(), 200);
  assert((await response.text()).includes("Pricing QA register"));
  checks.push("Starter cashier can load POS and read the allowed register through HTTP");
  await context.close();
  await writeFile(
    `${directory}/report.json`,
    JSON.stringify(
      { status: "PASS", checks, productionBundle: true, syntheticFixturesOnly: true },
      null,
      2,
    ),
  );
  console.log(`PASS: ${checks.length} browser scenarios`);
} finally {
  await browser.close();
  await db.$disconnect();
}
