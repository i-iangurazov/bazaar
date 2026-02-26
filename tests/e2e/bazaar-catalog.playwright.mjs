import { test, expect } from "@playwright/test";

const catalogUrl = process.env.PW_CATALOG_URL;
const orderNumberSelector = '[data-testid="sales-order-number"]';

test.describe("bazaar catalog public flow", () => {
  test.skip(!catalogUrl, "PW_CATALOG_URL is required");

  test("visitor submits order from public catalog", async ({ page }) => {
    await page.goto(catalogUrl, { waitUntil: "networkidle" });

    const searchValue = process.env.PW_CATALOG_SEARCH ?? "";
    if (searchValue) {
      await page.getByPlaceholder(/поиск|издөө/i).fill(searchValue);
    }

    await page.getByRole("button", { name: /\+/ }).first().click();
    await page.getByRole("button", { name: /корзина|себет/i }).click();
    await page.getByRole("button", { name: /оформить|заказ берүү/i }).click();

    await page
      .getByLabel(/имя|аты/i)
      .fill(process.env.PW_CATALOG_CUSTOMER_NAME ?? "Playwright Customer");
    await page
      .getByLabel(/телефон/i)
      .fill(process.env.PW_CATALOG_CUSTOMER_PHONE ?? "+996555000111");
    await page.getByRole("button", { name: /отправить|жөнөт/i }).click();

    await expect(page.getByText(/спасибо|рахмат/i)).toBeVisible();
  });

  test("admin can find catalog order in sales orders", async ({ page }) => {
    test.skip(!process.env.PW_APP_URL, "PW_APP_URL is required");
    test.skip(
      !process.env.PW_ADMIN_EMAIL || !process.env.PW_ADMIN_PASSWORD,
      "admin credentials are required",
    );

    await page.goto(`${process.env.PW_APP_URL}/login`, { waitUntil: "networkidle" });
    await page.getByLabel(/email/i).fill(process.env.PW_ADMIN_EMAIL);
    await page.getByLabel(/пароль|сырсөз|password/i).fill(process.env.PW_ADMIN_PASSWORD);
    await page.getByRole("button", { name: /войти|кирүү/i }).click();

    await page.goto(`${process.env.PW_APP_URL}/sales/orders`, { waitUntil: "networkidle" });
    await expect(page.getByText(/каталог/i)).toBeVisible();

    const expectedNumber = process.env.PW_EXPECT_ORDER_NUMBER;
    if (expectedNumber) {
      await expect(
        page.locator(orderNumberSelector).or(page.getByText(expectedNumber)),
      ).toBeVisible();
    }
  });
});
