import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const safeVersion = (value: string | undefined, fallback: string) =>
  /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value?.trim() ?? "") ? value!.trim() : fallback;

const safeStoreUrl = (value: string | undefined) => {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};

export const GET = () =>
  NextResponse.json(
    {
      minimumSupportedAppVersion: safeVersion(process.env.MOBILE_MIN_SUPPORTED_VERSION, "1.0.0"),
      latestAppVersion: safeVersion(process.env.MOBILE_LATEST_VERSION, "1.0.0"),
      androidStoreUrl: safeStoreUrl(process.env.MOBILE_ANDROID_STORE_URL),
      iosStoreUrl: safeStoreUrl(process.env.MOBILE_IOS_STORE_URL),
    },
    { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" } },
  );
