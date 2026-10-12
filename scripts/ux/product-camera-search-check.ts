import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bwipjs from "bwip-js";
import sharp from "sharp";
import { chromium, type BrowserContext } from "playwright";
import { expect as baseExpect } from "playwright/test";

const expect = baseExpect.configure({ timeout: 60_000 });
type Api = (name: string, input: unknown, mutation?: boolean) => Promise<unknown>;
type CameraWindow = Window & { cameraStreams: MediaStream[]; denyCamera: boolean };

async function barcodeVideo(path: string, barcode: string) {
  const png = await bwipjs.toBuffer({
    bcid: "ean13",
    text: barcode,
    scale: 3,
    height: 24,
    includetext: true,
    padding: 12,
    backgroundcolor: "FFFFFF",
  });
  const { width, height } = await sharp(png).metadata();
  assert.ok(width && height && width < 640 && height < 480);
  const pixels = await sharp(png)
    .extend({
      left: Math.floor((640 - width) / 2),
      right: Math.ceil((640 - width) / 2),
      top: Math.floor((480 - height) / 2),
      bottom: Math.ceil((480 - height) / 2),
      background: "white",
    })
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer();
  assert.equal(pixels.length, 640 * 480);
  const luminance = Buffer.from(pixels.map((pixel) => Math.round(16 + (pixel * 219) / 255)));
  const frame = Buffer.concat([
    Buffer.from("FRAME\n"),
    luminance,
    Buffer.alloc((640 * 480) / 2, 128),
  ]);
  await writeFile(
    path,
    Buffer.concat([
      Buffer.from("YUV4MPEG2 W640 H480 F30:1 Ip A1:1 C420jpeg\n"),
      ...Array.from({ length: 30 }, () => frame),
    ]),
  );
}

