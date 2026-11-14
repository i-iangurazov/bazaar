"use client";

import { useNativePlatform } from "@/lib/native/useNativePlatform";

export function MarketingPurchaseFaqAnswer({
  answer,
  iosAnswer,
  pendingAnswer,
}: {
  answer: string;
  iosAnswer: string;
  pendingAnswer: string;
}) {
  const platform = useNativePlatform();
  // The server and initial hydration must not expose an outside-purchase
  // instruction before the native platform is known.
  return <p>{platform === null ? pendingAnswer : platform === "ios" ? iosAnswer : answer}</p>;
}
