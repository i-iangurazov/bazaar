import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";

import { helpCategories, helpGuides } from "../../src/content/help/catalog";
import { CdpClient } from "./cdp";

const baseUrl = process.env.HELP_QA_BASE_URL ?? "http://127.0.0.1:3116";
const port = Number(process.env.HELP_QA_CDP_PORT ?? "9237");
const evidenceDir = path.resolve(process.env.HELP_QA_EVIDENCE_DIR ?? "docs/help/evidence");
const chromeBinary =
  process.env.HELP_CAPTURE_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const viewports = [
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-414", width: 414, height: 896 },
  { name: "tablet-768", width: 768, height: 980 },
  { name: "tablet-1024", width: 1024, height: 900 },
  { name: "desktop-1440", width: 1440, height: 1000 },
  { name: "wide-1920", width: 1920, height: 1080 },
] as const;

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitForChrome = async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) return;
    } catch {
      // Browser is starting.
    }
    await wait(250);
  }
  throw new Error("Chrome CDP did not become ready");
};

const evaluate = async <T>(client: CdpClient, expression: string) => {
  const response = await client.send<{ result: { value?: T }; exceptionDetails?: unknown }>(
    "Runtime.evaluate",
    {
      expression,
      awaitPromise: true,
      returnByValue: true,
    },
  );
  if (response.exceptionDetails)
    throw new Error(`Browser evaluation failed: ${JSON.stringify(response.exceptionDetails)}`);
  return response.result.value as T;
};

const navigate = async (client: CdpClient, pathName: string) => {
  const loaded = client.waitFor("Page.loadEventFired", 30_000);
  await client.send("Page.navigate", { url: `${baseUrl}${pathName}` });
  await loaded;
  await wait(700);
};