/** Decode actual camera frames through ZXing, then use the normal catalog request. */
export async function verifyProductCameraSearch(
  admin: BrowserContext,
  base: string,
  fixture: { storeId: string },
  api: Api,
  output: string,
) {
  assert.equal(new URL(base).hostname, "localhost", "Camera fixtures require isolated localhost");
  await mkdir(output, { recursive: true });
  const temporary = await mkdtemp(join(tmpdir(), "bazaar-camera-search-"));
  const digits = `0${randomInt(10_000_000_000, 99_999_999_999)}`;
  const sum = [...digits].reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1),
    0,
  );
  const barcode = `${digits}${(10 - (sum % 10)) % 10}`;
  const video = join(temporary, "barcode.y4m");
  await barcodeVideo(video, barcode);
  const browser = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-video-capture=${video}`,
    ],
  });
  const stores = (await api("stores.list", undefined)) as Array<{
    id: string;
    enableBarcode: boolean;
    enableSku: boolean;
    enableSimilarProductCheck: boolean;
  }>;
  const store = stores.find((item) => item.id === fixture.storeId);
  assert.ok(store);
  const settings = {
    storeId: store.id,
    enableBarcode: store.enableBarcode,
    enableSku: store.enableSku,
    enableSimilarProductCheck: store.enableSimilarProductCheck,
  };
  const checks: string[] = [];
  try {
    await api("stores.updateProductSettings", { ...settings, enableBarcode: true }, true);
    const units = (await api("units.list", undefined)) as Array<{ id: string }>;
    const profile = (await api("orgSettings.getBusinessProfile", { storeId: store.id })) as {
      organization: { retailWholesaleEnabled: boolean };
    };
    const name = `Товар для камеры ${randomUUID().slice(0, 8)}`;
    await api(
      "products.create",
      {
        storeId: store.id,
        name,
        baseUnitId: units[0].id,
        idempotencyKey: randomUUID(),
        barcodes: [barcode],
        basePriceKgs: 100,
        ...(profile.organization.retailWholesaleEnabled
          ? { retailPriceKgs: 100, wholesalePriceKgs: 100 }
          : {}),
      },
      true,
    );
    for (const width of [1440, 768, 390]) {
      const context = await browser.newContext({
        storageState: await admin.storageState(),
        viewport: { width, height: width === 390 ? 844 : 1000 },
        hasTouch: true,
        ignoreHTTPSErrors: true,
        permissions: ["camera"],
        reducedMotion: "reduce",
      });
      try {
        await context.route("**/*", (route) =>
          new URL(route.request().url()).origin === base ? route.continue() : route.abort(),
        );
        await context.addInitScript(() => {
          const state = window as CameraWindow;
          state.cameraStreams = [];
          state.denyCamera = false;
          if (!navigator.mediaDevices?.getUserMedia) return;
          const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
          navigator.mediaDevices.getUserMedia = async (constraints) => {
            if (state.denyCamera) throw new DOMException("Denied", "NotAllowedError");
            const stream = await getUserMedia(constraints);
            state.cameraStreams.push(stream);
            return stream;
          };
        });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`${base}/products?storeId=${store.id}&list=1`);
        const search = page.locator("#products-search");
        const field = search.locator("..");
        const camera = field.getByRole("button", { name: "Сканировать камерой", exact: true });
        await expect(camera).toBeEnabled();
        await search.fill("Нет такого товара для камеры");
        if (width === 1440) await camera.click();
        else await camera.tap();
        await expect(search).toHaveValue(barcode);
        await expect(
          page.getByRole("dialog", { name: "Сканировать камерой", exact: true }),
        ).toBeHidden();
        await expect(page.getByText(name, { exact: true }).filter({ visible: true })).toBeVisible();
        await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(barcode);
        assert.equal(new URL(page.url()).searchParams.get("storeId"), store.id);
        assert.equal(new URL(page.url()).searchParams.get("page"), "1");
        assert.ok(
          await page.evaluate(
            () =>
              (window as CameraWindow).cameraStreams.length > 0 &&
              (window as CameraWindow).cameraStreams.every((stream) =>
                stream.getTracks().every((track) => track.readyState === "ended"),
              ),
          ),
        );
        const clear = field.getByRole("button", { name: "Очистить поиск", exact: true });
        await camera.hover();
        const inputBox = await search.boundingBox();
        const cameraBox = await camera.boundingBox();
        const clearBox = await clear.boundingBox();
        assert.ok(inputBox && cameraBox && clearBox);
        for (const box of [cameraBox, clearBox]) {
          assert.ok(
            box.x >= inputBox.x &&
              box.y >= inputBox.y &&
              box.x + box.width <= inputBox.x + inputBox.width + 1 &&
              box.y + box.height <= inputBox.y + inputBox.height + 1,
          );
          assert.ok(box.width >= 40 && box.height >= 36);
        }
        assert.ok(clearBox.x + clearBox.width <= cameraBox.x + 1);
        await page.screenshot({ path: `${output}/camera-search-${width}.png` });
        await page.evaluate(() => {
          (window as CameraWindow).denyCamera = true;
        });
        await camera.click();
        await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(search).toHaveValue(barcode);
        await clear.click();
        await expect(search).toHaveValue("");
        await expect(search).toBeFocused();
        await search.fill(barcode);
        await page.reload();
        await expect(search).toHaveValue(barcode);
        await expect(page.getByText(name, { exact: true }).filter({ visible: true })).toBeVisible();
        await api("stores.updateProductSettings", { ...settings, enableBarcode: false }, true);
        await page.reload();
        await expect(camera).toHaveCount(0);
        await api("stores.updateProductSettings", { ...settings, enableBarcode: true }, true);
        assert.deepEqual(errors, []);
        checks.push(
          `Catalog camera ${width}px: real EAN-13 decoding preserves leading zero, filters the selected store, stops the camera; contained controls, permission denial, clear and reload work`,
        );
      } catch (error) {
        const page = context.pages()[0];
        if (page) await page.screenshot({ path: `${output}/failure-${width}.png` }).catch(() => {});
        throw error;
      } finally {
        await context.close();
      }
    }
  } finally {
    await api("stores.updateProductSettings", settings, true);
    await browser.close();
    await rm(temporary, { recursive: true, force: true });
  }
  return checks;
}
