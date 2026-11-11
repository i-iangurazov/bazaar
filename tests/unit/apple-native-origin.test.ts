import { describe, expect, it } from "vitest";
import { appleNativeOriginAllowed } from "@/server/billing/appleNativeRoute";
describe("App Store native API exact preview origin", () => {
  const preview = { VERCEL_ENV: "preview", APPLE_BILLING_MODE: "sandbox", APPLE_BILLING_PREVIEW_ORIGIN: "https://bazaar-ios-synthetic.vercel.app" };
  it("keeps canonical production origin and normalizes default HTTPS port", () => {
    expect(appleNativeOriginAllowed("https://www.bazaar.kg:443", {})).toBe(true);
    expect(appleNativeOriginAllowed("https://www.bazaar.kg.evil.test", {})).toBe(false);
  });
  it("permits only the exact explicitly configured sandbox preview", () => {
    expect(appleNativeOriginAllowed(preview.APPLE_BILLING_PREVIEW_ORIGIN, preview)).toBe(true);
    expect(appleNativeOriginAllowed("https://different-preview.vercel.app", preview)).toBe(false);
    expect(appleNativeOriginAllowed(preview.APPLE_BILLING_PREVIEW_ORIGIN, { ...preview, VERCEL_ENV: "production" })).toBe(false);
    expect(appleNativeOriginAllowed(preview.APPLE_BILLING_PREVIEW_ORIGIN, { ...preview, APPLE_BILLING_MODE: "live" })).toBe(false);
  });
  it.each([null, "not-a-url", "http://www.bazaar.kg", "https://evil@www.bazaar.kg", "https://www.bazaar.kg/path", "https://www.bazaar.kg?other=1"])("rejects invalid or ambiguous origin %s", (origin) => {
    expect(appleNativeOriginAllowed(origin, preview)).toBe(false);
  });
});
