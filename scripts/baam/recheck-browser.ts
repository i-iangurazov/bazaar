import assert from "node:assert/strict";
import { chromium, type BrowserContext } from "playwright";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
const base =
  process.env.BAAM_TEST_HTTPS === "1" ? "https://localhost:3121" : "http://localhost:3121";
assert.equal(
  process.env.BAAM_LIVE_PROVIDER,
  "1",
  "Only run this opt-in browser check against the owned local fixture",
);
const fixture = JSON.parse(await readFile("artifacts/baam-companion/fixture.json", "utf8"));
const dir = "artifacts/baam-companion/recheck";
await mkdir(dir, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  ignoreHTTPSErrors: process.env.BAAM_TEST_HTTPS === "1",
});
await context.addCookies([{ name: "NEXT_LOCALE", value: "ru", url: base }]);
const { csrfToken } = await (await context.request.get(`${base}/api/auth/csrf`)).json();
await context.request.post(`${base}/api/auth/callback/credentials`, {
  form: {
    csrfToken,
    email: "admin@test.local",
    password: "BaamCompanion123!",
    json: "true",
    callbackUrl: `${base}/baam`,
  },
});
async function api(
  route: string,
  input: unknown = null,
  mutation = false,
  session: BrowserContext = context,
) {
  const response = mutation
    ? await session.request.post(`${base}/api/trpc/${route}`, { data: { json: input } })
    : await session.request.get(
        `${base}/api/trpc/${route}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`,
      );
  const body = await response.json();
  assert(!body.error, JSON.stringify(body.error));
  return body.result.data.json;
}
assert.equal((await api("baam.companion")).organizationId, fixture.organizationId);
const results: Array<Record<string, unknown>> = [],
  errors: string[] = [];
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
async function run(name: string, fn: () => Promise<unknown>) {
  if (only && !only.split(",").includes(name)) return;
  const started = performance.now();
  try {
    results.push({
      name,
      pass: true,
      ms: Math.round(performance.now() - started),
      detail: await fn(),
    });
  } catch (e) {
    results.push({ name, pass: false, error: e instanceof Error ? e.message : String(e) });
    await page.screenshot({ path: `${dir}/failure-${name}.png` });
  }
  results.at(-1)!.ms = Math.round(performance.now() - started);
  console.log(JSON.stringify(results.at(-1)));
  await writeFile(
    `${dir}/browser${only ? `-${only}` : ""}.json`,
    JSON.stringify({ results, errors }, null, 2),
  );
}
try {
  await page.goto(base + "/baam");
  await page.locator("[data-baam-input]").waitFor({ timeout: 120000 });
  await page.getByRole("button", { name: "Записать голосовое сообщение", exact: true }).waitFor();
  await run("baam-ready-and-secure-localhost", async () => {
    assert(
      await page.evaluate(
        () =>
          window.isSecureContext &&
          Boolean(navigator.mediaDevices?.getUserMedia) &&
          typeof MediaRecorder !== "undefined",
      ),
    );
    await page.getByText("Готов к вопросам и задачам", { exact: true }).waitFor();
    assert(
      await page
        .getByRole("button", { name: "Записать голосовое сообщение", exact: true })
        .isEnabled(),
    );
    return { microphoneSupported: true, configured: true };
  });
  async function ask(text: string) {
    const count = await page.locator("[data-baam-entry]").count();
    await page.locator("[data-baam-input]").fill(text);
    await page.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
    await page.waitForFunction(
      (n) => document.querySelectorAll("[data-baam-entry]").length >= n + 2,
      count,
      { timeout: 90000 },
    );
    await page
      .getByRole("button", { name: "Записать голосовое сообщение", exact: true })
      .waitFor({ state: "visible" });
    return page.locator("[data-baam-entry]").last();
  }
  await run("render-metrics-and-actual-product-link", async () => {
    await ask("Покажи продажи за 22 октября 2026 года");
    await page.locator("[data-baam-metrics]").waitFor({ timeout: 90000 });
    await page.screenshot({ path: `${dir}/desktop-metrics.png` });
    await ask("Покажи топ семь товаров по количеству за октябрь");
    const records = page.locator("[data-baam-entry]").last().locator("[data-baam-record]");
    await records.first().waitFor({ timeout: 90000 });
    assert.equal(await records.count(), 7);
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `${dir}/mobile-ranking.png` });
    const link = records.first().getByRole("link");
    const href = await link.getAttribute("href");
    assert(href?.startsWith("/products/"));
    await link.click();
    await page.waitForURL(`${base}${href}`);
    await page.locator('input[name="name"]').waitFor({ timeout: 60000 });
    assert.equal(await page.locator('input[name="name"]').inputValue(), "AI QA Tea 8");
    return { records: 7, href, mobileOverflow: false };
  });
  await run("baam-followup-table-short-and-scope", async () => {
    await page.goto(base + "/baam");
    await page.getByRole("button", { name: "Новый диалог", exact: true }).click();
    await ask("Покажи топ-7 товаров за этот месяц");
    const tableAnswer = await ask("Теперь покажи это таблицей со ссылками на товары");
    const table = tableAnswer.getByRole("table");
    await table.waitFor({ timeout: 90000 });
    assert.equal(await table.getByRole("row").count(), 8);
    assert.equal(await table.locator('a[href^="/products/"]').count(), 7);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await table.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${dir}/desktop-conversation-table.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `${dir}/mobile-conversation-table.png` });
    const short = await ask("Объясни этот результат коротко, двумя предложениями");
    assert((await short.innerText()).split(/\s+/).length < 180);
    const overview = await ask("А что вообще происходит в магазине, на что обратить внимание?");
    assert.match(await overview.innerText(), /продаж|выруч/i);
    const sale = await ask("А теперь покажи последнюю завершённую продажу в кассе");
    assert.equal(await sale.locator("[data-baam-record]").count(), 1);
    assert.match(await sale.innerText(), /S-000001/);
    assert.doesNotMatch(await sale.innerText(), /S-000007/);
    return {
      tableRows: 7,
      clickableProducts: 7,
      mobileOverflow: false,
      topicSwitch: true,
      latestCompletedSale: true,
    };
  });
  await run("baam-receiving-document-link", async () => {
    await page.goto(base + "/baam");
    const answer = await ask(
      "Покажи последнее оприходование, со всеми позициями и ссылкой на документ",
    );
    const link = answer.locator('a[href^="/inventory/movements/"]').first();
    await link.waitFor({ timeout: 90000 });
    const href = await link.getAttribute("href");
    assert(href?.includes("%3A"));
    await link.click();
    await page.waitForURL(`${base}${href}`);
    const product = page.getByRole("link", { name: "Test Product", exact: true }).first();
    await product.waitFor({ timeout: 60000 });
    await product.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${dir}/mobile-baam-receiving-document.png` });
    return { href, openedActualDocument: true };
  });
  await run("baam-heic-photo-to-real-vision", async () => {
    await page.goto(base + "/baam");
    await page.locator("[data-baam-input]").waitFor();
    await page.getByRole("button", { name: "Новый диалог", exact: true }).click();
    await page
      .getByRole("button", { name: "Добавить фотографию", exact: true })
      .click({ trial: true });
    const upload = page.waitForResponse(
      (r) => r.url().endsWith("/api/baam/media") && r.request().method() === "POST",
    );
    await page
      .locator('[data-baam-chat] input[type="file"]')
      .setInputFiles("tests/fixtures/images/studio.heic");
    const response = await upload;
    const attachment = await response.json();
    assert.equal(response.status(), 200, JSON.stringify(attachment));
    assert.equal(attachment.mimeType, "image/jpeg");
    await page.getByRole("button", { name: "Убрать фотографию", exact: true }).waitFor();
    const answer = await ask(
      "Что изображено на фотографии? Прочитай видимую надпись. Ничего не создавай.",
    );
    await page.waitForFunction(
      () =>
        /bazaar\s*qa/i.test(
          document.querySelector("[data-baam-entry]:last-child")?.textContent ?? "",
        ),
      undefined,
      { timeout: 90000 },
    );
    assert.equal(await page.locator("[data-baam-workflow]").count(), 0);
    await page.screenshot({ path: `${dir}/mobile-heic-vision.png` });
    return { normalized: attachment.mimeType, answer: await answer.innerText(), noMutation: true };
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base + "/operations/integrations/product-image-studio");
  const input = page.locator('input[type="file"]');
  await input.waitFor({ state: "attached", timeout: 120000 });
  for (const format of ["jpeg", "png", "webp", "avif", "gif", "tiff"] as const) {
    await sharp({ create: { width: 600, height: 700, channels: 3, background: "blue" } })
      .toFormat(format)
      .toFile(`${dir}/source.${format}`);
  }
  await copyFile("tests/fixtures/images/studio.heic", `${dir}/source.heic`);
  await copyFile("tests/fixtures/images/studio.heic", `${dir}/source.heif`);
  const stride = Math.ceil((600 * 3) / 4) * 4,
    bmp = Buffer.alloc(54 + stride * 700);
  bmp.write("BM");
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(600, 18);
  bmp.writeInt32LE(700, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.fill(180, 54);
  await writeFile(`${dir}/source.bmp`, bmp);
  for (const format of ["jpeg", "png", "webp", "avif", "gif", "tiff", "bmp", "heic", "heif"]) {
    await run(`studio-upload-${format}`, async () => {
      await page
        .getByRole("button", { name: "Загрузить фото товара", exact: false })
        .click({ trial: true, timeout: 60000 });
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/product-image-studio/upload") && r.request().method() === "POST",
        { timeout: 90000 },
      );
      await input.setInputFiles(`${dir}/source.${format}`);
      const r = await response,
        body = await r.json();
      assert.equal(r.status(), 200, JSON.stringify(body));
      assert(body.url.startsWith(`/uploads/imported-products/${fixture.organizationId}/`));
      assert.match(body.mimeType, /^image\/(?:jpeg|png|webp)$/);
      const served = await context.request.get(base + body.url);
      assert.equal(
        served.status(),
        200,
        "Newly uploaded images must be accessible before a server restart",
      );
      assert((await sharp(await served.body()).metadata()).width! > 0);
      return { type: body.mimeType, url: body.url };
    });
  }
  await run("studio-upload-invalid-file", async () => {
    const response = await context.request.post(`${base}/api/product-image-studio/upload`, {
      multipart: {
        file: { name: "invalid.HEIC", mimeType: "image/heic", buffer: Buffer.from("not an image") },
      },
    });
    assert.equal(response.status(), 400);
    return await response.json();
  });
  await run("studio-upload-unauthenticated", async () => {
    const anonymous = await browser.newContext({
      ignoreHTTPSErrors: process.env.BAAM_TEST_HTTPS === "1",
    });
    const response = await anonymous.request.post(`${base}/api/product-image-studio/upload`, {
      multipart: {
        file: {
          name: "photo.png",
          mimeType: "image/png",
          buffer: await readFile(`${dir}/source.png`),
        },
      },
    });
    assert.equal(response.status(), 401);
    await anonymous.close();
    return { status: 401 };
  });
  await run("runtime-new-upload-decodes-without-restart", async () => {
    const buffer = await sharp(randomBytes(30 * 30 * 3), {
      raw: { width: 30, height: 30, channels: 3 },
    })
      .png()
      .toBuffer();
    const uploaded = await context.request.post(`${base}/api/product-image-studio/upload`, {
      multipart: { file: { name: "new-after-server-start.png", mimeType: "image/png", buffer } },
    });
    assert.equal(uploaded.status(), 200);
    const { url } = await uploaded.json();
    const served = await context.request.get(base + url);
    assert.equal(served.status(), 200);
    assert.equal((await sharp(await served.body()).metadata()).width, 30);
    return { uniqueFileCreatedAfterBoot: true, immediatelyServedAndDecoded: true };
  });
  await run("studio-generate-preview-and-save", async () => {
    const before = await api("products.getById", { productId: fixture.productId });
    await page.getByLabel("Товар для привязки").fill("TEST-1");
    await page.getByRole("button", { name: /Test Product/ }).click();
    assert.equal(
      await page
        .getByRole("switch", { name: "Максимум деталей", exact: true })
        .getAttribute("aria-checked"),
      "false",
    );
    const generated = page.waitForResponse(
      (r) =>
        r.url().includes("/api/trpc/productImageStudio.create") && r.request().method() === "POST",
      { timeout: 90000 },
    );
    const started = performance.now();
    await page.getByRole("button", { name: "Сгенерировать изображение", exact: true }).click();
    const data = await (await generated).json();
    const created = (Array.isArray(data) ? data[0] : data).result.data.json;
    let job = await api("productImageStudio.job", { jobId: created.jobId });
    assert.equal(job.highQuality, false);
    await page.screenshot({ path: `${dir}/studio-processing.png` });
    while (["QUEUED", "PROCESSING"].includes(job.status) && performance.now() - started < 150000) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      job = await api("productImageStudio.job", { jobId: created.jobId });
    }
    assert.equal(job.status, "SUCCEEDED", JSON.stringify(job.errorMessage));
    await page
      .getByAltText("Сгенерированное каталожное изображение товара")
      .waitFor({ timeout: 15000 });
    await page.waitForFunction(
      () => {
        const image = document.querySelector(
          'img[alt="Сгенерированное каталожное изображение товара"]',
        ) as HTMLImageElement | null;
        return image?.complete && image.naturalWidth > 0;
      },
      undefined,
      { timeout: 15000 },
    );
    await page.screenshot({ path: `${dir}/studio-preview.png` });
    const save = () =>
      Promise.all([
        page.waitForResponse(
          (r) =>
            r.url().includes("/api/trpc/productImageStudio.saveToProduct") &&
            r.request().method() === "POST",
        ),
        page.getByRole("button", { name: "Сохранить в товар", exact: true }).click(),
      ]);
    await save();
    await page
      .getByRole("switch", { name: "Сделать основным изображением товара", exact: true })
      .check();
    await save();
    const after = await api("products.getById", { productId: fixture.productId });
    assert.equal(after.photoUrl, job.outputImageUrl);
    assert.equal(
      after.images.filter((image: { url: string }) => image.url === job.outputImageUrl).length,
      1,
    );
    for (const image of before.images)
      assert(after.images.some((value: { url: string }) => value.url === image.url));
    return {
      jobId: job.id,
      ms: Math.round(performance.now() - started),
      model: job.providerRequestJson?.tool?.model,
      quality: job.providerRequestJson?.tool?.quality,
      savedExactlyOnce: true,
      originalGalleryPreserved: true,
      outputImageUrl: job.outputImageUrl,
    };
  });
  await run("studio-completed-list-cannot-freeze-preview", async () => {
    let injected = false,
      refreshed = false;
    await page.route("**/api/trpc/productImageStudio.job?**", async (route) => {
      const response = await route.fetch();
      if (injected) {
        refreshed = true;
        return route.fulfill({ response });
      }
      const body = await response.json();
      const detail = (Array.isArray(body) ? body[0] : body).result?.data?.json;
      assert.equal(detail.status, "SUCCEEDED");
      detail.status = "PROCESSING";
      detail.outputImageUrl = null;
      detail.completedAt = null;
      injected = true;
      return route.fulfill({ response, json: body });
    });
    await page.reload();
    await page
      .getByAltText("Сгенерированное каталожное изображение товара")
      .waitFor({ timeout: 30000 });
    await page.waitForFunction(
      () => {
        const image = document.querySelector(
          'img[alt="Сгенерированное каталожное изображение товара"]',
        ) as HTMLImageElement | null;
        return image?.complete && image.naturalWidth > 0;
      },
      undefined,
      { timeout: 15000 },
    );
    assert(
      injected && refreshed,
      "Stale details must refetch even when the list already shows completion",
    );
    await page.unroute("**/api/trpc/productImageStudio.job?**");
    return { staleProcessingInjected: true, completedDetailsRefetched: true };
  });
  await page.screenshot({ path: `${dir}/desktop-studio.png` });
  assert.deepEqual(errors, []);
  assert(results.length > 0, "The requested browser case must exist");
  if (results.some((r) => !r.pass)) process.exitCode = 1;
} finally {
  await browser.close();
}
