import { IOS_PRODUCTION_URL, IOS_STAGING_URL, type IOSBuildChannel } from "./ios-build-config";
import { releaseOptions } from "./release-options";

export type IOSReleaseChannel = Exclude<IOSBuildChannel, "development">;

export function iosReleaseChannel(raw: string | undefined): IOSReleaseChannel {
  if (raw === undefined || raw === "production") return "production";
  if (raw === "staging-testflight") return raw;
  throw new Error("iOS release channel must be production or staging-testflight.");
}

export function iosReleasePlan(env: Record<string, string | undefined>, channel: IOSReleaseChannel) {
  if (channel === "production") return {
    ...releaseOptions(env), channel, scheme: "App", configuration: "Release", environment: "production",
    serverUrl: IOS_PRODUCTION_URL, distribution: "app-store", outputSuffix: "",
  } as const;
  if (env.BAZAAR_MOBILE_ENV && env.BAZAAR_MOBILE_ENV !== "staging") throw new Error("The explicit staging channel requires BAZAAR_MOBILE_ENV=staging or unset.");
  if (env.CAPACITOR_SERVER_URL && new URL(env.CAPACITOR_SERVER_URL).href !== IOS_STAGING_URL) throw new Error("TestFlight staging uses only the fixed isolated preview URL.");
  return {
    ...releaseOptions({ ...env, BAZAAR_MOBILE_ENV: undefined }), channel, scheme: "AppStaging", configuration: "ReleaseStaging",
    environment: "staging", serverUrl: IOS_STAGING_URL, distribution: "testflight-internal", outputSuffix: "-staging-testflight",
  } as const;
}

export function assertIOSArchiveChannel(
  info: unknown, config: unknown, channel: IOSReleaseChannel,
  identity: { version: string; build: string },
) {
  const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  if (!record(info) || !record(config) || !record(config.server) || !record(config.ios)) {
    throw new Error("Malformed archive metadata or native configuration; export refused.");
  }
  const distribution = channel === "staging-testflight" ? "testflight-internal" : "app-store";
  const url = channel === "staging-testflight" ? IOS_STAGING_URL : IOS_PRODUCTION_URL;
  const server = config.server;
  const ios = config.ios;
  const navigation = server.allowNavigation;
  if (info.CFBundleIdentifier !== "kg.bazaar.app" || info.BazaarBuildChannel !== channel || info.BazaarAllowedDistribution !== distribution ||
    info.CFBundleShortVersionString !== identity.version || info.CFBundleVersion !== identity.build ||
    config.bazaarBuildChannel !== channel || config.bazaarAllowedDistribution !== distribution ||
    server.url !== url || server.cleartext !== false || !Array.isArray(navigation) || navigation.length !== 1 || navigation[0] !== new URL(url).hostname ||
    config.loggingBehavior !== "none" || ios.loggingBehavior !== "none" || ios.webContentsDebuggingEnabled !== false) {
    throw new Error("Archive identity, native channel or origin mismatch; export refused.");
  }
}

export function iosExportOptions(teamId: string, channel: IOSReleaseChannel) {
  if (!/^[A-Z0-9]{10}$/.test(teamId)) throw new Error("Invalid APPLE_TEAM_ID.");
  return `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>destination</key><string>export</string>
<key>teamID</key><string>${teamId}</string>
<key>signingStyle</key><string>automatic</string>
<key>manageAppVersionAndBuildNumber</key><false/>
<key>uploadSymbols</key><true/>
${channel === "staging-testflight" ? "<key>testFlightInternalTestingOnly</key><true/>\n" : ""}</dict></plist>\n`;
}
