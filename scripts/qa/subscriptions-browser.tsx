// Actual local UI with genuine quotes and a real DISABLED checkout backend.
// GoPay readiness is a labelled browser response fixture; no provider is tested.
// Historical and test invoice rows below are synthetic local render fixtures.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Response as BrowserResponse,
} from "playwright";
import { subscriptionReleaseMigrations } from "../deployment/prepare-subscription-rollback";
import { WHATSAPP_OFFER_VERSION, WHATSAPP_PACK_PRICE_MINOR } from "../../src/lib/whatsapp-ai";
import ru from "../../messages/ru.json";
import kg from "../../messages/kg.json";
import en from "../../messages/en.json";

const base = "http://localhost:3137";
const databaseUrl = "postgresql://bazaar_test@127.0.0.1:55971/bazaar_hardening_agent4_platform";
const fixtureRoot = resolve(".local/subscriptions-20261107");
const directory = resolve(process.env.QA_SUBSCRIPTIONS_ARTIFACT_DIR ?? ".local/gopay-20261109/browser");
const reviewOnly = process.env.QA_SUBSCRIPTIONS_REVIEW_ONLY === "1";
assert.notEqual(process.env.VERCEL_ENV, "production");
assert(
  (await readFile(resolve(fixtureRoot, "TEST-INFRASTRUCTURE-ONLY"), "utf8")).startsWith(
    "Disposable local subscription QA",
  ),
);
const db = new PrismaClient({ datasourceUrl: databaseUrl });
const checks: Record<string, unknown>[] = [];
const failures: string[] = [];
const messages = { ru, kg, en };
type Locale = keyof typeof messages;
type Plan = "STARTER" | "BUSINESS" | "ENTERPRISE";
type Quote = {
  plan: Plan;
  months: number;
  amountMinor: number;
  extras: { stores: number; productPacks: number; userPacks: number };
  quoteToken: string;
};
type Checkout = Quote & { idempotencyKey: string; expectedAmountMinor: number; expectedProvider: "GOPAY" | "FREEDOMPAY" };
type BillingSummary = {
  billingCatalogVersion: string;
  planTier: Plan;
  lifetimeAccess: boolean;
  hasAccess: boolean;
  monthlyPriceKgs: number;
  usageLimits: { ai: number | null };
  planCatalog: Array<{ monthlyPriceKgs: number }>;
};
type BillingWire = { result: { data: { json: BillingSummary } } };
const names: Array<[string, string, Plan]> = [
  ["cmldyo7dn0005btviqlnua4ii", "mpo.kg", "ENTERPRISE"],
  ["cmohj800e0005blb2bybx77dy", "roksosh", "BUSINESS"],
  ["cmoiyjd650005inhb5bku5bsv", "skladondemand", "BUSINESS"],
  ["cmp5ntkgg0005njbftimmsg32", "Avant", "ENTERPRISE"],
  ["cmqayktaq003eomscrqp2p8wr", "Catwalk", "STARTER"],
];
const interpolate = (text: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    text,
  );
