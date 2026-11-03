import { spawnSync } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { releaseOptions } from "./release-options";

const [platform, mode] = process.argv.slice(2);
if (!["android", "ios"].includes(platform) || !["unsigned", "signed"].includes(mode)) {
  throw new Error("Usage: pnpm mobile:release <android|ios> <unsigned|signed>");
}
const { version, build } = releaseOptions(process.env);
const env: NodeJS.ProcessEnv = {
  ...process.env,
  BAZAAR_MOBILE_ENV: "production",
  MOBILE_APP_VERSION: version,
  BAZAAR_ANDROID_VERSION_NAME: version,
  BAZAAR_ANDROID_VERSION_CODE: build,
};
const output = resolve(`artifacts/mobile-release-${version}-${build}`);
const run = (command: string, args: string[], cwd = process.cwd()) => {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
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
  run("xcodebuild", ["-version"]);
  const sdk = spawnSync("xcrun", ["--sdk", "iphoneos", "--show-sdk-version"], { env, encoding: "utf8" });
  if (sdk.status !== 0 || Number.parseInt(sdk.stdout, 10) < 26 || !/^\d+\./.test(sdk.stdout)) {
    throw new Error("Store archives require the iOS 26 SDK or later.");
  }
  if (mode === "signed") {
    requireEnv(["APPLE_TEAM_ID"]);
    if (!/^[A-Z0-9]{10}$/.test(env.APPLE_TEAM_ID ?? "")) throw new Error("Invalid APPLE_TEAM_ID.");
  }
  run("pnpm", ["mobile:sync"]);
  await mkdir(output, { recursive: true });
  const archive = resolve(output, mode === "signed" ? "Bazaar.xcarchive" : "Bazaar-unsigned.xcarchive");
  run("xcodebuild", ["-project", "ios/App/App.xcodeproj", "-scheme", "App", "-configuration", "Release",
    "-destination", "generic/platform=iOS", "-archivePath", archive,
    `MARKETING_VERSION=${version}`, `CURRENT_PROJECT_VERSION=${build}`,
    ...(mode === "signed" ? [`DEVELOPMENT_TEAM=${env.APPLE_TEAM_ID}`] : ["CODE_SIGNING_ALLOWED=NO"]), "archive"]);
  if (mode === "signed") {
    const options = resolve(output, "ExportOptions.plist");
    await writeFile(options, `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>destination</key><string>export</string>
<key>teamID</key><string>${env.APPLE_TEAM_ID}</string>
<key>signingStyle</key><string>automatic</string>
<key>manageAppVersionAndBuildNumber</key><false/>
<key>uploadSymbols</key><true/>
</dict></plist>\n`);
    run("xcodebuild", ["-exportArchive", "-archivePath", archive, "-exportOptionsPlist", options,
      "-exportPath", resolve(output, "export")]);
  }
}
console.log(`${platform} ${mode} build completed (${version}/${build}). No store upload was performed.`);
