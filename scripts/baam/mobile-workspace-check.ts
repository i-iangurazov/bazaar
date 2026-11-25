import assert from "node:assert/strict";
import type { Page } from "playwright";

const workspaceUrl = (url: URL) => `${url.pathname}${url.search}${url.hash}`;

export async function openMobileBaam(page: Page) {
  const launcher = page.locator("[data-baam-launcher]");
  await launcher.waitFor();
  const source = new URL(page.url());
  const returnTo = workspaceUrl(source);
  await launcher.click();
  await page.waitForURL(
    (url) => url.pathname === "/baam" && url.searchParams.get("returnTo") === returnTo,
    { timeout: 15_000 },
  );

  const storeId = source.searchParams.get("storeId");
  if (storeId) {
    assert.equal(new URL(page.url()).searchParams.get("storeId"), storeId);
  }
  const question = page.locator("[data-baam-workspace] [data-baam-input]");
  await question.waitFor();
  assert.equal(await page.locator("[data-baam-drawer]").count(), 0);

  await launcher.click();
  await page.waitForFunction(
    () => document.activeElement?.matches("[data-baam-workspace] [data-baam-input]") === true,
  );
  return { question, returnTo };
}

export async function returnFromMobileBaam(page: Page, returnTo: string, backLabel: string) {
  const workspace = page.locator("[data-baam-workspace]");
  const back = workspace.getByRole("link", { name: backLabel, exact: true });
  await back.waitFor();
  assert.equal(await back.getAttribute("href"), returnTo);
  await back.click();
  await page.waitForURL((url) => workspaceUrl(url) === returnTo);
  await workspace.waitFor({ state: "hidden" });
}
