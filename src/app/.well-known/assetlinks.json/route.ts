import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const fingerprintPattern = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export const GET = () => {
  const fingerprints = (process.env.ANDROID_APP_LINK_SHA256_FINGERPRINTS ?? "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter((value) => fingerprintPattern.test(value));
  return NextResponse.json(
    fingerprints.length
      ? [
          {
            relation: ["delegate_permission/common.handle_all_urls"],
            target: {
              namespace: "android_app",
              package_name: "kg.bazaar.app",
              sha256_cert_fingerprints: fingerprints,
            },
          },
        ]
      : [],
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
};