const capture = async (client: CdpClient, name: string) => {
  const result = await client.send<{ data: string }>("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await sharp(Buffer.from(result.data, "base64"))
    .webp({ quality: 82, effort: 4 })
    .toFile(path.join(evidenceDir, `${name}.webp`));
};

const main = async () => {
  const url = new URL(baseUrl);
  const isLocal = new Set(["localhost", "127.0.0.1", "::1"]).has(url.hostname);
  const isApprovedProduction =
    process.env.HELP_QA_ALLOW_REMOTE === "1" &&
    url.protocol === "https:" &&
    url.hostname === "www.bazaar.kg";
  if (!isLocal && !isApprovedProduction)
    throw new Error("Browser QA only permits local Bazaar or explicitly approved Production.");
  await mkdir(evidenceDir, { recursive: true });
  const profile = await mkdtemp(path.join(tmpdir(), "bazaar-help-qa-"));
  const chrome = spawn(
    chromeBinary,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const consoleErrors: string[] = [];
  const runtimeErrors: string[] = [];
  const apiErrors: string[] = [];
  const viewportResults: unknown[] = [];
  const contextualResults: unknown[] = [];

  try {
    await waitForChrome();
    const target = (await fetch(
      `http://127.0.0.1:${port}/json/new?${encodeURIComponent(baseUrl)}`,
      { method: "PUT" },
    ).then((response) => response.json())) as { webSocketDebuggerUrl: string };
    const client = await CdpClient.connect(target.webSocketDebuggerUrl);
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Network.enable");
    void client.waitFor("Runtime.consoleAPICalled", 3_600_000).catch(() => undefined);

    const socket = (client as unknown as { listeners: Map<string, Set<(params: unknown) => void>> })
      .listeners;
    const addListener = (event: string, listener: (params: Record<string, unknown>) => void) => {
      const listeners = socket.get(event) ?? new Set();
      listeners.add(listener as (params: unknown) => void);
      socket.set(event, listeners);
    };
    addListener("Runtime.consoleAPICalled", (params) => {
      if (params.type === "error") consoleErrors.push(JSON.stringify(params.args));
    });
    addListener("Runtime.exceptionThrown", (params) => runtimeErrors.push(JSON.stringify(params)));
    addListener("Network.responseReceived", (params) => {
      const response = params.response as { status?: number; url?: string } | undefined;
      if (response?.url?.startsWith(baseUrl) && (response.status ?? 0) >= 400)
        apiErrors.push(`${response.status} ${response.url}`);
    });

    for (const viewport of viewports) {
      await client.send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: viewport.width < 600,
      });
      await navigate(client, "/help");
      const result = await evaluate<Record<string, unknown>>(
        client,
        `(() => ({
        h1: document.querySelector('h1')?.textContent?.trim(),
        tasks: document.querySelectorAll('[data-help-task]').length,
        roleTabs: document.querySelectorAll('[role="tab"]').length,
        categories: Array.from(document.querySelectorAll('a[href^="/help/"]')).filter((link) => /^\\/help\\/[a-z-]+$/.test(link.getAttribute('href') || '')).length,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        imagesWithoutAlt: Array.from(document.images).filter((image) => !image.alt).length,
        main: Boolean(document.querySelector('main')),
        navigationMs: Math.round(performance.getEntriesByType('navigation')[0]?.duration || 0),
        domContentLoadedMs: Math.round(performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd || 0)
      }))()`,
      );
      viewportResults.push({ ...viewport, ...result });
      if ([390, 768, 1440, 1920].includes(viewport.width))
        await capture(client, `help-home-${viewport.name}`);
    }

    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await navigate(client, "/help");
    await evaluate(client, `document.querySelector('input[role="combobox"]')?.focus()`);
    await client.send("Input.insertText", { text: "закрыть кассу" });
    await wait(250);
    const searchResult = await evaluate<Record<string, unknown>>(
      client,
      `(() => {
      const first = document.querySelector('[role="option"]');
      return { href: first?.getAttribute('href'), text: first?.textContent?.trim(), count: document.querySelectorAll('[role="option"]').length };
    })()`,
    );

    await evaluate(client, `document.querySelectorAll('[role="tab"]')[2]?.click()`);
    await wait(100);
    const roleResult = await evaluate<Record<string, unknown>>(
      client,
      `(() => {
      const tabs = document.querySelectorAll('[role="tab"]');
      return { selected: tabs[2]?.getAttribute('aria-selected'), links: document.querySelectorAll('[role="tabpanel"] a').length };
    })()`,
    );

    const journeyResult = await evaluate<Record<string, unknown>>(
      client,
      `(async () => {
      const button = document.querySelector('[data-help-journey-step] button[aria-pressed]');
      button?.click();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const stored = JSON.parse(localStorage.getItem('bazaar-guide:getting-started:v1') || '[]');
      const result = { steps: document.querySelectorAll('[data-help-journey-step]').length, pressed: button?.getAttribute('aria-pressed'), stored: stored.length };
      localStorage.removeItem('bazaar-guide:getting-started:v1');
      return result;
    })()`,
    );

    await navigate(client, "/help/products/add-product");
    await evaluate(client, `document.querySelector('figure button')?.click()`);
    await wait(100);
    const articleResult = await evaluate<Record<string, unknown>>(
      client,
      `(() => {
      return { h1: document.querySelector('h1')?.textContent?.trim(), steps: document.querySelectorAll('article > section[id^="step-"]').length, dialogOpen: document.querySelector('dialog')?.open, annotations: document.querySelectorAll('figcaption b').length, structuredData: Boolean(document.querySelector('script[type="application/ld+json"]')), overflow: document.documentElement.scrollWidth - innerWidth };
    })()`,
    );
    await capture(client, "help-guide-add-product-mobile-390");
    await client.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    });
    await client.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    });
    await wait(100);
    const dialogClosed = await evaluate(client, `!document.querySelector('dialog')?.open`);

    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await navigate(client, "/help/inventory/receiving");
    await capture(client, "help-guide-receiving-desktop-1440");

    const localeResults: Record<string, string | undefined> = {};
    for (const locale of ["kg", "en", "ru"]) {
      await evaluate(
        client,
        `fetch('/api/locale', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale: '${locale}' }) })`,
      );
      await navigate(client, "/help");
      localeResults[locale] = await evaluate(
        client,
        `document.querySelector('h1')?.textContent?.trim()`,
      );
    }

    const publicRoutes = [
      "/help",
      ...helpCategories.map((category) => `/help/${category.slug}`),
      ...helpGuides.map((guide) => `/help/${guide.category}/${guide.slug}`),
    ];
    const routeResults = [];
    for (const route of publicRoutes) {
      const response = await fetch(`${baseUrl}${route}`, { redirect: "manual" });
      routeResults.push({ route, status: response.status });
    }

    const email = process.env.QA_EMAIL;
    const password = process.env.QA_PASSWORD;
    if (process.env.HELP_QA_AUTH === "1" && email && password) {
      await navigate(client, "/login");
      const loginStatus = await evaluate<number>(
        client,
        `(async () => {
        const csrf = await fetch('/api/auth/csrf').then((response) => response.json());
        const body = new URLSearchParams({ csrfToken: csrf.csrfToken, email: ${JSON.stringify(email)}, password: ${JSON.stringify(password)}, callbackUrl: ${JSON.stringify(baseUrl + "/dashboard")}, json: 'true' });
        return (await fetch('/api/auth/callback/credentials', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, credentials: 'include' })).status;
      })()`,
      );
      for (const appPath of ["/products", "/inventory/receiving", "/pos/sell", "/pos/shifts"]) {
        await navigate(client, appPath);
        const contextual = await evaluate<Record<string, unknown>>(
          client,
          `(async () => {
          const button = document.querySelector('button[aria-label="Подсказки"]'); button?.click(); await new Promise((resolve) => setTimeout(resolve, 100));
          const link = Array.from(document.querySelectorAll('a[href^="/help/"]')).find((item) => item.getAttribute('target') === '_blank');
          return { path: location.pathname, button: Boolean(button), href: link?.getAttribute('href'), problems: document.querySelectorAll('[role="alert"]').length };
        })()`,
        );
        contextualResults.push({ appPath, loginStatus, ...contextual });
      }
    }

    const report = {
      generatedAt: new Date().toISOString(),
      baseUrl,
      viewportResults,
      searchResult,
      roleResult,
      journeyResult,
      articleResult: { ...articleResult, dialogClosed },
      localeResults,
      routeResults,
      contextualResults,
      consoleErrors,
      runtimeErrors,
      apiErrors,
    };
    await writeFile(
      path.join(evidenceDir, "browser-qa.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    client.close();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    chrome.kill("SIGTERM");
    if (chrome.exitCode === null)
      await Promise.race([once(chrome, "exit"), wait(1_500)]);
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
};

void main();
