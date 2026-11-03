import { describe, expect, it } from "vitest";
import { releaseOptions } from "../../scripts/mobile/release-options";

describe("store release identity", () => {
  it("keeps the same explicit version and build across stores", () => {
    expect(releaseOptions({ MOBILE_APP_VERSION: "1.2.3", MOBILE_BUILD_NUMBER: "42" }))
      .toEqual({ version: "1.2.3", build: "42" });
  });
  it.each([
    { BAZAAR_MOBILE_ENV: "staging" }, { MOBILE_APP_VERSION: "1.0 beta" },
    { MOBILE_BUILD_NUMBER: "0" }, { MOBILE_BUILD_NUMBER: "2100000001" },
    { MOBILE_BUILD_NUMBER: "1.5" }, { BAZAAR_ANDROID_VERSION_CODE: "42" },
    { BAZAAR_ANDROID_VERSION_NAME: "2.0.0" },
  ])("rejects an unsafe or inconsistent identity: %j", (env) => {
    expect(() => releaseOptions(env)).toThrow();
  });
});