async function waitForServer() {
  const end = Date.now() + 60000;
  do {
    try {
      const response = await fetch(base + "/api/version", { signal: AbortSignal.timeout(2000) });
      const identity = await response.json();
      if (
        response.ok &&
        Object.hasOwn(identity, "sha") &&
        (identity.sha === null || /^[a-f0-9]{40}$/i.test(identity.sha))
      )
        return identity.sha as string | null;
    } catch {
      /* root owns startup; this runner only waits */
    }
    await new Promise((done) => setTimeout(done, 500));
  } while (Date.now() < end);
  throw new Error("Root-owned server3137 did not become ready; this script never starts it");
}
async function seed(
  plan: Plan = "STARTER",
  version: "2026-10" | "2026-11" = "2026-11",
  protectedId?: string,
) {
  let org = protectedId
    ? await db.organization.findUnique({
        where: { id: protectedId },
        include: { subscriptionContract: true },
      })
    : null;
  if (org)
    assert(
      org.name.startsWith("Synthetic") && org.subscriptionContract?.lifetimeAccess,
      "Protected fixture ID already belongs to an unrelated local record; request an explicit fixture rebuild",
    );
  if (!org)
    org = await db.organization.create({
      data: {
        ...(protectedId ? { id: protectedId } : {}),
        name: `Synthetic subscription browser ${randomUUID()}`,
        plan,
        subscriptionBillingMode: "MANUAL",
        subscriptionStatus: protectedId ? "PAST_DUE" : "ACTIVE",
        trialEndsAt: protectedId ? new Date("2020-01-01") : null,
        currentPeriodEndsAt: protectedId
          ? new Date("2020-01-01")
          : new Date(Date.now() + 30 * 86400000),
        subscriptionContract: {
          create: { catalogVersion: version, lifetimeAccess: Boolean(protectedId) },
        },
      },
      include: { subscriptionContract: true },
    });
  const user = await db.user.create({
    data: {
      organizationId: org.id,
      name: "Synthetic browser owner",
      email: `subscription-browser-${randomUUID()}@example.invalid`,
      role: "ADMIN",
      isOrgOwner: true,
      passwordHash: "unused-synthetic-browser-fixture",
      emailVerifiedAt: new Date(),
    },
  });
  if (!(await db.store.count({ where: { organizationId: org.id } })))
    await db.store.create({
      data: {
        organizationId: org.id,
        name: "Synthetic UI store",
        code: "BROWSER",
      },
    });
  const token = await encode({
    secret: "isolated-subscriptions-20261107-test-secret",
    token: {
      sub: user.id,
      sessionVersion: user.sessionVersion,
      organizationId: org.id,
      role: "ADMIN",
      isOrgOwner: true,
      email: user.email,
      name: user.name,
    },
  });
  return { org, user, token };
}
type Fixture = Awaited<ReturnType<typeof seed>>;
const commercialFields = async (id: string) => {
  const org = await db.organization.findUniqueOrThrow({
    where: { id },
    select: {
      plan: true,
      subscriptionStatus: true,
      subscriptionBillingMode: true,
      trialEndsAt: true,
      currentPeriodEndsAt: true,
      subscriptionContract: true,
    },
  });
  return JSON.stringify(org);
};
async function authenticate(context: BrowserContext, fixture: Fixture, locale: Locale) {
  await context.addCookies([
    { name: "NEXT_LOCALE", value: locale, url: base },
    { name: "next-auth.session-token", value: fixture.token, url: base },
    {
      name: "__Secure-next-auth.session-token",
      value: fixture.token,
      url: "https://localhost:3137",
      secure: true,
    },
  ]);
}
const overflow = async (page: Page) =>
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "Horizontal page overflow",
  );
const uiMoney = (page: Page, amount: number, locale: Locale) =>
  page.evaluate(
    (input) =>
      new Intl.NumberFormat(
        input.locale === "kg" ? "ky-KG" : input.locale === "ru" ? "ru-RU" : "en-US",
        {
          style: "currency",
          currency: "KGS",
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        },
      ).format(input.amount),
    { amount, locale },
  );
const choose = async (page: Page, id: string, label: string) => {
  await page.locator(`#${id}`).click();
  await page.getByRole("option", { name: label, exact: true }).click();
};

