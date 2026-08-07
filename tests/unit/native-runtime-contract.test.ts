import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const read = (relativePath: string) => readFile(path.join(process.cwd(), relativePath), "utf8");

describe("native runtime contract", () => {
  it("keeps the PWA worker out of Capacitor while preserving browser registration", async () => {
    const source = await read("src/components/pwa-service-worker-register.tsx");
    expect(source).toContain("isNativeApp()");
    expect(source).toContain('navigator.serviceWorker.register("/sw.js")');
  });

  it("ships secure app identities, permissions, links, and no cleartext production transport", async () => {
    const [config, manifest, plist, appleLinks, androidLinks] = await Promise.all([
      read("capacitor.config.ts"),
      read("android/app/src/main/AndroidManifest.xml"),
      read("ios/App/App/Info.plist"),
      read("src/app/.well-known/apple-app-site-association/route.ts"),
      read("src/app/.well-known/assetlinks.json/route.ts"),
    ]);
    expect(config).toContain('appId: "kg.bazaar.app"');
    expect(config).toContain('production: "https://www.bazaar.kg/dashboard"');
    expect(manifest).toContain('android:usesCleartextTraffic="false"');
    expect(manifest).toContain("android.permission.CAMERA");
    expect(manifest).toContain('android:autoVerify="true"');
    expect(plist).toContain("NSCameraUsageDescription");
    expect(plist).toContain("<string>bazaar</string>");
    expect(appleLinks).toContain("APPLE_TEAM_ID");
    expect(androidLinks).toContain("ANDROID_APP_LINK_SHA256_FINGERPRINTS");
  });

  it("never includes server credentials in generated native configuration", async () => {
    const generated = await read("capacitor.config.ts");
    for (const forbidden of ["DATABASE_URL", "REDIS_URL", "RESEND_API_KEY", "NEXTAUTH_SECRET"]) {
      expect(generated).not.toContain(forbidden);
    }
  });

  it("keeps live push behind the shared external-provider boundary", async () => {
    const source = await read("src/server/services/mobilePush.ts");
    expect(source).toContain('assertExternalProviderCallAllowed("mobile-push")');
    expect(source.indexOf('assertExternalProviderCallAllowed("mobile-push")')).toBeLessThan(
      source.indexOf("await sendApns"),
    );
    expect(source.indexOf('assertExternalProviderCallAllowed("mobile-push")')).toBeLessThan(
      source.indexOf("await sendFcm"),
    );
  });
});
