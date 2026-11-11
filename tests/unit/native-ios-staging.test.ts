import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { IOS_PRODUCTION_URL, IOS_STAGING_URL, prepareIOSBuildConfig } from "../../scripts/mobile/ios-build-config";
import { assertIOSArchiveChannel, iosExportOptions, iosReleaseChannel, iosReleasePlan } from "../../scripts/mobile/ios-release-channel";

const baseConfig = () => ({
  appId: "kg.bazaar.app", appName: "Bazaar", webDir: "mobile-shell", loggingBehavior: "none",
  server: { url: IOS_PRODUCTION_URL, cleartext: false, allowNavigation: ["www.bazaar.kg"], errorPath: "native-offline.html" },
  ios: { webContentsDebuggingEnabled: false, handleApplicationNotifications: true },
  plugins: { Keyboard: { resize: "body" }, PushNotifications: { presentationOptions: ["badge", "sound", "alert"] } },
  packageClassList: ["AppPlugin", "FilesystemPlugin", "CapacitorBarcodeScannerPlugin"],
});
const buildEnv = (staging = true) => ({
  CONFIGURATION: staging ? "ReleaseStaging" : "Release",
  BAZAAR_NATIVE_CHANNEL: staging ? "staging-testflight" : "production",
  SWIFT_ACTIVE_COMPILATION_CONDITIONS: staging ? "BAZAAR_STAGING" : "",
  OTHER_SWIFT_FLAGS: "",
  MARKETING_VERSION: "1.2.3",
});
const archiveInfo = (staging = true) => ({
  CFBundleIdentifier: "kg.bazaar.app", CFBundleShortVersionString: "1.2.3", CFBundleVersion: "42",
  BazaarBuildChannel: staging ? "staging-testflight" : "production",
  BazaarAllowedDistribution: staging ? "testflight-internal" : "app-store",
});
const identity = { version: "1.2.3", build: "42" };