await mkdir(directory, { recursive: true });
let browser: Browser | undefined;
try {
  const [identity] = await db.$queryRaw<
    Array<{ name: string; username: string; directory: string }>
  >`
    SELECT current_database() AS name, current_user AS username, current_setting('data_directory') AS directory
  `;
  assert.equal(identity.name, "bazaar_hardening_agent4_platform");
  assert.equal(identity.username, "bazaar_test");
  assert.equal(resolve(identity.directory), resolve(fixtureRoot, "disposable-postgres-utf8"));
  const ledger = await db.$queryRaw<
    Array<{ migration_name: string }>
  >`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  for (const name of subscriptionReleaseMigrations)
    assert(
      ledger.some((row) => row.migration_name === name),
      `Missing migration ${name}`,
    );
  const observedServerSha = await waitForServer();
  checks.push({
    scenario: "readiness",
    observedServerSha,
    localShaMayBeNull: true,
    appliedReleaseMigrations: subscriptionReleaseMigrations.length,
  });
  browser = await chromium.launch({
    headless: true,
    channel: process.env.QA_BROWSER_CHANNEL ?? "chrome",
  });

  if (reviewOnly) {
    const fixture = await seed();
    await db.organization.update({ where: { id: fixture.org.id }, data: { subscriptionBillingMode: "SELF_SERVE" } });
    const before = await commercialFields(fixture.org.id);
    const context = await browser.newContext({ viewport: { width: 390, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
    await authenticate(context, fixture, "ru");
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.origin === base || ["data:", "blob:"].includes(url.protocol) ? route.continue() : route.abort();
    });
    try {
      const url = new URL(base + "/api/trpc/billing.payments.quote");
      url.searchParams.set("batch", "1");
      url.searchParams.set("input", JSON.stringify({ "0": { json: {
        plan: "STARTER", months: 1, extras: { stores: 0, productPacks: 0, userPacks: 0 }, action: "RENEW",
      } } }));
      const response = await context.request.get(url.href, { maxRedirects: 0 });
      const wire = await response.json(), quote = (Array.isArray(wire) ? wire[0] : wire)?.result?.data?.json;
      assert(response.ok() && quote?.organizationId === fixture.org.id && quote.amountMinor === 200000, "A real local server quote is required for the REVIEW fixture");
      await db.subscriptionInvoice.create({ data: {
        organizationId: fixture.org.id, createdById: fixture.user.id, idempotencyKey: randomUUID(),
        plan: "STARTER", amountMinor: quote.amountMinor, purchaseSnapshot: quote,
        provider: "GOPAY", providerOrderId: randomUUID().replaceAll("-", ""), isTest: true,
        status: "REVIEW", merchantId: "synthetic-review-only", sellerName: "Synthetic browser seller",
        termsVersion: "synthetic-display-only", termsUrl: base + "/legal/offer", checkoutUrl: null,
        expiresAt: new Date(Date.now() + 86400_000), nextCheckAt: new Date(Date.now() + 3600_000),
      } });
      const page = await context.newPage(), errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(base + "/billing", { waitUntil: "domcontentloaded" });
      const pending = page.locator("[data-pending-invoice]"), t = ru.billing.payments;
      await pending.getByText(interpolate(t.providerDescription, { provider: "GoPay" }), { exact: true }).waitFor();
      await pending.getByText(t.testInvoice, { exact: true }).waitFor();
      await pending.getByText(t.reviewHint, { exact: true }).waitFor();
      assert.equal(await pending.getByText(/Ссылка для оплаты действует до/).count(), 0, "REVIEW without a checkout URL must not claim link expiry");
      assert.equal(await pending.getByRole("link", { name: t.continue, exact: true }).count(), 0);
      assert.equal(await pending.getByRole("link", { name: t.support, exact: true }).count(), 1);
      assert.equal(await db.subscriptionPeriod.count({ where: { organizationId: fixture.org.id } }), 0);
      assert.equal(await commercialFields(fixture.org.id), before);
      await overflow(page);
      assert.deepEqual(errors, []);
      await pending.screenshot({ path: resolve(directory, "gopay-test-review-ru-390.png") });
      checks.push({ scenario: "final-review-only", locale: "ru", width: 390, absentCheckoutUrl: true,
        noFalseExpiry: true, supportAndCheckVisible: true, createdSubscriptionPeriods: 0,
        accessUnchanged: true, externalRequests: false, errors });
    } finally { await context.close(); }
  } else {
  for (const locale of ["ru", "kg", "en"] as const)
    for (const width of [390, 1440]) {
      const t = messages[locale].billing.payments;
      const fixture = await seed();
      const context: BrowserContext = await browser.newContext({
        viewport: { width, height: 1000 },
        reducedMotion: "reduce",
        serviceWorkers: "block",
      });
      await authenticate(context, fixture, locale);
      let readinessFixture = false;
      const quotes: Quote[] = [],
        requests: Checkout[] = [];
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        return url.origin === base || ["data:", "blob:"].includes(url.protocol)
          ? route.continue()
          : route.abort();
      });
      await context.route("**/api/trpc/**", async (route) => {
        if (new URL(route.request().url()).origin !== base) return route.abort();
        const procedures = new URL(route.request().url()).pathname.split("/").at(-1)!.split(",");
        if (procedures.includes("billing.payments.checkout")) {
          const body = route.request().postDataJSON();
          requests.push(body["0"]?.json ?? body.json);
        }
        const response = await route.fetch({ maxRedirects: 0 });
        const body = await response.json();
        const rows = Array.isArray(body) ? body : [body];
        for (const [index, procedure] of procedures.entries()) {
          const data = rows[index]?.result?.data?.json;
          if (procedure === "billing.payments.quote" && data) quotes.push(data);
          if (procedure === "billing.payments.get" && data) {
            assert.equal(
              data.catalogVersion,
              "2026-11",
              "Server is serving an outdated subscription contract",
            );
            assert.equal(
              data.available,
              false,
              "The isolated backend must keep real checkout disabled",
            );
            if (readinessFixture)
              Object.assign(data, {
                available: true,
                canPurchase: !data.pendingInvoice,
                mode: "sandbox",
                provider: "GOPAY",
                sellerName: "Synthetic local seller",
                termsUrl: base + "/legal/offer",
                termsVersion: "qa-commercial-browser",
              });
          }
        }
        await route.fulfill({ response, json: Array.isArray(body) ? rows : rows[0] });
      });
      const page: Page = await context.newPage(),
        errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await page.goto(base + "/billing", { waitUntil: "domcontentloaded" });
        const panel = page.locator("[data-subscription-payments]");
        await panel.getByText(t.manualAccess, { exact: true }).waitFor();
        assert.equal(await panel.locator('[data-subscription-addons] [data-addon]').count(), 2);
        assert.equal(await panel.locator("[data-checkout-form]").count(), 0);
        await db.organization.update({
          where: { id: fixture.org.id },
          data: { subscriptionBillingMode: "SELF_SERVE" },
        });
        const commercialBefore = await commercialFields(fixture.org.id);
        await page.reload({ waitUntil: "domcontentloaded" });
        await panel.getByText(t.unavailable, { exact: true }).waitFor();
        await panel.locator('[data-subscription-addons]').screenshot({ path: resolve(directory, `addons-unavailable-${locale}-${width}.png`) });
        assert.equal(await panel.locator("[data-checkout-form]").count(), 0);
        readinessFixture = true;
        await page.reload({ waitUntil: "domcontentloaded" });
        const form = panel.locator("[data-checkout-form]");
        await form.waitFor();
        await panel.getByText(interpolate(t.sandbox, { provider: "GoPay" }), { exact: true }).waitFor();
        await form.getByText(interpolate(t.description, { provider: "GoPay" }), { exact: true }).waitFor();
        const expected: Record<Plan, number[]> = {
          STARTER: [200000, 1140000, 2040000],
          BUSINESS: [350000, 1995000, 3570000],
          ENTERPRISE: [550000, 3135000, 5610000],
        };
        for (const plan of ["STARTER", "BUSINESS", "ENTERPRISE"] as const) {
          await choose(
            page,
            "subscription-plan",
            messages[locale].billing.plans[plan.toLowerCase() as "starter"].name,
          );
          for (const [index, months] of [1, 6, 12].entries()) {
            await choose(page, "subscription-months", t[`term${months}` as "term1"]);
            const total = interpolate(t.total, {
              amount: await uiMoney(page, expected[plan][index] / 100, locale),
            });
            await form
              .locator("[data-subscription-quote]")
              .getByText(total, { exact: true })
              .waitFor();
            assert(
              quotes.some(
                (quote) =>
                  quote.plan === plan &&
                  quote.months === months &&
                  quote.amountMinor === expected[plan][index],
              ),
              "Missing real server quote",
            );
          }
          if (plan === "STARTER")
            assert.equal(await page.locator("#subscription-extra-stores").count(), 0);
          else {
            await page.locator("#subscription-extra-stores").click();
            assert.equal(await page.getByRole("option").count(), plan === "BUSINESS" ? 5 : 15);
            await page.keyboard.press("Escape");
          }
        }
        // Buying many stores on Starter must not be possible through a plan switch.
        await choose(
          page,
          "subscription-extra-stores",
          interpolate(t.extraStoreCount, { count: 14 }),
        );
        await choose(page, "subscription-plan", messages[locale].billing.plans.starter.name);
        await form
          .locator("[data-subscription-quote]")
          .getByText(interpolate(t.total, { amount: await uiMoney(page, 20400, locale) }), {
            exact: true,
          })
          .waitFor();
        assert.equal(await page.locator("#subscription-extra-stores").count(), 0);
        await choose(page, "subscription-plan", messages[locale].billing.plans.business.name);
        await choose(
          page,
          "subscription-extra-stores",
          interpolate(t.extraStoreCount, { count: 1 }),
        );
        await form.getByRole("checkbox").check();
        const expectedMinor = 5100000; // (3500 +1000 store +500 reserve) ×12 ×85%, in minor KGS.
        await form
          .locator("[data-subscription-quote]")
          .getByText(
            interpolate(t.total, { amount: await uiMoney(page, expectedMinor / 100, locale) }),
            { exact: true },
          )
          .waitFor();
        await overflow(page);
        await panel.screenshot({ path: resolve(directory, `quote-${locale}-${width}.png`) });
        const pay = form.getByRole("button", {
          name: interpolate(t.pay, { amount: await uiMoney(page, expectedMinor / 100, locale) }),
          exact: true,
        });
        await pay.click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor();
        await dialog.getByText(interpolate(t.sandbox, { provider: "GoPay" }), { exact: true }).waitFor();
        await dialog.getByText(t.testPaymentPolicy, { exact: true }).waitFor();
        await dialog
          .getByText(interpolate(t.extrasSummary, { stores: 1, products: 1000, users: 2 }), {
            exact: true,
          })
          .waitFor();
        const submit = dialog.getByRole("button", { name: t.goToPayment, exact: true });
        assert.equal(await submit.isDisabled(), true);
        await dialog.locator("#subscription-terms").check();
        await submit.click();
        await dialog
          .getByRole("alert")
          .getByText(messages[locale].errors.billingPaymentsUnavailable, { exact: true })
          .waitFor();
        const retry = page.waitForResponse((response) =>
          response.url().includes("billing.payments.checkout"),
        );
        await submit.click();
        await retry;
        assert.equal(requests.length, 2);
        assert.equal(requests[0].idempotencyKey, requests[1].idempotencyKey);
        assert.equal(requests[0].quoteToken, requests[1].quoteToken);
        assert.equal(requests[0].expectedAmountMinor, expectedMinor);
        assert.equal(requests[0].expectedProvider, "GOPAY");
        assert.equal(requests[1].expectedProvider, "GOPAY");
        assert.deepEqual(requests[0].extras, { stores: 1, productPacks: 1, userPacks: 0 });
        assert.equal(
          await db.subscriptionInvoice.count({ where: { organizationId: fixture.org.id } }),
          0,
        );
        assert.equal(
          await commercialFields(fixture.org.id),
          commercialBefore,
          "Disabled checkout changed agreed commercial fields",
        );
        await overflow(page);
        assert.deepEqual(errors, []);
        await dialog.screenshot({ path: resolve(directory, `retry-${locale}-${width}.png`) });
        checks.push({
          scenario: "commercial",
          locale,
          width,
          realQuotes: 9,
          disabledBackend: true,
          readinessFixture: true,
          selectedProvider: "GOPAY",
          explicitTestDisclosure: true,
          expectedProviderConsent: true,
          twoExtras: true,
          starterCannotBuyStores: true,
          confirmationAndRetry: true,
          invoiceCount: 0,
          errors,
        });

        // These are isolated display fixtures, not provider-confirmed payments
        // and they intentionally create no paid subscription periods.
        await dialog.getByRole("button", { name: messages[locale].common.cancel, exact: true }).click();
        const displayPurchase = quotes.find((entry) => entry.plan === "STARTER" && entry.months === 1);
        assert(displayPurchase, "A real server quote is required for the display purchase snapshot");
        const createDisplayInvoice = (input: {
          provider: "GOPAY" | "FREEDOMPAY";
          isTest: boolean;
          status: "PAID" | "FAILED" | "PENDING" | "REVIEW";
          pendingSlot?: string;
          lastIssue?: string;
        }) => db.subscriptionInvoice.create({
          data: {
            ...input,
            providerOrderId: input.provider === "GOPAY" ? randomUUID().replaceAll("-", "") : null,
            organizationId: fixture.org.id,
            createdById: fixture.user.id,
            idempotencyKey: randomUUID(),
            plan: "STARTER",
            amountMinor: 200000,
            purchaseSnapshot: JSON.parse(JSON.stringify(displayPurchase)),
            merchantId: "synthetic-browser-only",
            sellerName: "Synthetic browser seller",
            termsVersion: "synthetic-display-only",
            termsUrl: base + "/legal/offer",
            checkoutUrl: input.status === "PENDING" ? "https://example.invalid/synthetic-checkout" : null,
            expiresAt: new Date(Date.now() + 86400_000),
            paidAt: input.status === "PAID" ? new Date() : null,
            // All credentials/providers stay disabled; checking renders a stored
            // delayed result without initiating an external request.
            nextCheckAt: new Date(Date.now() + 3600_000),
          },
        });
        const legacyPaid = await createDisplayInvoice({ provider: "FREEDOMPAY", isTest: false, status: "PAID" });
        const testPaid = await createDisplayInvoice({ provider: "GOPAY", isTest: true, status: "PAID" });
        const testFailed = await createDisplayInvoice({ provider: "GOPAY", isTest: true, status: "FAILED" });
        const legacyPending = await createDisplayInvoice({
          provider: "FREEDOMPAY", isTest: false, status: "PENDING", pendingSlot: fixture.org.id,
          lastIssue: "RECONCILIATION_REQUIRED",
        });
        await page.reload({ waitUntil: "domcontentloaded" });
        const pendingPanel = panel.locator("[data-pending-invoice]");
        await pendingPanel.getByText(interpolate(t.providerDescription, { provider: "FreedomPay" }), { exact: true }).waitFor();
        assert.equal(await form.count(), 0);
        assert.equal(await pendingPanel.getByRole("link", { name: t.continue, exact: true }).getAttribute("href"), "https://example.invalid/synthetic-checkout");
        await pendingPanel.getByRole("button", { name: t.check, exact: true }).click();
        await panel.getByText(t.checkDelayed, { exact: true }).waitFor();
        for (const [invoice, provider, status] of [
          [legacyPaid, "FreedomPay", t.statuses.PAID],
          [testPaid, "GoPay", t.testPaid],
          [testFailed, "GoPay", t.statuses.FAILED],
        ] as const) {
          const row = panel.locator(`[data-subscription-invoice="${invoice.id}"]`);
          await row.locator("summary").click();
          await row.getByText(provider, { exact: true }).waitFor();
          await row.locator("summary").getByText(status, { exact: true }).waitFor();
          assert.equal(await row.getByText(t.testInvoice, { exact: true }).count(), Number(invoice.isTest));
        }
        await overflow(page);
        await panel.screenshot({ path: resolve(directory, `history-and-pending-${locale}-${width}.png`) });
        assert.equal((await db.subscriptionInvoice.findUniqueOrThrow({ where: { id: legacyPending.id } })).status, "PENDING");
        const review = await createDisplayInvoice({ provider: "GOPAY", isTest: true, status: "REVIEW" });
        await page.reload({ waitUntil: "domcontentloaded" });
        await pendingPanel.getByText(interpolate(t.providerDescription, { provider: "GoPay" }), { exact: true }).waitFor();
        await pendingPanel.getByText(t.testInvoice, { exact: true }).waitFor();
        await pendingPanel.getByText(t.reviewHint, { exact: true }).waitFor();
        assert.equal(await pendingPanel.getByRole("link", { name: t.continue, exact: true }).count(), 0);
        assert.equal(await pendingPanel.getByRole("link", { name: t.support, exact: true }).count(), 1);
        assert.equal((await db.subscriptionInvoice.findUniqueOrThrow({ where: { id: review.id } })).status, "REVIEW");
        assert.equal(await db.subscriptionPeriod.count({ where: { organizationId: fixture.org.id } }), 0);
        assert.equal(await commercialFields(fixture.org.id), commercialBefore, "Invoice rendering changed agreed access");
        await overflow(page);
        await pendingPanel.screenshot({ path: resolve(directory, `gopay-test-review-${locale}-${width}.png`) });
        assert.deepEqual(errors, []);
        checks.push({ scenario: "synthetic-invoice-rendering", locale, width,
          historicalFreedomPay: true, historicalPendingContinuation: true, testPaidNotLive: true,
          failedTestVisible: true, delayedStatusRecovery: true, reviewSupport: true,
          createdSubscriptionPeriods: 0, accessUnchanged: true, externalRequests: false, errors });
      } finally {
        await context.close();
      }
    }

  // WhatsApp pack purchases share the same provider labels and Test boundary.
  for (const locale of ["ru", "kg", "en"] as const)
    for (const width of [390, 1440]) {
      const fixture = await seed("BUSINESS"), t = messages[locale].whatsappAi,
        billingText = messages[locale].billing.payments;
      const before = await commercialFields(fixture.org.id);
      await db.whatsAppInvoice.createMany({ data: [
        { provider: "GOPAY" as const, isTest: true, status: "PAID" },
        { provider: "FREEDOMPAY" as const, isTest: false, status: "PENDING" },
      ].map((row) => ({
        ...row, id: `wa_${randomUUID().replaceAll("-", "")}`, organizationId: fixture.org.id,
        providerOrderId: row.provider === "GOPAY" ? randomUUID().replaceAll("-", "") : null,
        createdById: fixture.user.id, idempotencyKey: randomUUID(), quantity: 1,
        amountMinor: WHATSAPP_PACK_PRICE_MINOR, offerVersion: WHATSAPP_OFFER_VERSION,
        merchantId: "synthetic-browser-only", termsVersion: "synthetic-display-only",
        termsUrl: base + "/legal/offer", expiresAt: new Date(Date.now() + 86400_000),
        checkoutUrl: row.status === "PENDING" ? "https://example.invalid/synthetic-wa-checkout" : null,
        paidAt: row.status === "PAID" ? new Date() : null,
        nextCheckAt: new Date(Date.now() + 3600_000),
      })) });
      const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
      await authenticate(context, fixture, locale);
      let readinessFixture = false;
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        return url.origin === base || ["data:", "blob:"].includes(url.protocol) ? route.continue() : route.abort();
      });
      await context.route("**/api/trpc/**", async (route) => {
        const response = await route.fetch({ maxRedirects: 0 }), body = await response.json();
        const procedures = new URL(route.request().url()).pathname.split("/").at(-1)!.split(",");
        const rows = Array.isArray(body) ? body : [body];
        for (const [index, procedure] of procedures.entries()) {
          const data = rows[index]?.result?.data?.json;
          if (procedure === "whatsappAi.payments" && data) {
            assert.equal(data.ready, false, "Real pack checkout must remain disabled");
            if (readinessFixture) Object.assign(data, { ready: true, mode: "sandbox", provider: "GOPAY" });
          }
        }
        await route.fulfill({ response, json: Array.isArray(body) ? rows : rows[0] });
      });
      const page = await context.newPage(), errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await page.goto(base + "/operations/integrations/whatsapp-ai", { waitUntil: "domcontentloaded" });
        await page.getByRole("tab", { name: t.tabs.costs, exact: true }).click();
        const panel = page.locator("#wa-panel-costs");
        await panel.getByText(t.paymentsUnavailable, { exact: true }).waitFor();
        assert.equal(await panel.getByRole("button", { name: interpolate(t.pay, { price: await uiMoney(page, WHATSAPP_PACK_PRICE_MINOR / 100, locale) }), exact: true }).isDisabled(), true);
        await panel.screenshot({ path: resolve(directory, `whatsapp-disabled-${locale}-${width}.png`) });
        readinessFixture = true;
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.getByRole("tab", { name: t.tabs.costs, exact: true }).click();
        await panel.getByText(interpolate(billingText.sandbox, { provider: "GoPay" }), { exact: true }).waitFor();
        await panel.getByText(interpolate(t.paymentHelp, { provider: "GoPay" }), { exact: true }).waitFor();
        await panel.getByText(interpolate(billingText.providerDescription, { provider: "FreedomPay" }), { exact: true }).waitFor();
        await panel.getByText(billingText.testInvoice, { exact: true }).waitFor();
        await panel.getByText(billingText.testPaid, { exact: false }).waitFor();
        assert.equal(await panel.getByRole("link", { name: t.continuePayment, exact: true }).getAttribute("href"), "https://example.invalid/synthetic-wa-checkout");
        assert.equal(await db.whatsAppCreditLot.count({ where: { organizationId: fixture.org.id } }), 0, "Display fixtures must never grant message credits");
        assert.equal(await commercialFields(fixture.org.id), before);
        await overflow(page);
        assert.deepEqual(errors, []);
        await panel.screenshot({ path: resolve(directory, `whatsapp-gopay-test-${locale}-${width}.png`) });
        checks.push({ scenario: "whatsapp-pack-rendering", locale, width, disabledBackend: true,
          explicitGoPayTest: true, historicalFreedomPay: true, readinessFixture: true,
          createdCredits: 0, accessUnchanged: true, externalRequests: false, errors });
      } finally { await context.close(); }
    }

  // Old contracts and all five protected identifiers use actual read models.
  const legacy = await seed("BUSINESS", "2026-10");
  const protectedFixtures: Array<[string, Fixture, boolean]> = [["legacy-business", legacy, false]];
  for (const [id, name, plan] of names)
    protectedFixtures.push([name, await seed(plan, "2026-10", id), true]);
  for (const [name, fixture, lifetime] of protectedFixtures)
    for (const width of [390, 1440]) {
      const before = await commercialFields(fixture.org.id);
      const context: BrowserContext = await browser.newContext({
        viewport: { width, height: 1000 },
        reducedMotion: "reduce",
        serviceWorkers: "block",
      });
      await authenticate(context, fixture, "ru");
      await context.route("**/*", (route) =>
        new URL(route.request().url()).origin === base ? route.continue() : route.abort(),
      );
      const page: Page = await context.newPage(),
        errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        const billingResponse: Promise<BrowserResponse> = page.waitForResponse((response) =>
          new URL(response.url()).pathname.split("/").at(-1)!.split(",").includes("billing.get"),
        );
        await page.goto(base + "/billing", { waitUntil: "domcontentloaded" });
        const actualBillingResponse: BrowserResponse = await billingResponse;
        const procedures: string[] = new URL(actualBillingResponse.url()).pathname
          .split("/")
          .at(-1)!
          .split(",");
        const raw: BillingWire | BillingWire[] = await actualBillingResponse.json();
        const summary: BillingSummary = (Array.isArray(raw) ? raw : [raw])[
          procedures.indexOf("billing.get")
        ].result.data.json;
        assert.equal(summary.billingCatalogVersion, "2026-10");
        assert.equal(summary.planTier, fixture.org.plan, "Protected current plan changed");
        assert.equal(summary.lifetimeAccess, lifetime);
        assert.equal(summary.hasAccess, true);
        assert.equal(summary.monthlyPriceKgs, lifetime ? 0 : 4375);
        assert.equal(summary.usageLimits.ai, null, "New AI quotas applied to an old agreement");
        assert.deepEqual(
          summary.planCatalog.map((plan: { monthlyPriceKgs: number }) => plan.monthlyPriceKgs),
          [1750, 4375, 8750],
        );
        const panel = page.locator("[data-subscription-payments]");
        await panel
          .getByText(ru.billing.payments[lifetime ? "lifetimeAccess" : "manualAccess"], {
            exact: true,
          })
          .waitFor();
        assert.equal(await panel.locator("[data-checkout-form]").count(), 0);
        assert.equal(await page.locator("#subscription-plan").count(), 0);
        await overflow(page);
        await panel.screenshot({
          path: resolve(directory, `${name.replaceAll(".", "-")}-${width}.png`),
        });
        await page.goto(base + "/dashboard", { waitUntil: "domcontentloaded" });
        await page.locator("main").waitFor();
        assert(!page.url().includes("/login"));
        assert.equal(
          await commercialFields(fixture.org.id),
          before,
          "Viewing changed agreed commercial fields",
        );
        assert.deepEqual(errors, []);
        checks.push({
          scenario: lifetime ? "protected-lifetime" : "legacy",
          name,
          width,
          syntheticProtectedIdentifier: lifetime,
          expiredDates: lifetime,
          noCheckout: true,
          termsUnchanged: true,
          errors,
        });
      } finally {
        await context.close();
      }
    }

  // Public promises are reviewed in the same actual bundle, at both viewports.
  for (const locale of ["ru", "kg", "en"] as const)
    for (const width of [390, 1440]) {
      const context: BrowserContext = await browser.newContext({
        viewport: { width, height: 1000 },
        reducedMotion: "reduce",
        serviceWorkers: "block",
      });
      await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: base }]);
      await context.route("**/*", (route) =>
        new URL(route.request().url()).origin === base ? route.continue() : route.abort(),
      );
      const page: Page = await context.newPage();
      try {
        await page.goto(base + "/", { waitUntil: "domcontentloaded" });
        const pricing = page.locator("#pricing");
        await pricing.waitFor();
        await pricing.scrollIntoViewIfNeeded();
        assert.equal(await pricing.locator("[data-plan]").count(), 3);
        for (const [plan, amount] of [
          ["STARTER", 2000],
          ["BUSINESS", 3500],
          ["ENTERPRISE", 5500],
        ] as const)
          assert(
            (await pricing.locator(`[data-plan=${plan}]`).textContent())?.includes(
              new Intl.NumberFormat(locale === "kg" ? "ky-KG" : locale).format(amount),
            ),
          );
        await pricing.locator("summary").click();
        assert.equal(
          await pricing.locator('[data-feature="marketplaces"] [data-included="true"]').count(),
          1,
        );
        await overflow(page);
        await pricing.screenshot({
          path: resolve(directory, `public-pricing-${locale}-${width}.png`),
        });
        for (const id of ["offer", "refunds", "seller", "payment"])
          assert.equal(
            (await context.request.get(base + `/legal/${id}`, { maxRedirects: 0 })).status(),
            404,
            "Unapproved legal routes must stay closed in the preview production bundle",
          );
        checks.push({
          scenario: "public-pricing",
          locale,
          width,
          canonicalMonthlyPrices: true,
          liveChannelOnlyEnterprise: true,
          legalClosed: true,
        });
      } finally {
        await context.close();
      }
    }
  }
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
  throw error;
} finally {
  await writeFile(
    resolve(directory, reviewOnly ? "review-only-checks.json" : "checks.json"),
    JSON.stringify(
      {
        status: failures.length ? "failed" : "passed",
        base,
        database: "explicit local disposable55971",
        providerTests: false,
        disclosure:
          "GoPay readiness is a browser read-model fixture only. Invoice rows are explicitly synthetic local display fixtures and create no subscription periods. Quotes, history and disabled checkout are real local server calls. Providers stay disabled. Protected IDs refer only to synthetic local rows, not customer production data.",
        checks,
        failures,
      },
      null,
      2,
    ) + "\n",
  );
  await browser?.close();
  await db.$disconnect();
}
