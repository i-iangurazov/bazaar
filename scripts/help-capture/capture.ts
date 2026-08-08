import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";

import { CdpClient } from "./cdp";
import { helpCaptureTargets } from "./config";

const baseUrl = process.env.HELP_CAPTURE_BASE_URL ?? "http://127.0.0.1:3000";
const port = Number(process.env.HELP_CAPTURE_CDP_PORT ?? "9333");
const output = path.resolve(process.env.HELP_CAPTURE_OUTPUT ?? "tmp/help-captures-review");
const chromeBinary =
  process.env.HELP_CAPTURE_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const requestedTargets = new Set(
  (process.env.HELP_CAPTURE_TARGETS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const captureTargets = requestedTargets.size
  ? helpCaptureTargets.filter((target) => requestedTargets.has(target.name))
  : helpCaptureTargets;
const posRegisterId = process.env.HELP_CAPTURE_POS_REGISTER_ID?.trim();
const addFirstPosProduct = process.env.HELP_CAPTURE_POS_ADD_FIRST_PRODUCT === "1";
const completePosSale = process.env.HELP_CAPTURE_POS_COMPLETE_SALE === "1";

const assertSafeEnvironment = () => {
  const url = new URL(baseUrl);
  if (!new Set(["localhost", "127.0.0.1", "::1"]).has(url.hostname)) {
    throw new Error("Help capture is restricted to a local synthetic environment.");
  }
  if (process.env.HELP_CAPTURE_SYNTHETIC !== "1") {
    throw new Error("Set HELP_CAPTURE_SYNTHETIC=1 after selecting a synthetic demo organization.");
  }
  if (
    output.includes(`${path.sep}public${path.sep}`) &&
    process.env.HELP_CAPTURE_PUBLISH_REVIEWED !== "1"
  ) {
    throw new Error(
      "Captures go to review storage by default. Set HELP_CAPTURE_PUBLISH_REVIEWED=1 only after visual review.",
    );
  }
};

const waitForChrome = async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // Chrome is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Chrome CDP did not become ready.");
};

const navigate = async (client: CdpClient, url: string) => {
  const loaded = client.waitFor("Page.loadEventFired");
  await client.send("Page.navigate", { url });
  await loaded;
  await new Promise((resolve) => setTimeout(resolve, 1_500));
};

const stopChrome = async (chrome: ReturnType<typeof spawn>) => {
  if (chrome.exitCode !== null || chrome.signalCode !== null) return;
  const stopped = new Promise<void>((resolve) => chrome.once("exit", () => resolve()));
  chrome.kill("SIGTERM");
  await Promise.race([stopped, new Promise<void>((resolve) => setTimeout(resolve, 2_000))]);
};

const main = async () => {
  assertSafeEnvironment();
  if (!captureTargets.length) throw new Error("HELP_CAPTURE_TARGETS did not match any target.");
  const email = process.env.HELP_CAPTURE_EMAIL;
  const password = process.env.HELP_CAPTURE_PASSWORD;
  if (!email || !password)
    throw new Error("HELP_CAPTURE_EMAIL and HELP_CAPTURE_PASSWORD are required.");

  const profile = await mkdtemp(path.join(tmpdir(), "bazaar-help-capture-"));
  await mkdir(output, { recursive: true });
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

  try {
    await waitForChrome();
    const target = (await fetch(
      `http://127.0.0.1:${port}/json/new?${encodeURIComponent(baseUrl)}`,
      { method: "PUT" },
    ).then((response) => response.json())) as { webSocketDebuggerUrl: string };
    const client = await CdpClient.connect(target.webSocketDebuggerUrl);
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await navigate(client, `${baseUrl}/login`);
    const loginExpression = `
      (async () => {
        const csrf = await fetch('/api/auth/csrf').then((response) => response.json());
        const body = new URLSearchParams({ csrfToken: csrf.csrfToken, email: ${JSON.stringify(email)}, password: ${JSON.stringify(password)}, callbackUrl: ${JSON.stringify(baseUrl + "/dashboard")}, json: 'true' });
        const response = await fetch('/api/auth/callback/credentials', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, credentials: 'include' });
        const result = await response.json().catch(() => ({}));
        const session = await fetch('/api/auth/session', { credentials: 'include' }).then((sessionResponse) => sessionResponse.json());
        return { status: response.status, authenticated: Boolean(session?.user?.email), error: result?.error ?? null };
      })()
    `;
    const login = await client.send<{
      result: { value?: { status?: number; authenticated?: boolean; error?: string | null } };
    }>("Runtime.evaluate", {
      expression: loginExpression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (login.result.value?.status !== 200 || !login.result.value.authenticated) {
      throw new Error(
        `Synthetic login failed (${login.result.value?.error ?? login.result.value?.status ?? "unknown"}).`,
      );
    }

    for (const targetConfig of captureTargets) {
      await client.send("Emulation.setDeviceMetricsOverride", {
        width: targetConfig.width,
        height: targetConfig.height,
        deviceScaleFactor: 1,
        mobile: targetConfig.width < 600,
      });
      const targetUrl = new URL(targetConfig.path, baseUrl);
      if (targetConfig.name.startsWith("pos-") && posRegisterId) {
        targetUrl.searchParams.set("registerId", posRegisterId);
      }
      await navigate(client, targetUrl.toString());
      if (targetConfig.name === "pos-entry") {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      if (targetConfig.name === "pos-desktop-wide" && addFirstPosProduct) {
        await client.send("Runtime.evaluate", {
          expression: `Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim().includes('Добавить'))?.click()`,
        });
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
      if (targetConfig.name === "pos-desktop-wide" && completePosSale) {
        await client.send("Runtime.evaluate", {
          expression: `Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Завершить продажу')?.click()`,
        });
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      const shot = await client.send<{ data: string }>("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false,
      });
      await sharp(Buffer.from(shot.data, "base64"))
        .webp({ quality: 82, effort: 4 })
        .toFile(path.join(output, `${targetConfig.name}.webp`));
    }
    client.close();
    process.stdout.write(`Captured ${captureTargets.length} synthetic screens to ${output}\n`);
  } finally {
    await stopChrome(chrome);
    await rm(profile, { recursive: true, force: true });
  }
};

void main();