describe("fixed iOS staging release channel", () => {
  it("keeps the default release on production and requires an explicit staging channel", () => {
    expect(iosReleaseChannel(undefined)).toBe("production");
    expect(iosReleasePlan({}, "production")).toMatchObject({ scheme: "App", configuration: "Release", serverUrl: IOS_PRODUCTION_URL, distribution: "app-store" });
    expect(iosReleasePlan({}, "staging-testflight")).toMatchObject({ scheme: "AppStaging", configuration: "ReleaseStaging", serverUrl: IOS_STAGING_URL, distribution: "testflight-internal" });
    expect(() => iosReleaseChannel("staging")).toThrow();
    expect(() => iosReleasePlan({ BAZAAR_MOBILE_ENV: "staging" }, "production")).toThrow();
  });

  it.each([
    "https://www.bazaar.kg/dashboard", "https://arbitrary.example.invalid/dashboard",
    "https://bazaar-ios-preview-20261111.vercel.app/dashboard?override=1",
    "https://user@bazaar-ios-preview-20261111.vercel.app/dashboard",
  ])("rejects a staging server override: %s", (url) => {
    expect(() => iosReleasePlan({ CAPACITOR_SERVER_URL: url }, "staging-testflight")).toThrow();
  });

  it("prepares a distinct release bundle without modifying shared source config or native features", () => {
    const source = baseConfig();
    const before = structuredClone(source);
    const staging = prepareIOSBuildConfig(source, buildEnv());
    expect(source).toEqual(before);
    expect(staging.appId).toBe("kg.bazaar.app");
    expect(staging.server).toMatchObject({ url: IOS_STAGING_URL, allowNavigation: [new URL(IOS_STAGING_URL).hostname], cleartext: false, errorPath: "native-offline.html" });
    expect(staging.ios).toMatchObject({ webContentsDebuggingEnabled: false, loggingBehavior: "none", handleApplicationNotifications: true });
    expect(staging.plugins).toEqual(source.plugins);
    expect(staging).toMatchObject({ packageClassList: source.packageClassList, bazaarBuildChannel: "staging-testflight", bazaarAllowedDistribution: "testflight-internal" });
    const production = prepareIOSBuildConfig(source, buildEnv(false));
    expect(production.server?.url).toBe(IOS_PRODUCTION_URL);
    expect(production.bazaarBuildChannel).toBe("production");
  });

  it.each([
    { SWIFT_ACTIVE_COMPILATION_CONDITIONS: "" },
    { SWIFT_ACTIVE_COMPILATION_CONDITIONS: "BAZAAR_STAGING DEBUG" },
    { OTHER_SWIFT_FLAGS: "-DDEBUG" },
    { BAZAAR_NATIVE_CHANNEL: "production" },
    { CONFIGURATION: "Staging" },
  ])("fails closed on staging compiler/configuration mismatch: %j", (override) => {
    expect(() => prepareIOSBuildConfig(baseConfig(), { ...buildEnv(), ...override })).toThrow();
  });

  it.each([IOS_STAGING_URL, "http://www.bazaar.kg/dashboard", `${IOS_PRODUCTION_URL}?staging=1`])("refuses a non-production normal Release source: %s", (url) => {
    const source = baseConfig();
    source.server.url = url;
    expect(() => prepareIOSBuildConfig(source, buildEnv(false))).toThrow();
  });

  it("cannot turn a normal Release into a debug or staging compiler build", () => {
    for (const flag of ["DEBUG", "-DDEBUG", "BAZAAR_STAGING", "-DBAZAAR_STAGING"]) {
      expect(() => prepareIOSBuildConfig(baseConfig(), { ...buildEnv(false), OTHER_SWIFT_FLAGS: flag })).toThrow();
    }
  });

  it("keeps existing explicit Debug development configuration separate from TestFlight", () => {
    const source = baseConfig();
    source.server.url = "http://localhost:3136/dashboard";
    const config = prepareIOSBuildConfig(source, { ...buildEnv(false), CONFIGURATION: "Debug", BAZAAR_NATIVE_CHANNEL: "development", SWIFT_ACTIVE_COMPILATION_CONDITIONS: "DEBUG" });
    expect(config.server?.url).toBe(source.server.url);
    expect(config.bazaarAllowedDistribution).toBe("development");
    expect(() => assertIOSArchiveChannel(archiveInfo(), config, "staging-testflight", identity)).toThrow();
  });

  it("validates actual archived channel, distribution, origin and build before export", () => {
    const staging = prepareIOSBuildConfig(baseConfig(), buildEnv());
    expect(() => assertIOSArchiveChannel(archiveInfo(), staging, "staging-testflight", identity)).not.toThrow();
    expect(() => assertIOSArchiveChannel(archiveInfo(), staging, "production", identity)).toThrow();
    expect(() => assertIOSArchiveChannel(archiveInfo(false), staging, "production", identity)).toThrow();
    expect(() => assertIOSArchiveChannel({ ...archiveInfo(), CFBundleVersion: "41" }, staging, "staging-testflight", identity)).toThrow();
    expect(() => assertIOSArchiveChannel(archiveInfo(), { ...staging, server: { ...staging.server, url: IOS_PRODUCTION_URL } }, "staging-testflight", identity)).toThrow();
    const production = prepareIOSBuildConfig(baseConfig(), buildEnv(false));
    expect(() => assertIOSArchiveChannel(archiveInfo(false), production, "production", identity)).not.toThrow();
  });

  it("forces Apple's internal-TestFlight restriction for staging export", () => {
    expect(iosExportOptions("SYNTH12345", "staging-testflight")).toContain("<key>testFlightInternalTestingOnly</key><true/>");
    expect(iosExportOptions("SYNTH12345", "production")).not.toContain("testFlightInternalTestingOnly");
    expect(() => iosExportOptions("bad<team>", "staging-testflight")).toThrow();
  });

  it("refuses malformed archive metadata and nested native configuration", () => {
    const valid = prepareIOSBuildConfig(baseConfig(), buildEnv());
    for (const malformed of [null, [], "archive", 1, { ...valid, server: null }, { ...valid, ios: [] }]) {
      expect(() => assertIOSArchiveChannel(archiveInfo(), malformed, "staging-testflight", identity)).toThrow();
    }
    expect(() => assertIOSArchiveChannel(null, valid, "staging-testflight", identity)).toThrow();
    expect(() => assertIOSArchiveChannel(archiveInfo(), { ...valid, ios: { ...valid.ios, loggingBehavior: "debug" } }, "staging-testflight", identity)).toThrow();
  });

  it("executes the build preparation entry point only into an isolated derived bundle", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bazaar-ios-channel-"));
    try {
      const sourceRoot = path.join(root, "source");
      const sourceFile = path.join(sourceRoot, "App/capacitor.config.json");
      await mkdir(path.dirname(sourceFile), { recursive: true });
      const source = `${JSON.stringify(baseConfig())}\n`;
      await writeFile(sourceFile, source);
      execFileSync(process.execPath, ["--import", "tsx", path.resolve("scripts/mobile/ios-build-config.ts")], {
        env: { ...process.env, ...buildEnv(), SRCROOT: sourceRoot, TARGET_BUILD_DIR: path.join(root, "derived"), UNLOCALIZED_RESOURCES_FOLDER_PATH: "App.app" },
        stdio: "pipe",
      });
      const bundled = JSON.parse(await readFile(path.join(root, "derived/App.app/capacitor.config.json"), "utf8"));
      expect(bundled.server.url).toBe(IOS_STAGING_URL);
      expect(bundled.bazaarBuildChannel).toBe("staging-testflight");
      expect(await readFile(sourceFile, "utf8")).toBe(source);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
