import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CapacitorConfig } from "@capacitor/cli";

export const IOS_PRODUCTION_URL = "https://www.bazaar.kg/dashboard";
export const IOS_STAGING_URL = "https://bazaar-ios-preview-20261111.vercel.app/dashboard";
export type IOSBuildChannel = "development" | "production" | "staging-testflight";
type BuildEnvironment = Record<string, string | undefined>;
export type IOSBundledConfig = CapacitorConfig & {
  bazaarBuildChannel: IOSBuildChannel;
  bazaarAllowedDistribution: "development" | "app-store" | "testflight-internal";
};

/** A per-build copy prevents a staging archive from changing the next Release. */
export function prepareIOSBuildConfig(input: unknown, env: BuildEnvironment): IOSBundledConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid Capacitor configuration.");
  const config = structuredClone(input) as IOSBundledConfig;
  if (config.appId !== "kg.bazaar.app" || config.appName !== "Bazaar") throw new Error("Unexpected native application identity.");
  const configuration = env.CONFIGURATION;
  const channel: IOSBuildChannel = configuration === "Debug" ? "development"
    : configuration === "Release" ? "production"
      : configuration === "ReleaseStaging" ? "staging-testflight"
        : (() => { throw new Error(`Unsupported iOS configuration: ${configuration ?? "missing"}.`); })();
  if (env.BAZAAR_NATIVE_CHANNEL !== channel) throw new Error("iOS build configuration/channel mismatch.");
  const flags = `${env.SWIFT_ACTIVE_COMPILATION_CONDITIONS ?? ""} ${env.OTHER_SWIFT_FLAGS ?? ""}`;
  const defined = (symbol: string) => new RegExp(`(^|[^A-Za-z0-9_])(?:-D)?${symbol}($|[^A-Za-z0-9_])`).test(flags);
  const debug = defined("DEBUG");
  const staging = defined("BAZAAR_STAGING");
  if (channel === "staging-testflight" ? !staging || debug : staging || (channel === "production" && debug)) {
    throw new Error("iOS compiler conditions do not match the requested release channel.");
  }
  const version = env.MARKETING_VERSION ?? "1.0.0";
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid iOS marketing version.");
  const sourceUrl = new URL(config.server?.url ?? "");
  if (!["http:", "https:"].includes(sourceUrl.protocol) || sourceUrl.username || sourceUrl.password) {
    throw new Error("Invalid native server URL.");
  }
  if (channel === "production" && sourceUrl.href !== IOS_PRODUCTION_URL) {
    throw new Error("Normal Release requires the production Capacitor configuration; staging cannot enter the App Store path.");
  }
  config.bazaarBuildChannel = channel;
  config.bazaarAllowedDistribution = channel === "staging-testflight" ? "testflight-internal"
    : channel === "production" ? "app-store" : "development";
  config.loggingBehavior = "none";
  // Only the derived iOS bundle owns the readiness-driven UIKit cover. Keep
  // Android's shared launch timing and every unrelated plugin setting intact.
  config.backgroundColor = "#ffffff";
  config.plugins = {
    ...config.plugins,
    SplashScreen: {
      ...config.plugins?.SplashScreen,
      launchShowDuration: 0,
      backgroundColor: "#ffffff",
    },
  };
  config.ios = {
    ...config.ios,
    appendUserAgent: ` BazaarNativeIOS/${version} (${channel})`,
    loggingBehavior: "none",
    ...(channel === "development" ? {} : { webContentsDebuggingEnabled: false }),
  };
  if (channel !== "development") {
    const url = channel === "staging-testflight" ? IOS_STAGING_URL : IOS_PRODUCTION_URL;
    config.server = { ...config.server, url, cleartext: false, allowNavigation: [new URL(url).hostname] };
  }
  return config;
}

async function main() {
  const sourceRoot = process.env.SRCROOT;
  const target = process.env.TARGET_BUILD_DIR;
  const resources = process.env.UNLOCALIZED_RESOURCES_FOLDER_PATH;
  if (!sourceRoot || !target || !resources) throw new Error("Run this preparation step from the iOS App target.");
  const source = path.join(sourceRoot, "App/capacitor.config.json");
  const output = path.join(target, resources, "capacitor.config.json");
  if (path.resolve(output) === path.resolve(source)) throw new Error("Never overwrite the source Capacitor configuration.");
  const config = prepareIOSBuildConfig(JSON.parse(await readFile(source, "utf8")), process.env);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`Prepared Bazaar ${config.bazaarBuildChannel}: ${new URL(config.server!.url!).origin} (${config.bazaarAllowedDistribution}).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
