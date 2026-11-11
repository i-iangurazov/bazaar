import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { releaseOptions } from "./release-options";
import { assertIOSArchiveChannel, iosExportOptions, iosReleaseChannel, iosReleasePlan } from "./ios-release-channel";

const [platform, mode, channelArgument, ...extra] = process.argv.slice(2);
if (!["android", "ios"].includes(platform) || !["unsigned", "signed"].includes(mode) || extra.length || (platform !== "ios" && channelArgument)) {
  throw new Error("Usage: pnpm mobile:release <android|ios> <unsigned|signed> [production|staging-testflight (iOS only)]");
}
const channel = iosReleaseChannel(platform === "ios" ? channelArgument : undefined);
const plan = platform === "ios" ? iosReleasePlan(process.env, channel) : null;
const { version, build } = plan ?? releaseOptions(process.env);
const env: NodeJS.ProcessEnv = {
  ...process.env,
  BAZAAR_MOBILE_ENV: plan?.environment ?? "production",
  MOBILE_APP_VERSION: version,
  BAZAAR_ANDROID_VERSION_NAME: version,
  BAZAAR_ANDROID_VERSION_CODE: build,
  NODE_BINARY: process.execPath,
};
const output = resolve(`artifacts/mobile-release-${version}-${build}${plan?.outputSuffix ?? ""}`);
const run = (command: string, args: string[], cwd = process.cwd(), commandEnv = env) => {
  const result = spawnSync(command, args, { cwd, env: commandEnv, stdio: "inherit" });
  if (result.error || result.status !== 0) throw new Error(`${command} failed; release not complete.`);
};
const requireEnv = (keys: string[]) => {
  for (const key of keys) if (!env[key]?.trim()) throw new Error(`Missing ${key}.`);
};

if (platform === "android") {
  if (mode === "signed") {
    requireEnv(["BAZAAR_ANDROID_KEYSTORE_PATH", "BAZAAR_ANDROID_KEYSTORE_PASSWORD",
      "BAZAAR_ANDROID_KEY_ALIAS", "BAZAAR_ANDROID_KEY_PASSWORD"]);
    env.BAZAAR_ANDROID_KEYSTORE_PATH = resolve(process.env.BAZAAR_ANDROID_KEYSTORE_PATH!);
    await access(env.BAZAAR_ANDROID_KEYSTORE_PATH);
  } else {
    // An unsigned rehearsal must never silently consume a real upload key.
    for (const key of Object.keys(env)) if (key.startsWith("BAZAAR_ANDROID_KEY")) delete env[key];
  }
  run("pnpm", ["mobile:sync"]);
  run("./gradlew", ["--no-daemon", ":app:bundleRelease", ":app:assembleDebug", ":app:lintRelease"], resolve("android"));
  if (mode === "signed") {
    // jarsigner also exits 0 for an unsigned ZIP: require cryptographic verification output.
    const result = spawnSync("jarsigner", ["-verify", resolve("android/app/build/outputs/bundle/release/app-release.aab")],
      { env, encoding: "utf8" });
    if (result.status !== 0 || !result.stdout.includes("jar verified.")) throw new Error("AAB signature not verified.");
  }
} else {
  if (!plan) throw new Error("Missing iOS release plan.");
  run("xcodebuild", ["-version"]);
  const sdk = spawnSync("xcrun", ["--sdk", "iphoneos", "--show-sdk-version"], { env, encoding: "utf8" });
  if (sdk.status !== 0 || Number.parseInt(sdk.stdout, 10) < 26 || !/^\d+\./.test(sdk.stdout)) {
    throw new Error("Store archives require the iOS 26 SDK or later.");
  }
  if (mode === "signed") {
    requireEnv(["APPLE_TEAM_ID"]);
    if (!/^[A-Z0-9]{10}$/.test(env.APPLE_TEAM_ID ?? "")) throw new Error("Invalid APPLE_TEAM_ID.");
  }
  // Keep the shared/generated source config on production. The dedicated Xcode
  // configuration creates its fixed staging copy inside that build's bundle.
  const syncEnv = { ...env, BAZAAR_MOBILE_ENV: "production" };
  run("pnpm", ["mobile:validate"], process.cwd(), syncEnv);
  run("pnpm", ["exec", "cap", "sync", "ios"], process.cwd(), syncEnv);
  await mkdir(output, { recursive: true });
  const archive = resolve(output, mode === "signed" ? "Bazaar.xcarchive" : "Bazaar-unsigned.xcarchive");
  run("nice", ["-n", "10", "xcodebuild", "-project", "ios/App/App.xcodeproj", "-scheme", plan.scheme, "-configuration", plan.configuration,
    "-destination", "generic/platform=iOS", "-archivePath", archive,
    "-jobs", "2", "ARCHS=arm64", "ONLY_ACTIVE_ARCH=YES",
    // The verified archive uses Xcode's default WMO mode. -jobs 2 and -j2 do
    // not cap its auto-generated internal thread count; see the staging guide.
    "OTHER_SWIFT_FLAGS=$(inherited) -j2",
    `MARKETING_VERSION=${version}`, `CURRENT_PROJECT_VERSION=${build}`,
    ...(mode === "signed" ? [`DEVELOPMENT_TEAM=${env.APPLE_TEAM_ID}`] : ["CODE_SIGNING_ALLOWED=NO"]), "archive"]);
  const app = resolve(archive, "Products/Applications/App.app");
  const info = spawnSync("plutil", ["-convert", "json", "-o", "-", resolve(app, "Info.plist")], { env, encoding: "utf8" });
  if (info.status !== 0) throw new Error("Cannot inspect archived app identity; export refused.");
  assertIOSArchiveChannel(JSON.parse(info.stdout), JSON.parse(await readFile(resolve(app, "capacitor.config.json"), "utf8")), channel, { version, build });
  await writeFile(resolve(output, "ReleaseChannel.json"), `${JSON.stringify({
    channel, scheme: plan.scheme, configuration: plan.configuration, serverUrl: plan.serverUrl,
    allowedDistribution: plan.distribution, version, build, mode, uploadPerformed: false,
  }, null, 2)}\n`);
  if (mode === "signed") {
    const options = resolve(output, "ExportOptions.plist");
    await writeFile(options, iosExportOptions(env.APPLE_TEAM_ID!, channel));
    run("xcodebuild", ["-exportArchive", "-archivePath", archive, "-exportOptionsPlist", options,
      "-exportPath", resolve(output, "export")]);
  }
}
console.log(`${platform} ${mode} build completed (${version}/${build}${plan ? `, ${plan.channel}, ${plan.distribution}` : ""}). No store upload was performed.`);
