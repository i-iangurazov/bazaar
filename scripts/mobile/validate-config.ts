import { access, readFile } from "node:fs/promises";
import path from "node:path";

import config from "../../capacitor.config";

const requiredPlugins = [
  "@capacitor/app",
  "@capacitor/barcode-scanner",
  "@capacitor/device",
  "@capacitor/filesystem",
  "@capacitor/haptics",
  "@capacitor/keyboard",
  "@capacitor/network",
  "@capacitor/push-notifications",
  "@capacitor/share",
  "@capacitor/splash-screen",
  "@capacitor/status-bar",
];

if (config.appId !== "kg.bazaar.app" || config.appName !== "Bazaar") {
  throw new Error("Unexpected Bazaar native application identity.");
}

const serverUrl = new URL(config.server?.url ?? "");
if (process.env.BAZAAR_MOBILE_ENV !== "development" && serverUrl.protocol !== "https:") {
  throw new Error("Mobile staging/production configuration must use HTTPS.");
}

if ((process.env.BAZAAR_MOBILE_ENV ?? "production") === "production") {
  if (serverUrl.origin !== "https://www.bazaar.kg") {
    throw new Error("Production native configuration points outside official Bazaar.");
  }
  if (config.server?.cleartext) {
    throw new Error("Production native configuration cannot allow cleartext traffic.");
  }
}

const packageJson = JSON.parse(
  await readFile(path.join(process.cwd(), "package.json"), "utf8"),
) as { dependencies?: Record<string, string> };
for (const plugin of requiredPlugins) {
  if (!packageJson.dependencies?.[plugin]) {
    throw new Error(`Missing required native runtime package: ${plugin}`);
  }
}

await Promise.all([
  access(path.join(process.cwd(), config.webDir ?? "mobile-shell", "index.html")),
  access(path.join(process.cwd(), config.webDir ?? "mobile-shell", "native-offline.html")),
]);

const serialized = JSON.stringify(config);
const forbidden = [
  "DATABASE_URL",
  "REDIS_URL",
  "RESEND_API_KEY",
  "NEXTAUTH_SECRET",
  "R2_SECRET_ACCESS_KEY",
  "MARKET_TOKEN_ENCRYPTION_SECRET",
];
for (const key of forbidden) {
  if (serialized.includes(key) || serialized.includes(process.env[key] ?? "__missing__")) {
    throw new Error(`Native config contains forbidden server secret material: ${key}`);
  }
}

process.stdout.write(
  `${JSON.stringify({ appId: config.appId, environment: process.env.BAZAAR_MOBILE_ENV ?? "production", serverOrigin: serverUrl.origin, plugins: requiredPlugins.length })}\n`,
);
