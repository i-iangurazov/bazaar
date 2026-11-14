import type { CapacitorConfig } from "@capacitor/cli";

type MobileEnvironment = "development" | "staging" | "production";

const environment = (process.env.BAZAAR_MOBILE_ENV ?? "production") as MobileEnvironment;
const environmentUrls: Record<MobileEnvironment, string> = {
  development: process.env.CAPACITOR_SERVER_URL ?? "http://localhost:3000/dashboard",
  staging:
    process.env.CAPACITOR_SERVER_URL ??
    "https://bazaar-git-main-ilyas0707s-projects.vercel.app/dashboard",
  production: "https://www.bazaar.kg/dashboard",
};

if (!Object.hasOwn(environmentUrls, environment)) {
  throw new Error(`Unsupported BAZAAR_MOBILE_ENV: ${environment}`);
}

const serverUrl = new URL(environmentUrls[environment]);
if (environment === "production" && serverUrl.origin !== "https://www.bazaar.kg") {
  throw new Error("Production mobile builds must use https://www.bazaar.kg.");
}
if (environment !== "development" && serverUrl.protocol !== "https:") {
  throw new Error("Non-development mobile builds require HTTPS.");
}

const appVersion = process.env.MOBILE_APP_VERSION?.trim() || "1.0.0";

const config: CapacitorConfig = {
  appId: "kg.bazaar.app",
  appName: "Bazaar",
  webDir: "mobile-shell",
  backgroundColor: "#ffffff",
  appendUserAgent: ` BazaarNative/${appVersion} (${environment})`,
  loggingBehavior: environment === "production" ? "none" : "debug",
  zoomEnabled: true,
  initialFocus: true,
  server: {
    url: serverUrl.toString().replace(/\/$/, ""),
    cleartext: environment === "development" && serverUrl.protocol === "http:",
    allowNavigation: [serverUrl.hostname],
    errorPath: "native-offline.html",
  },
  android: {
    appendUserAgent: ` BazaarNativeAndroid/${appVersion}`,
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: environment !== "production",
    resolveServiceWorkerRequests: false,
  },
  ios: {
    appendUserAgent: ` BazaarNativeIOS/${appVersion}`,
    allowsLinkPreview: false,
    contentInset: "never",
    preferredContentMode: "mobile",
    webContentsDebuggingEnabled: environment !== "production",
    handleApplicationNotifications: true,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      // Preserve Android's launch presentation. The isolated iOS bundle copy
      // disables this duplicate overlay in scripts/mobile/ios-build-config.ts.
      launchShowDuration: 900,
      launchFadeOutDuration: 220,
      backgroundColor: "#ffffff",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      overlaysWebView: true,
      style: "LIGHT",
      backgroundColor: "#ffffff",
    },
    Keyboard: {
      resize: "body",
      resizeOnFullScreen: true,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
