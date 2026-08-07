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
  await new Promise((resolve) => setTimeout(resolve, 800));
};

const main = async () => {
  assertSafeEnvironment();
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
        return response.status;
      })()
    `;
    const login = await client.send<{ result: { value?: number } }>("Runtime.evaluate", {
      expression: loginExpression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (login.result.value !== 200)
      throw new Error(`Synthetic login failed with ${login.result.value ?? "unknown"}.`);

    for (const targetConfig of helpCaptureTargets) {
      await client.send("Emulation.setDeviceMetricsOverride", {
        width: targetConfig.width,
        height: targetConfig.height,
        deviceScaleFactor: 1,
        mobile: targetConfig.width < 600,
      });
      await navigate(client, `${baseUrl}${targetConfig.path}`);
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
    process.stdout.write(`Captured ${helpCaptureTargets.length} synthetic screens to ${output}\n`);
  } finally {
    chrome.kill("SIGTERM");
    await rm(profile, { recursive: true, force: true });
  }
};

void main();
