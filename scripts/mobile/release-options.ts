export function releaseOptions(env: Record<string, string | undefined>) {
  if (env.BAZAAR_MOBILE_ENV && env.BAZAAR_MOBILE_ENV !== "production") {
    throw new Error("Store builds require BAZAAR_MOBILE_ENV=production.");
  }
  const version = env.MOBILE_APP_VERSION ?? "1.0.0";
  const build = env.MOBILE_BUILD_NUMBER ?? "1";
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("MOBILE_APP_VERSION must be x.y.z.");
  if (!/^[1-9]\d*$/.test(build) || Number(build) > 2_100_000_000) {
    throw new Error("MOBILE_BUILD_NUMBER must be a positive Play-compatible integer.");
  }
  if ((env.BAZAAR_ANDROID_VERSION_NAME && env.BAZAAR_ANDROID_VERSION_NAME !== version) ||
      (env.BAZAAR_ANDROID_VERSION_CODE && env.BAZAAR_ANDROID_VERSION_CODE !== build)) {
    throw new Error("Use MOBILE_APP_VERSION/MOBILE_BUILD_NUMBER consistently on both platforms.");
  }
  return { version, build };
}
